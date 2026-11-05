/**
 * 用户气泡：文本 + 附件。
 * 助手记录由 AssistantGroup 渲染（多条合并为一个 AI 块）。
 */
import type { Content, Record as RecordV2 } from '../sse/types'
import Markdown from './Markdown'
import { isUserRecordInvisible } from '../utils/record'
import './record-item.css'

export default function RecordItem({ record }: { record: RecordV2 }) {
  if (isUserRecordInvisible(record)) return null

  const messages = record.Messages ?? []
  /** 用户只渲染 question 消息（没有则退回第一条） */
  const question = messages.find((m) => m.Type === 'question') ?? messages[0]
  const userText = (question?.Contents ?? [])
    .filter((c) => c.Type === 'text')
    .map((c) => c.Text ?? '')
    .join('')
  const attachments: NonNullable<Content['File']>[] = (question?.Contents ?? [])
    .filter((c) => c.Type === 'file' && c.File)
    .map((c) => c.File!)

  return (
    <div className="rec-record rec-user">
      <div className="rec-avatar">我</div>
      <div className="rec-bubble">
        {userText && <Markdown source={userText} />}
        {attachments.length > 0 && (
          <div className="rec-files">
            {attachments.map((file, i) => (
              <a key={i} className="rec-file-pill" href={file.FileUrl} target="_blank" rel="noreferrer">
                {file.FileName}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
