import type { ConversationItem } from '../api'
import './conversation-list.css'

/** 上游的「新对话」字面量视同无标题 */
function titleFor(item: ConversationItem, titles?: Record<string, string>): string {
  const local = titles?.[item.Id]
  if (local) return local
  if (item.Title && item.Title !== '新对话') return item.Title
  return '新任务'
}

function formatTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ConversationList({
  items,
  activeId,
  titles,
  streaming,
  streamingIds,
  pendingTitle,
  activeStreamTitle,
  onSelect,
  onCreate,
  onDelete,
}: {
  items: ConversationItem[]
  activeId: string
  /** 会话Id → 本地标题（用户首条提问前 10 字），覆盖上游为空的 Title */
  titles?: Record<string, string>
  /** 当前查看的会话正在流式输出 → 标题旁转圈 */
  streaming?: boolean
  /** 所有正在流式的会话 Id（含后台任务）→ 条目转圈 */
  streamingIds?: string[]
  /** 新任务发送中、会话还没出现在列表里 → 顶部临时条目带转圈 */
  pendingTitle?: string
  /** 首条提问流式期间、本地标题尚未落位 → active 条目临时显示它 */
  activeStreamTitle?: string
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="conv-list">
      <button className="conv-new" onClick={onCreate}>
        + 新建任务
      </button>
      {!items.length && !pendingTitle && <div className="conv-empty">暂无会话</div>}

      {/* 进行中的新任务：会话列表尚未刷新出该会话，先占位显示 */}
      {pendingTitle && (
        <div className="conv-item conv-active">
          <div className="conv-title-row">
            <span className="conv-title">{pendingTitle}</span>
            <span className="conv-spinner" title="任务进行中" />
          </div>
        </div>
      )}

      {items.map((item) => (
        <div
          key={item.Id}
          className={`conv-item${item.Id === activeId ? ' conv-active' : ''}`}
          onClick={() => onSelect(item.Id)}
        >
          <div className="conv-title-row">
            <span className="conv-title">
              {streaming && item.Id === activeId && activeStreamTitle
                ? activeStreamTitle
                : titleFor(item, titles)}
            </span>
            {((streamingIds ?? []).includes(item.Id) || (streaming && item.Id === activeId)) && (
              <span className="conv-spinner" title="任务进行中" />
            )}
          </div>
          <div className="conv-row">
            <span className="conv-time">{formatTime(item.LastActiveAt)}</span>
            <button
              className="conv-del"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(item.Id)
              }}
            >
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
