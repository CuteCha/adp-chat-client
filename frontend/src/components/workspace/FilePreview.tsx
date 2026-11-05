/** 工作区文件预览：按扩展名分派渲染方式。
 *  - pdf / 图片 / html：先 fetch 成 blob URL 再内联（iframe/img 带不上认证头）
 *  - 文本类（md/txt/代码/数据）：拉取文本渲染
 *  - Office 文档：浏览器原生无法内联渲染，提示下载查看 */
import { useEffect, useRef, useState } from 'react'
import { downloadWorkspaceFile, fetchWorkspaceBlob } from '../../api'
import './file-preview.css'

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'])
const TEXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'xml', 'yml', 'yaml', 'log',
  'py', 'js', 'ts', 'tsx', 'jsx', 'css', 'sh', 'sql', 'java', 'go', 'rs', 'c', 'cpp',
])
const OFFICE = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'])

type Kind = 'pdf' | 'image' | 'html' | 'text' | 'office' | 'unknown'

function kindOf(ext: string): Kind {
  if (ext === 'pdf') return 'pdf'
  if (IMAGE.has(ext)) return 'image'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (TEXT.has(ext)) return 'text'
  if (OFFICE.has(ext)) return 'office'
  return 'unknown'
}

export default function FilePreview({
  applicationId,
  workspaceId,
  path,
  version,
}: {
  applicationId: string
  workspaceId: string
  path: string
  /** 外部版本号变化时强制重新加载 */
  version?: number
}) {
  const fileName = path.split('/').pop() || path
  const ext = (fileName.toLowerCase().match(/\.([a-z0-9]+)$/) ?? [])[1] ?? ''
  const kind = kindOf(ext)

  const [textContent, setTextContent] = useState('')
  const [blobUrl, setBlobUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const lastBlobUrl = useRef('')

  function setBlob(url: string) {
    if (lastBlobUrl.current && lastBlobUrl.current !== url) URL.revokeObjectURL(lastBlobUrl.current)
    lastBlobUrl.current = url
    setBlobUrl(url)
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setError('')
      setTextContent('')
      setBlob('')
      // iframe/img 的 src 带不上 X-User-Id 头，预览一律先 fetch 成 blob
      if (kind !== 'text') {
        setLoading(true)
        try {
          const url = await fetchWorkspaceBlob(applicationId, { workspaceId, path })
          if (!cancelled) setBlob(url)
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : '读取失败')
        } finally {
          if (!cancelled) setLoading(false)
        }
        return
      }
      setLoading(true)
      try {
        const url = await fetchWorkspaceBlob(applicationId, { workspaceId, path })
        const full = await (await fetch(url)).text()
        URL.revokeObjectURL(url)
        if (cancelled) return
        // 文本预览截断，避免超大文件卡渲染
        setTextContent(full.length > 400_000 ? full.slice(0, 400_000) + '\n…（内容过长已截断）' : full)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '读取失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, workspaceId, path, version])

  useEffect(
    () => () => {
      if (lastBlobUrl.current) URL.revokeObjectURL(lastBlobUrl.current)
    },
    [],
  )

  function download() {
    void downloadWorkspaceFile(applicationId, { workspaceId, path })
  }

  return (
    <div className="fp-wrap">
      <div className="fp-head">
        <span className="fp-name" title={path}>
          {fileName}
        </span>
        <button className="fp-btn" title="下载" onClick={download}>
          ⬇
        </button>
      </div>

      {kind === 'pdf' && (
        <div className="fp-body">
          <iframe src={blobUrl} className="fp-frame" title={fileName} />
        </div>
      )}

      {kind === 'image' && (
        <div className="fp-body fp-img-wrap">
          <img src={blobUrl} alt={fileName} />
        </div>
      )}

      {kind === 'html' && (
        <div className="fp-body">
          <iframe src={blobUrl} className="fp-frame" title={fileName} />
        </div>
      )}

      {kind === 'text' && (
        <div className="fp-body">
          {loading ? (
            <div className="fp-hint">加载中…</div>
          ) : error ? (
            <div className="fp-hint fp-err">{error}</div>
          ) : (
            <pre className="fp-code">{textContent}</pre>
          )}
        </div>
      )}

      {(kind === 'office' || kind === 'unknown') && (
        <div className="fp-body fp-center">
          <div className="fp-hint">
            该格式暂不支持在线预览
            <button className="fp-dl" onClick={download}>
              下载查看
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
