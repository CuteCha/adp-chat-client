/** 右侧常驻工作区分区：文件树 + 预览（不是弹出抽屉）。
 *  宽度由 App 传入并可拖拽，默认收起；顶部开关 / 消息内文件链接 /
 *  产物卡片三个入口共用 workspace store 的同一个状态。
 *  两列各带自己的头部（无跨列全局顶栏）；两列都收起即关闭整个工作区。 */
import { useEffect, useState } from 'react'
import {
  closeWorkspace,
  ensureWorkspaceId,
  selectWorkspaceFile,
  setWorkspaceColumnVisible,
  useWorkspace,
} from '../../state/workspace'
import FileTree from './FileTree'
import FilePreview from './FilePreview'
import './workspace-panel.css'

export default function WorkspacePanel({ width }: { width: number }) {
  const ws = useWorkspace()
  const [workspaceId, setWorkspaceId] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [loadingWs, setLoadingWs] = useState(false)

  const hasContext = !!ws.applicationId && !!ws.conversationId
  const showTree = ws.treeVisible
  /** 预览列需要同时满足「列未被收起」和「有选中文件」 */
  const showPreview = ws.previewVisible && !!ws.previewPath

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

  /** 收起某一列；若收起后一列都不剩，等同于收起（关闭）整个工作区 */
  function hideTree() {
    if (!showPreview) {
      closeWorkspace()
      return
    }
    setWorkspaceColumnVisible('tree', false)
  }

  function hidePreview() {
    if (!showTree) {
      closeWorkspace()
      return
    }
    setWorkspaceColumnVisible('preview', false)
  }

  if (!ws.open) return null

  return (
    <aside className="wsp-panel" style={{ width, flexBasis: width }}>
      {!hasContext ? (
        <>
          <div className="wsp-col-head">
            <span className="wsp-col-title">工作区</span>
            <div className="wsp-col-actions">
              <button className="wsp-ico-btn wsp-refresh" title="刷新" onClick={refresh}>
                ⟳
              </button>
              <button className="wsp-ico-btn" title="收起工作区" onClick={closeWorkspace}>
                ✕
              </button>
            </div>
          </div>
          <div className="wsp-empty">当前没有进行中的会话，无法读取工作区。</div>
        </>
      ) : (
        <div
          className={`wsp-body${showPreview ? '' : ' wsp-no-preview'}${showTree ? '' : ' wsp-no-tree'}`}
        >
          {showTree && (
            <div className="wsp-tree-col">
              <div className="wsp-col-head">
                <span className="wsp-col-title">工作区</span>
                <div className="wsp-col-actions">
                  {!showPreview && ws.previewPath && (
                    <button
                      className="wsp-ico-btn"
                      title="展开文件预览"
                      onClick={() => setWorkspaceColumnVisible('preview', true)}
                    >
                      ▥
                    </button>
                  )}
                  <button className="wsp-ico-btn wsp-refresh" title="刷新" onClick={refresh}>
                    ⟳
                  </button>
                  <button
                    className="wsp-ico-btn"
                    title={showPreview ? '收起文件列表' : '收起工作区'}
                    onClick={hideTree}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="wsp-col-subhead">文件</div>
              <div className="wsp-tree-scroll">
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
            </div>
          )}

          {showPreview && (
            <div className="wsp-preview-col">
              <FilePreview
                key={`${ws.previewPath}:${ws.version}`}
                applicationId={ws.applicationId}
                workspaceId={workspaceId}
                path={ws.previewPath}
                version={ws.version}
                treeVisible={showTree}
                onToggleTree={() => setWorkspaceColumnVisible('tree', !showTree)}
                onClose={hidePreview}
                closeTitle={showTree ? '收起文件预览' : '收起工作区'}
              />
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
