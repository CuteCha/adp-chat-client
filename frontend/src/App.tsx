/** 调试台主界面：会话侧栏 + 对话区 + 能力面板 + 分享视图 */
import { useEffect, useRef, useState } from 'react'
import { onNewConversation, setChatError, useChat } from './state/chat'
import type { AttachedFile } from './state/chat'
import ConversationList from './components/ConversationList'
import RecordItem from './components/RecordItem'
import AssistantGroup, { type AssistantEntry } from './components/AssistantGroup'
import StatusLine from './components/StatusLine'
import Sender, { type PanelTab } from './components/Sender'
import AgentPanel from './components/AgentPanel'
import WorkspacePanel from './components/workspace/WorkspacePanel'
import { openWorkspace, setWorkspaceContext } from './state/workspace'
import type { Questionnaire, QuestionnaireAnswer, Record as RecordV2 } from './sse/types'
import { isUserRecordInvisible } from './utils/record'
import { pickQuestionnaireContent } from './utils/questionnaire'
import {
  checkAllowed,
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
import './app.css'

interface AppInfo {
  ApplicationId: string
  Name?: string
  Pattern?: string | null
}

type DisplayItem =
  | { type: 'user'; record: RecordV2 }
  | { type: 'assistant'; entries: AssistantEntry[] }

function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t ? t.slice(0, 20) : '新任务'
}

/** 该会话是否已有用户真实输入（澄清回执不算） */
function hasUserInput(list: RecordV2[]): boolean {
  return list.some((r) => r.Role === 'user' && !isUserRecordInvisible(r))
}

/**
 * 渲染分组：把连续的 assistant records（中间只隔着不可见的
 * questionnaire 用户回执）合并为同一个 AI 块 —— 一次任务在界面上
 * 就是"用户提问 → AI 一次连续回答（澄清卡 + 正文）"。
 * 中间出现用户可见消息（真实新提问）才会重新开块。
 */
function buildDisplayItems(records: RecordV2[]): DisplayItem[] {
  const items: DisplayItem[] = []
  records.forEach((record, index) => {
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
}

export default function App() {
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
  } = useChat()

  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [applications, setApplications] = useState<AppInfo[]>([])
  const [applicationId, setApplicationId] = useState('')
  const [userId, setUserIdState] = useState(getUserId())
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const [agentPanelTab, setAgentPanelTab] = useState<PanelTab>('skill')
  const [suggestions, setSuggestions] = useState<{ title: string; prompt: string }[]>([])
  const [scores, setScores] = useState<Record<string, number>>({})
  /**
   * 会话标题：后端在首条上行时把「用户真实输入的前 20 个字」写入
   * chat_conversation.title，刷新后列表接口直接返回。
   * 本地 titles 只兜两件事：发送中会话 Id 未落位、以及存量旧会话的即时回填。
   * 澄清回执、「跳过」这类协议占位不参与；取不到就默认「新任务」。
   */
  const [localTitles, setLocalTitles] = useState<Record<string, string>>({})
  const localTitlesRef = useRef<Record<string, string>>({})
  /**
   * 首条提问发送中、会话 Id 还没落位时的临时标题：按发起时的会话 key 记账。
   * 会话 Id 落位（可能发生在后台——用户已切走）时再落到 localTitles。
   */
  const pendingTitleByKey = useRef<Record<string, string>>({})
  const [shareTitle, setShareTitle] = useState('')

  const scroller = useRef<HTMLDivElement | null>(null)
  const shareId = useRef(new URLSearchParams(location.search).get('share') ?? '').current
  const readonly = !!shareId

  function updateLocalTitles(next: Record<string, string>) {
    localTitlesRef.current = next
    setLocalTitles(next)
  }

  // 会话 Id 落位：把发起时记下的标题落到真实会话上（可能发生在后台）
  useEffect(
    () =>
      onNewConversation((id, key) => {
        const pending = pendingTitleByKey.current
        const title = pending[key]
        if (title && !localTitlesRef.current[id]) {
          updateLocalTitles({ ...localTitlesRef.current, [id]: title })
        }
        delete pending[key]
      }),
    [],
  )

  async function refreshAllowed() {
    try {
      setAllowed((await checkAllowed(userId)).allowed)
    } catch {
      setAllowed(null)
    }
  }

  async function refreshConversations() {
    if (shareId) return
    try {
      setConversations(await listConversations())
    } catch {
      setConversations([])
    }
  }

  async function refreshApplications() {
    const list = await listApplications()
    setApplications(list)
    if (!applicationId && list.length) setApplicationId(list[0].ApplicationId)
  }

  async function refreshSuggestions() {
    setSuggestions(
      (await fetchSuggestions())
        .flatMap((group) => group.SuggestionList ?? [])
        .map((item) => ({ title: item.Title ?? '', prompt: item.PromptContent ?? '' }))
        .filter((item) => item.prompt),
    )
  }

  function changeUserId() {
    setUserId(userId.trim())
    newChat()
    setConversations([])
    void refreshAllowed()
    void refreshConversations()
  }

  function changeApplication(next: string) {
    setApplicationId(next)
    newChat()
    void refreshConversations()
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const el = scroller.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }

  async function handleSend(text: string, files: AttachedFile[] = []) {
    // 首条真实输入 → 生成任务标题（多轮对话不再覆盖）
    // 按发起时的会话 key 记账：即使发送中切走，落位后标题仍归本会话
    const titleSource = text.trim() || files[0]?.name || ''
    const key = activeKey
    const knownTitle = conversationId ? localTitlesRef.current[conversationId] : ''
    if (titleSource && !knownTitle && !hasUserInput(records)) {
      pendingTitleByKey.current[key] = deriveTitle(titleSource)
    }
    await send(text, files)
  }

  async function handleLoadHistory(id: string) {
    await loadHistory(id)
    // 历史会话同样从首条用户输入回填标题
    if (localTitlesRef.current[id]) return
    const first = records.find((r) => r.Role === 'user' && !isUserRecordInvisible(r))
    const text =
      (first?.Messages ?? [])
        .flatMap((m) => m.Contents ?? [])
        .filter((c) => c.Type === 'text')
        .map((c) => c.Text ?? '')
        .join('') || ''
    if (text.trim()) {
      updateLocalTitles({ ...localTitlesRef.current, [id]: deriveTitle(text) })
    }
  }

  async function handleSubmitQuestionnaire(
    raw: Questionnaire,
    answers: QuestionnaireAnswer[],
    recordId: string,
  ) {
    await submitQuestionnaire(raw, answers, recordId)
  }

  async function handleRate(recordId: string, score: number) {
    if (!applicationId) return
    setScores((prev) => ({ ...prev, [recordId]: score }))
    try {
      await rateMessage(applicationId, recordId, score)
    } catch (e) {
      setChatError(e instanceof Error ? e.message : '反馈失败')
    }
  }

  async function handleShare() {
    if (!conversationId || !records.length) return
    try {
      const id = await createShare(applicationId, conversationId, records)
      const url = `${location.origin}${location.pathname}?share=${id}`
      await navigator.clipboard.writeText(url).catch(() => undefined)
      setChatError(`分享链接已复制：${url}`)
    } catch (e) {
      setChatError(e instanceof Error ? e.message : '分享失败')
    }
  }

  // 会话版本变化 → 侧栏刷新（新会话 / 活跃时间 / 后台任务完成）
  const lastVersion = useRef(conversationVersion)
  useEffect(() => {
    if (lastVersion.current === conversationVersion) return
    lastVersion.current = conversationVersion
    void refreshConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationVersion])

  /** 工作区面板上下文：应用 / 会话变化时同步 */
  useEffect(() => {
    setWorkspaceContext(applicationId, conversationId)
  }, [applicationId, conversationId])

  // 流式期间持续贴底（text.delta 会不断更新最后一条记录）
  useEffect(() => {
    scrollToBottom()
  }, [records.length, records[records.length - 1]?.Messages?.length])

  useEffect(() => {
    async function bootstrap() {
      if (shareId) {
        try {
          const shared = await getShare(shareId)
          openShareView(shared.Records ?? [])
          setShareTitle(shared.Title || '分享的对话')
          if (shared.ApplicationId) setApplicationId(shared.ApplicationId)
        } catch (e) {
          setChatError(e instanceof Error ? e.message : '分享加载失败')
        }
        return
      }
      void refreshAllowed()
      await refreshApplications()
      await Promise.all([refreshConversations(), refreshSuggestions()])
    }
    void bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const displayItems = buildDisplayItems(records)
  const fileMode: 'standard' | 'claw' =
    applications.find((a) => a.ApplicationId === applicationId)?.Pattern === 'ClawAgent'
      ? 'claw'
      : 'standard'

  /** 新任务发送中、会话 Id 还没建立 → 顶部占位条目 */
  const pendingTitle = (() => {
    const title = pendingTitleByKey.current[activeKey]
    if (!streaming || !title || conversationId) return ''
    return title
  })()
  /** 首条提问流式期间、本地标题尚未落位 → active 条目临时显示它 */
  const activePendingTitle = pendingTitleByKey.current[activeKey] ?? ''

  /**
   * 「任务已开始但暂无可见输出」提示：流式进行中，但还没有任何
   * assistant 可见消息（上游检索/规划阶段可能长时间不吐内容）。
   * 一旦出现思考/工具/正文等可见消息，即由 MessageContent 内的执行提示接管。
   */
  const showPendingHint = (() => {
    if (!streaming || readonly) return false
    const last = displayItems[displayItems.length - 1]
    if (!last || last.type !== 'assistant') return true
    return last.entries.every((entry) =>
      (entry.record.Messages ?? []).every(
        (m) => !!pickQuestionnaireContent(m.Contents) || !(m.Contents ?? []).length,
      ),
    )
  })()

  return (
    <div className="app-shell">
      {!readonly && (
        <aside className="app-sidebar">
          <div className="app-brand">ADP 调试台</div>
          <ConversationList
            items={conversations}
            activeId={conversationId}
            titles={localTitles}
            streaming={streaming}
            streamingIds={activeIds}
            pendingTitle={pendingTitle}
            activeStreamTitle={activePendingTitle}
            onSelect={(id) => void handleLoadHistory(id)}
            onCreate={newChat}
            onDelete={(id) => {
              void (async () => {
                await deleteConversation(id)
                if (id === conversationId) newChat()
                await refreshConversations()
              })()
            }}
          />
        </aside>
      )}

      <main className="app-main">
        <header className="app-topbar">
          <span className="app-uid">
            X-User-Id
            <input
              value={userId}
              onChange={(e) => setUserIdState(e.target.value)}
              onBlur={changeUserId}
              onKeyDown={(e) => e.key === 'Enter' && changeUserId()}
            />
          </span>
          {allowed === true && <span className="app-badge app-ok">白名单内</span>}
          {allowed === false && <span className="app-badge app-no">不在白名单</span>}

          {applications.length > 0 && (
            <select
              value={applicationId}
              onChange={(e) => changeApplication(e.target.value)}
            >
              {applications.map((app) => (
                <option key={app.ApplicationId} value={app.ApplicationId}>
                  {app.Name || app.ApplicationId}
                </option>
              ))}
            </select>
          )}

          <div className="app-spacer" />
          <button
            className="app-ghost"
            title="工作区：查看智能体产出的文件"
            disabled={!conversationId}
            onClick={() => openWorkspace()}
          >
            📁 工作区
          </button>
          <button className="app-ghost" onClick={() => setAgentPanelOpen(true)}>
            能力配置
          </button>
          <button
            className="app-ghost"
            disabled={!conversationId || !records.length}
            onClick={() => void handleShare()}
          >
            分享
          </button>
          {!readonly && (
            <button className="app-ghost" onClick={newChat}>
              新任务
            </button>
          )}
        </header>

        {readonly && <div className="app-share-banner">分享视图（只读）：{shareTitle}</div>}

        {error && <div className="app-banner">{error}</div>}

        <div ref={scroller} className="app-messages">
          {!records.length && !streaming && (
            <div className="app-welcome">发送一条消息开始对话；切到已有会话可加载历史消息。</div>
          )}
          {displayItems.map((item) =>
            item.type === 'user' ? (
              <RecordItem key={item.record.RecordId} record={item.record} />
            ) : (
              <AssistantGroup
                key={`ai-${item.entries[0]?.record.RecordId ?? ''}`}
                entries={item.entries}
                records={records}
                applicationId={applicationId}
                questionnaireState={questionnaireState}
                scores={scores}
                readonly={readonly}
                running={streaming && item === displayItems[displayItems.length - 1]}
                onSubmitQuestionnaire={(raw, answers, recordId) =>
                  void handleSubmitQuestionnaire(raw, answers, recordId)
                }
                onSkipQuestionnaire={(recordId) => void skipQuestionnaire(recordId)}
                onRate={(recordId, score) => void handleRate(recordId, score)}
              />
            ),
          )}

          {/* 任务已提交、上游暂无任何可见输出：动态"开工"提示 */}
          {showPendingHint && <StatusLine className="app-pending-hint" />}
        </div>

        {!readonly && suggestions.length > 0 && (
          <div className="app-suggestions">
            {suggestions.map((item, i) => (
              <button key={i} className="app-chip" onClick={() => void send(item.prompt)}>
                {item.title || item.prompt}
              </button>
            ))}
          </div>
        )}

        {!readonly && (
          <Sender
            streaming={streaming}
            disabled={allowed === false || !applicationId}
            applicationId={applicationId}
            mode={fileMode}
            onSend={(text, files) => void handleSend(text, files)}
            onStop={stop}
            onPanel={(tab) => {
              setAgentPanelTab(tab)
              setAgentPanelOpen(true)
            }}
          />
        )}
      </main>

      {agentPanelOpen && (
        <AgentPanel
          applicationId={applicationId}
          initialTab={agentPanelTab}
          onClose={() => setAgentPanelOpen(false)}
        />
      )}

      {/* 右侧工作区：文件夹图标 / 消息内产物链接 / 产物卡片 共用 */}
      <WorkspacePanel />
    </div>
  )
}
