/** 助手回复末尾的产物卡片：从回复文本中提取 /workdir/... 产物文件，
 *  统一展示并支持逐个下载 / 全部下载 / 点击预览。 */
import { useMemo } from 'react'
import { downloadWorkspaceFile } from '../../api'
import { ensureWorkspaceId, previewFile, useWorkspace } from '../../state/workspace'
import './artifact-cards.css'

export interface Artifact {
  path: string
  name: string
}

/** 从 markdown 文本中提取工作区产物路径（去重） */
function extractArtifacts(text: string): Artifact[] {
  const found: string[] = []
  const re = /\/workdir\/[^\s)\]}>（），。；：、"']+/gi
  for (const m of text.matchAll(re)) {
    // 去掉尾部可能被 markdown/标点带上的符号（含行内代码的反引号）
    found.push(m[0].replace(/[.,;:!?'"`]+$/, ''))
  }
  const seen = new Set<string>()
  const out: Artifact[] = []
  for (const path of found) {
    const lower = path.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push({ path, name: path.split('/').pop() || path })
  }
  return out
}

export default function ArtifactCards({ text }: { text: string }) {
  const ws = useWorkspace()
  const artifacts = useMemo(() => extractArtifacts(text), [text])

  async function downloadOne(path: string) {
    const workspaceId = await ensureWorkspaceId()
    await downloadWorkspaceFile(ws.applicationId, { workspaceId, path })
  }

  async function downloadAll() {
    for (const a of artifacts) {
      await downloadOne(a.path)
    }
  }

  if (!artifacts.length) return null

  return (
    <div className="arts">
      <div className="arts-head">
        <span className="arts-label">产物（{artifacts.length}）</span>
        {artifacts.length > 1 && (
          <button className="arts-dl-all" onClick={downloadAll}>
            全部下载
          </button>
        )}
      </div>
      {artifacts.map((a) => (
        <div key={a.path} className="arts-card" onClick={() => previewFile(a.path)}>
          <span className="arts-ico">📄</span>
          <span className="arts-name" title={a.path}>
            {a.name}
          </span>
          <span className="arts-ops">
            <button
              className="arts-op"
              title="预览"
              onClick={(e) => {
                e.stopPropagation()
                previewFile(a.path)
              }}
            >
              预览
            </button>
            <button
              className="arts-op"
              title="下载"
              onClick={(e) => {
                e.stopPropagation()
                void downloadOne(a.path)
              }}
            >
              ⬇ 下载
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}
