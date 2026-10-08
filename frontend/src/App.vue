<script setup lang="ts">
/** 调试台主界面：会话侧栏 + 对话区 + 能力面板 + 分享视图 */
import { onMounted, ref, watch, nextTick, computed, reactive } from 'vue'
import { useChat, type AttachedFile } from './composables/useChat'
import ConversationList from './components/ConversationList.vue'
import RecordItem from './components/RecordItem.vue'
import AssistantGroup, { type AssistantEntry } from './components/AssistantGroup.vue'
import StatusLine from './components/StatusLine.vue'
import Sender from './components/Sender.vue'
import AgentPanel from './components/AgentPanel.vue'
import type { Questionnaire, QuestionnaireAnswer, Record as RecordV2 } from './sse/types'
import { isUserRecordInvisible } from './utils/record'
import { pickQuestionnaireContent } from './utils/questionnaire'
import {
  checkAllowed,
  createConversation,
  createShare,
  deleteConversation,
  fetchSuggestions,
  getShare,
  getUserId,
  listApplications,
  listConversations,
  rateMessage,
  setUserId,
  type ConversationItem,
} from './api'

const {
  records,
  conversationId,
  activeKey,
  streaming,
  activeIds,
  error,
  conversationVersion,
  questionnaireState,
  send,
  submitQuestionnaire,
  skipQuestionnaire,
  stop,
  loadHistory,
  newChat,
  openShareView,
  onNewConversation,
} = useChat()

const conversations = ref<ConversationItem[]>([])
interface AppInfo {
  ApplicationId: string
  Name?: string
  Pattern?: string | null
}
const applications = ref<AppInfo[]>([])
const applicationId = ref('')
const userId = ref(getUserId())
const allowed = ref<boolean | null>(null)
const agentPanelOpen = ref(false)
const agentPanelTab = ref<'skill' | 'tool' | 'connector' | 'knowledge'>('skill')

function openAgentPanel(tab: 'skill' | 'tool' | 'connector' | 'knowledge') {
  agentPanelTab.value = tab
  agentPanelOpen.value = true
}
const suggestions = ref<{ title: string; prompt: string }[]>([])
const scores = ref<Record<string, number>>({})
const scroller = ref<HTMLElement | null>(null)

/**
 * 会话标题：后端在首条上行时把「用户真实输入的前 20 个字」写入
 * chat_conversation.title，刷新后列表接口直接返回。
 * 本地 titles 只兜两件事：发送中会话 Id 未落位、以及存量旧会话的即时回填。
 * 澄清回执、「跳过」这类协议占位不参与；取不到就默认「新任务」。
 */
const localTitles = ref<Record<string, string>>({})
/**
 * 首条提问发送中、会话 Id 还没落位时的临时标题：按发起时的会话 key 记账。
 * 会话 Id 落位（可能发生在后台——用户已切走）时再落到 localTitles。
 */
const pendingTitleByKey = reactive<Record<string, string>>({})
onNewConversation((id, key) => {
  const title = pendingTitleByKey[key]
  if (title && !localTitles.value[id]) {
    localTitles.value = { ...localTitles.value, [id]: title }
  }
  delete pendingTitleByKey[key]
})

function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t ? t.slice(0, 20) : '新任务'
}

/** 该会话是否已有用户真实输入（澄清回执不算） */
function hasUserInput(list: RecordV2[]): boolean {
  return list.some((r) => r.Role === 'user' && !isUserRecordInvisible(r))
}

/** 分享视图：URL 带 ?share=<id> 时只读展示快照 */
const shareId = new URLSearchParams(location.search).get('share') ?? ''
const shareTitle = ref('')

async function refreshAllowed() {
  try {
    allowed.value = (await checkAllowed(userId.value)).allowed
  } catch {
    allowed.value = null
  }
}

async function refreshConversations() {
  if (shareId) return
  try {
    conversations.value = await listConversations()
  } catch {
    conversations.value = []
  }
}

async function refreshApplications() {
  applications.value = await listApplications()
  if (!applicationId.value && applications.value.length) {
    applicationId.value = applications.value[0].ApplicationId
  }
}

async function refreshSuggestions() {
  suggestions.value = (await fetchSuggestions())
    .flatMap((group) => group.SuggestionList ?? [])
    .map((item) => ({ title: item.Title ?? '', prompt: item.PromptContent ?? '' }))
    .filter((item) => item.prompt)
}

function changeUserId() {
  setUserId(userId.value.trim())
  newChat()
  conversations.value = []
  refreshAllowed()
  refreshConversations()
}

function changeApplication() {
  newChat()
  refreshConversations()
}

function scrollToBottom() {
  nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  })
}

async function onSend(text: string, files: AttachedFile[] = []) {
  // 首条真实输入 → 生成任务标题（多轮对话不再覆盖）
  // 按发起时的会话 key 记账：即使发送中切走，落位后标题仍归本会话
  const titleSource = text.trim() || files[0]?.name || ''
  const key = activeKey.value
  const knownTitle = conversationId.value ? localTitles.value[conversationId.value] : ''
  if (titleSource && !knownTitle && !hasUserInput(records.value)) {
    pendingTitleByKey[key] = deriveTitle(titleSource)
  }
  await send(text, files)
}

async function onLoadHistory(id: string) {
  await loadHistory(id)
  // 历史会话同样从首条用户输入回填标题
  if (localTitles.value[id]) return
  const first = records.value.find((r) => r.Role === 'user' && !isUserRecordInvisible(r))
  const text =
    (first?.Messages ?? [])
      .flatMap((m) => m.Contents ?? [])
      .filter((c) => c.Type === 'text')
      .map((c) => c.Text ?? '')
      .join('') || ''
  if (text.trim()) {
    localTitles.value = { ...localTitles.value, [id]: deriveTitle(text) }
  }
}

/** 新任务发送中、会话 Id 还没建立 → 顶部占位条目 */
const pendingTitle = computed(() => {
  const title = pendingTitleByKey[activeKey.value]
  if (!streaming.value || !title || conversationId.value) return ''
  return title
})
/** 首条提问流式期间、本地标题尚未落位 → active 条目临时显示它 */
const activePendingTitle = computed(() => pendingTitleByKey[activeKey.value] ?? '')

async function onSubmitQuestionnaire(raw: Questionnaire, answers: QuestionnaireAnswer[], recordId: string) {
  await submitQuestionnaire(raw, answers, recordId)
}

async function onSkipQuestionnaire(recordId: string) {
  await skipQuestionnaire(recordId)
}

async function onRate(recordId: string, score: number) {
  if (!applicationId.value) return
  scores.value = { ...scores.value, [recordId]: score }
  try {
    await rateMessage(applicationId.value, recordId, score)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '反馈失败'
  }
}

async function onShare() {
  if (!conversationId.value || !records.value.length) return
  try {
    const id = await createShare(applicationId.value, conversationId.value, records.value)
    const url = `${location.origin}${location.pathname}?share=${id}`
    await navigator.clipboard.writeText(url).catch(() => undefined)
    error.value = `分享链接已复制：${url}`
  } catch (e) {
    error.value = e instanceof Error ? e.message : '分享失败'
  }
}

const readonly = computed(() => !!shareId)

/**
 * 渲染分组：把连续的 assistant records（中间只隔着不可见的
 * questionnaire 用户回执）合并为同一个 AI 块 —— 一次任务在界面上
 * 就是"用户提问 → AI 一次连续回答（澄清卡 + 正文）"。
 * 中间出现用户可见消息（真实新提问）才会重新开块。
 */
interface DisplayUser {
  type: 'user'
  record: RecordV2
}
interface DisplayAssistant {
  type: 'assistant'
  entries: AssistantEntry[]
}
const displayItems = computed<(DisplayUser | DisplayAssistant)[]>(() => {
  const items: (DisplayUser | DisplayAssistant)[] = []
  records.value.forEach((record, index) => {
    if (isUserRecordInvisible(record)) return
    if (record.Role === 'user') {
      items.push({ type: 'user', record })
      return
    }
    const last = items[items.length - 1]
    if (last && last.type === 'assistant') {
      last.entries.push({ record, index })
    } else {
      items.push({ type: 'assistant', entries: [{ record, index }] })
    }
  })
  return items
})
const fileMode = computed<'standard' | 'claw'>(() => {
  const pattern = applications.value.find((a) => a.ApplicationId === applicationId.value)?.Pattern
  return pattern === 'ClawAgent' ? 'claw' : 'standard'
})

/**
 * 「任务已开始但暂无可见输出」提示：流式进行中，但还没有任何
 * assistant 可见消息（上游检索/规划阶段可能长时间不吐内容）。
 * 一旦出现思考/工具/正文等可见消息，即由 MessageContent 内的执行提示接管。
 */
const showPendingHint = computed(() => {
  if (!streaming.value || readonly.value) return false
  const last = displayItems.value[displayItems.value.length - 1]
  if (!last || last.type !== 'assistant') return true
  return last.entries.every((entry) =>
    (entry.record.Messages ?? []).every(
      (m) => !!pickQuestionnaireContent(m.Contents) || !(m.Contents ?? []).length,
    ),
  )
})

watch(conversationVersion, () => refreshConversations())

// 流式期间持续贴底（text.delta 会不断更新最后一条记录）
watch([() => records.value.length, () => records.value[records.value.length - 1]?.Messages?.length], () =>
  scrollToBottom(),
)

onMounted(async () => {
  if (shareId) {
    try {
      const shared = await getShare(shareId)
      openShareView(shared.Records ?? [])
      shareTitle.value = shared.Title || '分享的对话'
      applicationId.value = shared.ApplicationId ?? ''
    } catch (e) {
      error.value = e instanceof Error ? e.message : '分享加载失败'
    }
    return
  }
  refreshAllowed()
  await refreshApplications()
  await Promise.all([refreshConversations(), refreshSuggestions()])
})
</script>

<template>
  <div class="app">
    <aside v-if="!readonly" class="sidebar">
      <div class="brand">ADP 调试台</div>
      <ConversationList
        :items="conversations"
        :active-id="conversationId"
        :titles="localTitles"
        :streaming="streaming"
        :streaming-ids="activeIds"
        :pending-title="pendingTitle"
        :active-stream-title="activePendingTitle"
        @select="onLoadHistory"
        @create="newChat"
        @delete="
          async (id) => {
            await deleteConversation(id)
            if (id === conversationId) newChat()
            await refreshConversations()
          }
        "
      />
    </aside>

    <main class="main">
      <header class="topbar">
        <span class="uid">
          X-User-Id
          <input v-model="userId" @change="changeUserId" />
        </span>
        <span v-if="allowed === true" class="badge ok">白名单内</span>
        <span v-else-if="allowed === false" class="badge no">不在白名单</span>

        <select v-if="applications.length" v-model="applicationId" @change="changeApplication">
          <option v-for="app in applications" :key="app.ApplicationId" :value="app.ApplicationId">
            {{ app.Name || app.ApplicationId }}
          </option>
        </select>

        <div class="spacer" />
        <button class="ghost" @click="agentPanelOpen = true">能力配置</button>
        <button class="ghost" :disabled="!conversationId || !records.length" @click="onShare">分享</button>
        <button v-if="!readonly" class="ghost" @click="newChat">新任务</button>
      </header>

      <div v-if="readonly" class="share-banner">分享视图（只读）：{{ shareTitle }}</div>

      <div v-if="error" class="banner">{{ error }}</div>

      <div ref="scroller" class="messages">
        <div v-if="!records.length && !streaming" class="welcome">
          发送一条消息开始对话；切到已有会话可加载历史消息。
        </div>
        <template v-for="(item, i) in displayItems" :key="item.type === 'user' ? item.record.RecordId : `ai-${i}`">
          <RecordItem v-if="item.type === 'user'" :record="item.record" />
          <AssistantGroup
            v-else
            :entries="item.entries"
            :records="records"
            :application-id="applicationId"
            :questionnaire-state="questionnaireState"
            :scores="scores"
            :readonly="readonly"
            :running="streaming && i === displayItems.length - 1"
            @submit-questionnaire="onSubmitQuestionnaire"
            @skip-questionnaire="onSkipQuestionnaire"
            @rate="onRate"
          />
        </template>

        <!-- 任务已提交、上游暂无任何可见输出：动态"开工"提示 -->
        <StatusLine v-if="showPendingHint" class="pending-hint" />
      </div>

      <div v-if="!readonly && suggestions.length" class="suggestions">
        <button v-for="(item, i) in suggestions" :key="i" class="chip" @click="send(item.prompt)">
          {{ item.title || item.prompt }}
        </button>
      </div>

      <Sender
        v-if="!readonly"
        :streaming="streaming"
        :disabled="allowed === false || !applicationId"
        :application-id="applicationId"
        :mode="fileMode"
        @send="onSend"
        @stop="stop"
        @panel="openAgentPanel"
      />
    </main>

    <AgentPanel
      v-if="agentPanelOpen"
      :application-id="applicationId"
      :initial-tab="agentPanelTab"
      @close="agentPanelOpen = false"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
}
.sidebar {
  width: 240px;
  border-right: 1px solid #eceef2;
  background: #fafbfc;
  overflow-y: auto;
  flex: 0 0 240px;
}
.brand {
  padding: 14px 16px;
  font-weight: 600;
  border-bottom: 1px solid #eceef2;
}
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid #eceef2;
}
.uid input {
  width: 140px;
  border: 1px solid #dfe3ea;
  border-radius: 6px;
  padding: 4px 8px;
}
.topbar select {
  border: 1px solid #dfe3ea;
  border-radius: 6px;
  padding: 4px 8px;
  max-width: 220px;
}
.spacer {
  margin-left: auto;
}
.badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
}
.badge.ok {
  background: #e7f6ec;
  color: #2e7d32;
}
.badge.no {
  background: #fdecea;
  color: #d93026;
}
.ghost {
  border: 1px solid #dfe3ea;
  background: #fff;
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
}
.ghost:disabled {
  color: #9aa1ab;
  cursor: not-allowed;
}
.share-banner {
  padding: 8px 16px;
  background: #fff7e6;
  color: #8a5a00;
  font-size: 13px;
}
.banner {
  margin: 8px 16px 0;
  padding: 8px 12px;
  background: #fdecea;
  color: #b3261e;
  border-radius: 6px;
  font-size: 13px;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.welcome {
  color: #9aa1ab;
  text-align: center;
  margin-top: 20vh;
}
.pending-hint {
  margin: 4px 0 0 44px;
}
.suggestions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 16px 8px;
}
.chip {
  border: 1px solid #dfe3ea;
  background: #fff;
  border-radius: 14px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  color: #5b6472;
}
.chip:hover {
  border-color: #2b62d9;
  color: #2b62d9;
}
</style>
