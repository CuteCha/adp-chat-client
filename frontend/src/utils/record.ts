/**
 * Record 可见性判断（渲染层共用：App 分组 + RecordItem）
 */
import type { Record as RecordV2 } from '../sse/types'

/**
 * 用户 record 渲染后没有任何可见内容（无文本、无附件）→ 整条不渲染。
 * 典型场景：提交澄清问卷时协议要求上行一条 user message，上游会把它
 * 存进历史并回放（content 为 questionnaire，或回执里 Contents 为空）。
 * 答案已经体现在助手澄清卡的摘要里，这条记录渲染出来只会是一个空气泡。
 */
export function isUserRecordInvisible(record: RecordV2): boolean {
  if (record.Role !== 'user') return false
  const msgs = record.Messages ?? []
  if (!msgs.length) return false
  return !msgs.some((m) =>
    (m.Contents ?? []).some((c) => c.Type === 'text' || (c.Type === 'file' && c.File)),
  )
}
