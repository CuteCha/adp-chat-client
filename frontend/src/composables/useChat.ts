/**
 * 对话状态中心：唯一的流式状态机。
 * 事件流 → applySseEventToRecord（纯函数归约）→ records（渲染源）
 *
 * 状态按会话隔离：每个会话（含尚未落 Id 的新任务 pending-N）各自持有
 * records / questionnaire / AbortController / streaming。
 * 切换会话只是切换 activeId，后台会话的 SSE 连接继续消费，
 * 直到任务正常结束 —— 切走不会停止任务，可多会话并行跑任务。
 *
 * 三条上行通道最终都落到 sendContents：
 *   文本 / 附件（file content） / 反问澄清提交（questionnaire content）
 */

import { computed, reactive, ref } from 'vue'
import type {
  Content,
  Questionnaire,
  QuestionnaireAnswer,
  Record as RecordV2,
  SseEvent,
} from '../sse/types'
import { applySseEventToRecord } from '../utils/mergeRecord'
import { fetchSSE } from '../sse/fetchSSE'
import { sendMessage, fetchMessages } from '../api'
import { buildQuestionnairePayload } from '../utils/questionnaire'

const PLACEHOLDER_USER = 'placeholder-user'

/** 上行附件：客户端上传 + 文档解析后的结果 */
export interface AttachedFile {
  name: string
  size: number
  url: string
  ext: string
  docId?: string
}

/** 上行 Content：传出时统一 cast 到协议类型 */
interface OutgoingContent {
  Type: string
  [key: string]: unknown
}

/** 单个会话的完整运行状态（后台流同样写入这里） */
interface ConvState {
  records: RecordV2[]
  questionnaire: Record<string, { submitted: boolean; answers: QuestionnaireAnswer[] | null }>
  controller: AbortController | null
  streaming: boolean
}

/** 会话 Id → 状态；新任务在会话 Id 落位前用 pending-N 作为 key */
const states = reactive(new Map<string, ConvState>())

let pendingSeq = 0

function createState(): ConvState {
  return { records: [], questionnaire: {}, controller: null, streaming: false }
}

function getState(key: string): ConvState {
  let s = states.get(key)
  if (!s) {
    s = createState()
    states.set(key, s)
  }
  return s
}

/** pending-N → ''，真实会话 → 原样 */
function realId(key: string): string {
  return key.startsWith('pending-') ? '' : key
}

/** 当前查看的会话 key（pending key 或真实会话 Id） */
const activeKey = ref(`pending-${++pendingSeq}`)
/** 分享视图：非 null 时整屏只读展示该快照 */
const shareRecords = ref<RecordV2[] | null>(null)

const error = ref('')
/** 新建会话 / 会话活跃时间变化时自增，侧栏据此刷新列表 */
const conversationVersion = ref(0)

// ---------------------------------------------------------------------------
// 对外派生：当前查看会话的渲染源
// ---------------------------------------------------------------------------

const records = computed<RecordV2[]>(() =>
  shareRecords.value ? shareRecords.value : getState(activeKey.value).records,
)
/** 当前查看会话的真实会话 Id；新任务未落位 / 分享视图为 '' */
const conversationId = computed(() => (shareRecords.value ? '' : realId(activeKey.value)))
/** 当前查看会话是否在流式输出 */
const streaming = computed(() => !shareRecords.value && getState(activeKey.value).streaming)
/** 所有正在流式的会话 Id（含后台）→ 侧栏转圈 */
const streamingIds = computed(() =>
  [...states.entries()].filter(([, s]) => s.streaming).map(([k]) => realId(k)).filter(Boolean),
)
const questionnaireState = computed(() => getState(activeKey.value).questionnaire)

/** 会话 Id 落位回调（新任务的首条消息触发），参数：(真实会话Id, 发起时的 key) */
const newConversationHandlers: Array<(id: string, key: string) => void> = []
function onNewConversation(handler: (id: string, key: string) => void): void {
  newConversationHandlers.push(handler)
}

function upsert(state: ConvState, record: RecordV2) {
  const idx = state.records.findIndex((r) => r.RecordId === record.RecordId)
  if (idx >= 0) {
    state.records[idx] = record
  } else {
    state.records.push(record)
  }
}

/** ctx：每条流独立的游标（并发流不能共享 currentRecordId；key 会随会话 Id 落位而迁移） */
type StreamCtx = { currentRecordId: string; key: string }

function handleEvent(event: SseEvent, ctx: StreamCtx) {
  const key = ctx.key
  const state = getState(key)
  switch (event.Type) {
    case 'conversation': {
      const newId = event.Payload.Id
      // 新任务：把 pending 状态整体搬到真实会话 Id 下（流继续在后台跑）
      if (event.Payload.IsNewConversation && key !== newId) {
        states.set(newId, state)
        states.delete(key)
        if (activeKey.value === key) activeKey.value = newId
        ctx.key = newId // 后续事件跟随真实会话 Id
        newConversationHandlers.forEach((fn) => fn(newId, key))
        conversationVersion.value++ // 侧栏刷新出新会话
      }
      return
    }
    case 'request_ack': {
      // 用户消息：用上游返回的正式记录替换本地占位
      const idx = state.records.findIndex((r) => r.RecordId === PLACEHOLDER_USER)
      if (idx >= 0) {
        state.records[idx] = applySseEventToRecord(event, state.records[idx]) ?? event.RequestAck
      } else {
        upsert(state, event.RequestAck)
      }
      return
    }
    case 'response.created':
    case 'response.processing':
    case 'response.completed': {
      ctx.currentRecordId = event.Response.RecordId
      const existing = state.records.find((r) => r.RecordId === ctx.currentRecordId)
      const next = applySseEventToRecord(event, existing)
      if (next) upsert(state, next)
      return
    }
    default: {
      const recordId = (event as { RecordId?: string }).RecordId || ctx.currentRecordId
      const existing = state.records.find((r) => r.RecordId === recordId)
      const next = applySseEventToRecord(event, existing)
      if (next) upsert(state, next)
    }
  }
}

/** 所有上行的统一出口（key 缺省 = 当前查看的会话） */
async function sendContents(contents: OutgoingContent[], key = activeKey.value) {
  const state = getState(key)
  if (state.streaming) return
  error.value = ''

  if (contents.some((c) => c.Type === 'text' || c.Type === 'file')) {
    state.records.push({
      Role: 'user',
      RecordId: PLACEHOLDER_USER,
      ConversationId: realId(key),
      Status: 'success',
      Messages: [
        {
          Type: 'question',
          MessageId: PLACEHOLDER_USER,
          Name: 'question',
          Title: '用户提问',
          Status: 'success',
          Contents: contents as unknown as Content[],
        },
      ],
    })
  }

  state.streaming = true
  const controller = new AbortController()
  state.controller = controller
  const ctx: StreamCtx = { currentRecordId: '', key }

  await fetchSSE(
    () =>
      sendMessage(
        { Contents: contents as never, ConversationId: realId(key) || undefined },
        controller.signal,
      ),
    {
      success: (event) => handleEvent(event, ctx),
      fail: (msg) => {
        // abort 属于用户主动停止，不算错误
        if (controller.signal.aborted) return
        error.value = typeof msg === 'string' ? msg : '对话失败'
      },
      complete: () => {
        // 会话 Id 可能已在流中途落位，用最终 key 收尾
        const finalState = getState(ctx.key)
        finalState.streaming = false
        finalState.controller = null
        // 后台会话完成时也刷新侧栏（活跃时间 / 后端标题）
        conversationVersion.value++
      },
    },
  )
}

function send(text: string, files: AttachedFile[] = []) {
  const key = activeKey.value
  const state = getState(key)
  if (state.streaming || (!text.trim() && !files.length)) return Promise.resolve()
  const contents: OutgoingContent[] = [{ Type: 'text', Text: text }]
  for (const file of files) {
    contents.push({
      Type: 'file',
      File: {
        DocId: file.docId || '0',
        FileName: file.name,
        FileUrl: file.url,
        FileSize: String(file.size),
        FileType: file.ext,
      },
    })
  }
  return sendContents(contents, key)
}

/** 澄清提交：上行 questionnaire content（跳过则是纯文本「跳过」） */
async function submitQuestionnaire(raw: Questionnaire, answers: QuestionnaireAnswer[], recordId: string) {
  const key = activeKey.value
  const state = getState(key)
  state.questionnaire = {
    ...state.questionnaire,
    [recordId]: { submitted: true, answers },
  }
  await sendContents([{ Type: 'questionnaire', Questionnaire: buildQuestionnairePayload(raw, answers) }], key)
}

async function skipQuestionnaire(recordId: string) {
  const key = activeKey.value
  const state = getState(key)
  state.questionnaire = {
    ...state.questionnaire,
    [recordId]: { submitted: true, answers: null },
  }
  await send('跳过')
}

/** 仅停止当前查看会话的任务；后台会话不受影响 */
function stop() {
  const state = getState(activeKey.value)
  state.controller?.abort()
  state.controller = null
  state.streaming = false
}

async function loadHistory(id: string) {
  // 切换会话绝不停掉正在跑的任务：只切换视图
  shareRecords.value = null
  activeKey.value = id
  error.value = ''
  const state = getState(id)
  // 已在内存（含后台流式中的会话）→ 直接展示实时 records，不重拉
  if (state.records.length || state.streaming) return
  try {
    const data = await fetchMessages(id)
    state.records = data.Records ?? []
  } catch (e) {
    error.value = e instanceof Error ? e.message : '历史消息加载失败'
  }
}

function newChat() {
  // 不 stop()：旧会话的任务继续在后台执行
  shareRecords.value = null
  activeKey.value = `pending-${++pendingSeq}`
  error.value = ''
}

/** 分享视图：整屏只读快照 */
function openShareView(list: RecordV2[]) {
  shareRecords.value = list
}

export function useChat() {
  return {
    records,
    conversationId,
    activeKey,
    streaming,
    streamingIds,
    error,
    conversationVersion,
    questionnaireState,
    send,
    sendContents,
    submitQuestionnaire,
    skipQuestionnaire,
    stop,
    loadHistory,
    newChat,
    openShareView,
    onNewConversation,
  }
}
