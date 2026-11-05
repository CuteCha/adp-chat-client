/**
 * 引用角标：点击拉取引用详情（DescribeRefer）。
 * 详情里有原文片段与文档来源，方便核对回答是否来自正确的文档。
 */
import { useState } from 'react'
import type { Reference } from '../sse/types'
import { fetchReferenceDetails } from '../api'
import './reference-tags.css'

function idOf(ref: Reference): string {
  return ref.Id ?? ref.DocRefer?.ReferBizId ?? ''
}
function label(ref: Reference): string {
  return ref.Name || ref.DocRefer?.DocName || ref.Url || '引用'
}
function href(ref: Reference): string | undefined {
  return ref.Url || ref.DocRefer?.Url || ref.WebSearchRefer?.Url || undefined
}
function detailText(item: Record<string, any>): string {
  return String(item.Content ?? item.Text ?? item.Source ?? '')
}

export default function ReferenceTags({
  references,
  applicationId,
}: {
  references: Reference[]
  applicationId: string
}) {
  const [details, setDetails] = useState<Array<Record<string, any>> | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || details) return
    const ids = references.map(idOf).filter(Boolean)
    if (!ids.length) return
    setLoading(true)
    try {
      setDetails(await fetchReferenceDetails(applicationId, ids))
    } catch {
      setDetails([])
    } finally {
      setLoading(false)
    }
  }

  if (!references.length) return null

  return (
    <div className="refs">
      <span className="refs-title">引用</span>
      {references.map((ref, i) => (
        <a
          key={i}
          className="ref-tag"
          href={href(ref)}
          target="_blank"
          rel="noreferrer"
        >
          [{ref.Index ?? i + 1}] {label(ref)}
        </a>
      ))}
      <button className="ref-link" onClick={toggle}>
        {open ? '收起详情' : '查看引用详情'}
      </button>

      {open && (
        <div className="ref-detail">
          {loading ? (
            <div className="ref-tip">加载中…</div>
          ) : !details?.length ? (
            <div className="ref-tip">暂无引用详情</div>
          ) : null}
          {(details ?? []).map((item, i) => (
            <div key={i} className="ref-detail-item">
              <div className="ref-detail-title">
                {item.Name || item.DocName || '来源'}
                {item.Url && (
                  <a href={item.Url} target="_blank" rel="noreferrer">
                    打开
                  </a>
                )}
              </div>
              {detailText(item) && <div className="ref-detail-text">{detailText(item)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
