/** 单条 Message 的渲染分发：reply / thought / tool_call / task_execution / 其它 */
import { useMemo, useState } from 'react'
import type { Message } from '../sse/types'
import Markdown from './Markdown'
import ReferenceTags from './ReferenceTags'
import StatusLine from './StatusLine'
import ArtifactCards from './workspace/ArtifactCards'
import './message-content.css'

/** 工具/思考执行中的轮播提示（折叠时显示在块下方） */
const EXEC_PHRASES = ['正在执行…', '正在调用工具处理…', '正在等待执行结果…', '快好了，请稍候…']

export default function MessageContent({
  message,
  applicationId,
}: {
  message: Message
  applicationId?: string
}) {
  const text = useMemo(
    () =>
      (message.Contents ?? [])
        .filter((c) => c.Type === 'text' || c.Type === 'json_text')
        .map((c) => c.Text ?? '')
        .join(''),
    [message.Contents],
  )
  const references = useMemo(
    () => (message.Contents ?? []).flatMap((c) => c.References ?? []),
    [message.Contents],
  )

  const isThought = message.Type === 'thought'
  const isTool = message.Type === 'tool_call' || message.Type === 'task_execution'
  const [collapsed, setCollapsed] = useState(isThought || isTool)

  const title = isThought ? '思考过程' : isTool ? message.Name || message.Title || '工具调用' : message.Title || ''
  const running = message.Status === 'processing'
  const showRunningLine = running && collapsed

  if (!isThought && !isTool) {
    return (
      <div className="mc-msg">
        <div className="mc-reply">
          <Markdown source={text} />
          <ReferenceTags references={references} applicationId={applicationId || ''} />
          {/* 产物卡片：回复里提到的 /workdir/... 产物统一放到最后，可下载/预览 */}
          <ArtifactCards text={text} />
        </div>
      </div>
    )
  }

  return (
    <div className="mc-msg">
      <div className="mc-collapse">
        <button className="mc-collapse-head" onClick={() => setCollapsed((prev) => !prev)}>
          {running && <span className="mc-mini-spin" aria-hidden="true" />}
          <span className="mc-arrow">{collapsed ? '▸' : '▾'}</span>
          <span className="mc-name">{title}</span>
          {running ? (
            <span className="mc-status">进行中…</span>
          ) : message.Status === 'success' ? (
            <span className="mc-status mc-done">
              {message.ExtraInfo?.Elapsed ? message.ExtraInfo.Elapsed + 'ms' : '完成'}
            </span>
          ) : null}
        </button>
        {!collapsed && (
          <div className="mc-collapse-body">
            {text ? (
              <Markdown source={text} />
            ) : (
              <div className="mc-placeholder">{message.StatusDesc || '等待数据…'}</div>
            )}
            <ReferenceTags references={references} applicationId={applicationId || ''} />
          </div>
        )}
      </div>
      {/* 执行中且折叠：块下方给"正在执行…"动态提示，避免看似无输出 */}
      {showRunningLine && <StatusLine phrases={EXEC_PHRASES} className="mc-running-line" />}
    </div>
  )
}
