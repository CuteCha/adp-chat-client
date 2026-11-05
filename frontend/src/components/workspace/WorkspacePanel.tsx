/** 右侧工作区面板：文件树 + 预览。
 *  全局唯一实例，由 workspace store 的 state 驱动（顶部文件夹图标 /
 *  消息内文件链接 / 产物卡片三个入口共用）。 */
import { useEffect, useState } from 'react'
import {
  closeWorkspace,
  ensureWorkspaceId,
  selectWorkspaceFile,
  useWorkspace,
} from '../../state/workspace'
import FileTree from './FileTree'
import FilePreview from './FilePreview'
import './workspace-panel.css'

export default function WorkspacePanel() {
  const ws = useWorkspace()
  const [workspaceId, setWorkspaceId] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [loadingWs, setLoadingWs] = useState(false)

  const hasContext = !!ws.applicationId && !!ws.conversationId

  async function loadWorkspaceId() {
    if (!ws.applicationId || !ws.conversationId) return
    setLoadingWs(true)
    try {
      setWorkspaceId(await ensureWorkspaceId())
    } finally {
      setLoadingWs(false)
    }
  }

  useEffect(() => {
    if (ws.open) void loadWorkspaceId()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.open, ws.applicationId, ws.conversationId])

  function refresh() {
    setRefreshKey((prev) => prev + 1)
    void loadWorkspaceId()
  }

  if (!ws.open) return null

  return (
    <aside className="wsp-panel">
      <header className="wsp-head">
        <span className="wsp-title">工作区</span>
        <button className="wsp-ico-btn" title="刷新" onClick={refresh}>
          ⟳
        </button>
        <button className="wsp-ico-btn" title="关闭" onClick={closeWorkspace}>
          ✕
        </button>
      </header>

      {!hasContext ? (
        <div className="wsp-empty">当前没有进行中的会话，无法读取工作区。</div>
      ) : (
        <div className={`wsp-body${ws.previewPath ? '' : ' wsp-no-preview'}`}>
          <div className="wsp-tree-col">
            {loadingWs ? (
              <div className="wsp-hint">正在连接工作区…</div>
            ) : !workspaceId ? (
              <div className="wsp-hint">未能获取工作区，请刷新重试。</div>
            ) : (
              <FileTree
                applicationId={ws.applicationId}
                workspaceId={workspaceId}
                activePath={ws.previewPath}
                refreshKey={refreshKey}
                isRoot
                onSelect={selectWorkspaceFile}
              />
            )}
          </div>

          {ws.previewPath && (
            <div className="wsp-preview-col">
              <FilePreview
                key={`${ws.previewPath}:${ws.version}`}
                applicationId={ws.applicationId}
                workspaceId={workspaceId}
                path={ws.previewPath}
                version={ws.version}
              />
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
