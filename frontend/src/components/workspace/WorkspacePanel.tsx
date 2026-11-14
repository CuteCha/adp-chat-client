/** 右侧常驻工作区分区：文件树 + 预览（不是弹出抽屉）。
 *  宽度由 App 传入并可拖拽，默认收起；顶部开关 / 消息内文件链接 /
 *  产物卡片三个入口共用 workspace store 的同一个状态。
 *  内部两列（文件树列表 / 文件预览）可各自单独收起，收起后另一列占满。 */
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

  if (!ws.open) return null

  return (
    <aside className="wsp-panel" style={{ width, flexBasis: width }}>
      <header className="wsp-head">
        {!showTree && (
          <button
            className="wsp-ico-btn"
            title="展开文件列表"
            onClick={() => setWorkspaceColumnVisible('tree', true)}
          >
            ▤
          </button>
        )}
        {!showPreview && ws.previewPath && (
          <button
            className="wsp-ico-btn"
            title="展开文件预览"
            onClick={() => setWorkspaceColumnVisible('preview', true)}
          >
            ▥
          </button>
        )}
        <span className="wsp-title">工作区</span>
        <button className="wsp-ico-btn" title="刷新" onClick={refresh}>
          ⟳
        </button>
        <button className="wsp-ico-btn" title="收起工作区" onClick={closeWorkspace}>
          ✕
        </button>
      </header>

      {!hasContext ? (
        <div className="wsp-empty">当前没有进行中的会话，无法读取工作区。</div>
      ) : (
        <div
          className={`wsp-body${showPreview ? '' : ' wsp-no-preview'}${showTree ? '' : ' wsp-no-tree'}`}
        >
          {showTree && (
            <div className="wsp-tree-col">
              <div className="wsp-col-head">
                <span>文件</span>
                <button
                  className="wsp-ico-btn"
                  title="收起文件列表"
                  onClick={() => setWorkspaceColumnVisible('tree', false)}
                >
                  ✕
                </button>
              </div>
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
                onShowTree={showTree ? undefined : () => setWorkspaceColumnVisible('tree', true)}
                onClose={() => setWorkspaceColumnVisible('preview', false)}
              />
            </div>
          )}

          {!showTree && !showPreview && (
            <div className="wsp-empty wsp-cols-closed">
              两列都已收起
              <button
                className="wsp-empty-btn"
                onClick={() => setWorkspaceColumnVisible('tree', true)}
              >
                展开文件列表
              </button>
              {ws.previewPath && (
                <button
                  className="wsp-empty-btn"
                  onClick={() => setWorkspaceColumnVisible('preview', true)}
                >
                  展开文件预览
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
