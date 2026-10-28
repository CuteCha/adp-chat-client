/**
 * 工作区面板全局状态：消息内文件链接、产物卡片、顶部文件夹图标
 * 三个入口都通过 openWorkspace / previewFile 打开同一个右侧面板。
 * 上下文（applicationId / conversationId）由 App 层统一注入，
 * Markdown、卡片等深层组件只需拿 path 调 previewFile 即可。
 */
import { reactive } from 'vue'
import { getWorkspaceId } from '../api'

interface WorkspaceState {
  open: boolean
  applicationId: string
  conversationId: string
  /** 当前预览的文件路径（/workdir/...），空串 = 只显示目录列表 */
  previewPath: string
  /** 预览版本号：同一路径重复点击时强制重新加载 */
  version: number
}

const state = reactive<WorkspaceState>({
  open: false,
  applicationId: '',
  conversationId: '',
  previewPath: '',
  version: 0,
})

/** WorkspaceId 缓存（会话维度），拿不到时为空串——下载/预览接口不传也能工作 */
const workspaceIdCache = new Map<string, Promise<string>>()

export function useWorkspace() {
  return state
}

/** App 层注入当前上下文（应用 / 会话变化时调用） */
export function setWorkspaceContext(applicationId: string, conversationId: string): void {
  state.applicationId = applicationId
  state.conversationId = conversationId
}

/** 打开右侧工作区面板（可带初始预览文件） */
export function openWorkspace(path = ''): void {
  state.previewPath = path
  state.version++
  state.open = true
}

/** 在面板中预览指定文件；面板未开则先打开 */
export function previewFile(path: string): void {
  if (!state.open) {
    openWorkspace(path)
    return
  }
  state.previewPath = path
  state.version++
}

export function closeWorkspace(): void {
  state.open = false
  state.previewPath = ''
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
