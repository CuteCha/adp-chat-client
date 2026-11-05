/** 工作区文件树：懒加载逐层展开（ListDir depth=1），点击文件向外发 select。
 *  目录展开时渲染自身（递归组件），子层自己拉取目录数据。 */
import { useEffect, useState } from 'react'
import { listWorkspaceDir, type WorkspaceDirEntry } from '../../api'
import './file-tree.css'

const ROOT = '/workdir'

interface TreeNode {
  name: string
  path: string
  isDir: boolean
}

function sortEntries(list: WorkspaceDirEntry[]): WorkspaceDirEntry[] {
  return [...list].sort((a, b) => {
    const da = a.type === 'FILE_TYPE_DIRECTORY' ? 0 : 1
    const db = b.type === 'FILE_TYPE_DIRECTORY' ? 0 : 1
    if (da !== db) return da - db
    return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN')
  })
}

export default function FileTree({
  applicationId,
  workspaceId,
  activePath,
  refreshKey,
  rootPath,
  isRoot,
  onSelect,
}: {
  applicationId: string
  workspaceId: string
  /** 选中高亮的文件路径 */
  activePath?: string
  /** 外部刷新信号（版本号变化即重拉根目录） */
  refreshKey?: number
  rootPath?: string
  /** 是否根层（空态文案不同） */
  isRoot?: boolean
  onSelect: (path: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [entries, setEntries] = useState<TreeNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function load() {
    setLoading(true)
    setError('')
    try {
      const parent = rootPath || ROOT
      const list = await listWorkspaceDir(applicationId, {
        workspaceId,
        path: parent,
        depth: 1,
      })
      setEntries(
        sortEntries(list).map((e) => ({
          name: String(e.name ?? ''),
          path: e.path || `${parent.replace(/\/$/, '')}/${e.name}`,
          isDir: e.type === 'FILE_TYPE_DIRECTORY',
        })),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : '目录加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, workspaceId, refreshKey, rootPath])

  function toggle(node: TreeNode) {
    if (!node.isDir) {
      onSelect(node.path)
      return
    }
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(node.path)) next.delete(node.path)
      else next.add(node.path)
      return next
    })
  }

  if (loading) return <div className="ft-hint">加载中…</div>
  if (error) return <div className="ft-hint ft-err">{error}</div>
  if (!entries.length) return <div className="ft-hint">{isRoot ? '工作区还没有文件' : '（空目录）'}</div>

  return (
    <div className="ft-tree">
      {entries.map((n) => (
        <div key={n.path}>
          <div
            className={`ft-row${n.path === activePath ? ' ft-active' : ''}`}
            onClick={() => toggle(n)}
          >
            <span className={`ft-tw${n.isDir && expanded.has(n.path) ? ' ft-open' : ''}`}>
              {n.isDir ? '▸' : ''}
            </span>
            <span className="ft-ico">{n.isDir ? '📁' : '📄'}</span>
            <span className="ft-name" title={n.path}>
              {n.name}
            </span>
          </div>
          {n.isDir && expanded.has(n.path) && (
            <div className="ft-sub">
              <FileTree
                applicationId={applicationId}
                workspaceId={workspaceId}
                activePath={activePath}
                rootPath={n.path}
                onSelect={onSelect}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
