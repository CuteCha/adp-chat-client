/**
 * 工作区面板全局状态：消息内文件链接、产物卡片、顶部文件夹图标
 * 三个入口都通过 openWorkspace / previewFile 打开同一个右侧常驻分区（默认收起）。
 * 上下文（applicationId / conversationId）由 App 层统一注入，
 * Markdown、卡片等深层组件只需拿 path 调 previewFile 即可。
 */
import { createStore, useStoreVersion } from './store'
import { getWorkspaceId } from '../api'

export interface WorkspaceState {
  open: boolean
  applicationId: string
  conversationId: string
  /** 当前预览的文件路径（/workdir/...），空串 = 只显示目录列表 */
  previewPath: string
  /** 预览版本号：同一路径重复点击时强制重新加载 */
  version: number
  /** 文件树列表列是否显示（可单独收起） */
  treeVisible: boolean
  /** 文件预览列是否显示（可单独收起；未选中文件时该列天然不显示） */
  previewVisible: boolean
}

const store = createStore()

const state: WorkspaceState = {
  open: false,
  applicationId: '',
  conversationId: '',
  previewPath: '',
  version: 0,
  treeVisible: true,
  previewVisible: true,
}

/** WorkspaceId 缓存（会话维度），拿不到时为空串——下载/预览接口不传也能工作 */
const workspaceIdCache = new Map<string, Promise<string>>()

/** 组件内读取工作区状态（订阅变更） */
export function useWorkspace(): WorkspaceState {
  useStoreVersion(store)
  return state
}

/** App 层注入当前上下文（应用 / 会话变化时调用） */
export function setWorkspaceContext(applicationId: string, conversationId: string): void {
  if (state.applicationId === applicationId && state.conversationId === conversationId) return
  state.applicationId = applicationId
  state.conversationId = conversationId
  store.bump()
}

/** 打开右侧工作区面板（可带初始预览文件）；重新打开时两列都恢复显示 */
export function openWorkspace(path = ''): void {
  state.previewPath = path
  state.version++
  state.open = true
  state.treeVisible = true
  state.previewVisible = true
  store.bump()
}

/**
 * 从「正文产物路径 / 产物卡片预览」进入：只展示工作区的预览列，文件树列收起。
 * 顶栏「工作区」按钮走 openWorkspace()，仍保持两列都显示，不受这里影响。
 */
export function previewFile(path: string): void {
  if (!state.open) {
    openWorkspace(path)
    state.treeVisible = false
    store.bump()
    return
  }
  state.previewPath = path
  state.version++
  state.previewVisible = true
  state.treeVisible = false
  store.bump()
}

/** 选中文件：预览列被收起时点文件会自动重新展开 */
export function selectWorkspaceFile(path: string): void {
  state.previewPath = path
  state.version++
  state.previewVisible = true
  store.bump()
}

/** 单独收起 / 展开工作区里的某一列 */
export function setWorkspaceColumnVisible(column: 'tree' | 'preview', visible: boolean): void {
  if (column === 'tree') state.treeVisible = visible
  else state.previewVisible = visible
  store.bump()
}

export function closeWorkspace(): void {
  state.open = false
  state.previewPath = ''
  state.treeVisible = true
  state.previewVisible = true
  store.bump()
}

/** 懒取 WorkspaceId（带缓存与并发去重）；失败返回空串，不阻塞下载 */
export function ensureWorkspaceId(): Promise<string> {
  const { applicationId, conversationId } = state
  if (!applicationId || !conversationId) return Promise.resolve('')
  const key = `${applicationId}:${conversationId}`
  let p = workspaceIdCache.get(key)
  if (!p) {
    p = getWorkspaceId(applicationId, conversationId).catch((e) => {
      console.warn('[workspace] DescribeConversation failed', e)
      workspaceIdCache.delete(key)
      return ''
    })
    workspaceIdCache.set(key, p)
  }
  return p
}
