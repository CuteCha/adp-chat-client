/** 服务 B 接口封装。调试用途，X-User-Id 存在 localStorage 便于切换用户。 */

const BASE = '/api'

export const USER_ID_KEY = 'adp-debug-user-id'

export function getUserId(): string {
  return localStorage.getItem(USER_ID_KEY) || 'u1'
}

export function setUserId(userId: string): void {
  localStorage.setItem(USER_ID_KEY, userId)
}

function headers(json = true): HeadersInit {
  const h: Record<string, string> = { 'X-User-Id': getUserId() }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

/** 对话：返回原始 Response，交给 fetchSSE 逐块消费 */
export function sendMessage(body: {
  Contents: { Type: string; Text: string }[]
  ConversationId?: string
  ApplicationId?: string
}, signal?: AbortSignal): Promise<Response> {
  return fetch(`${BASE}/chat/message`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal,
  })
}

export async function fetchMessages(conversationId: string, limit = 20) {
  const res = await fetch(
    `${BASE}/chat/messages?conversation_id=${encodeURIComponent(conversationId)}&limit=${limit}`,
    { headers: headers(false) },
  )
  if (!res.ok) throw new Error(`历史消息加载失败: ${res.status}`)
  const data = await res.json()
  return data.Response as { Records: import('./sse/types').Record[]; HasMoreBefore: boolean; LastRecordId: string }
}

export async function listConversations() {
  const res = await fetch(`${BASE}/conversations`, { headers: headers(false) })
  if (!res.ok) throw new Error(`会话列表加载失败: ${res.status}`)
  return (await res.json()) as ConversationItem[]
}

export async function createConversation() {
  const res = await fetch(`${BASE}/conversations`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ Title: '新对话' }),
  })
  if (!res.ok) throw new Error(`新建会话失败: ${res.status}`)
  return (await res.json()) as ConversationItem
}

export async function deleteConversation(id: string) {
  const res = await fetch(`${BASE}/conversations/${id}`, { method: 'DELETE', headers: headers(false) })
  if (!res.ok) throw new Error(`删除会话失败: ${res.status}`)
}

export async function checkAllowed(userId: string) {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(userId)}/allowed`)
  return (await res.json()) as { user_id: string; allowed: boolean }
}

// ---------------------------------------------------------------------------
// M3 / M4：转发代理、Agent、文件、分享、反馈、引用、推荐
// ---------------------------------------------------------------------------

/** 通用腾讯云 Action 转发：POST /adp/{action} */
export async function forward(action: string, applicationId: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/adp/${action}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ApplicationId: applicationId, Payload: payload }),
  })
  if (!res.ok) throw new Error(`${action} 调用失败: ${res.status}`)
  const data = await res.json()
  const err = data?.Response?.Error
  if (err) throw new Error(err.Message || err.Code || `${action} 失败`)
  return data.Response as Record<string, any>
}

/** 幂等获取该用户在该应用下可修改的 AgentId */
export async function getAgentId(applicationId: string) {
  const res = await fetch(`${BASE}/agent/copy`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ApplicationId: applicationId }),
  })
  if (!res.ok) throw new Error(`获取 AgentId 失败: ${res.status}`)
  return ((await res.json()).Response as { AgentId: string }).AgentId
}

/** 文件上传：请求体为原始字节 */
export async function uploadFile(file: File, applicationId: string, mode = 'standard') {
  const h = headers() as Record<string, string>
  h['Content-Type'] = file.type || 'application/octet-stream'
  const query = new URLSearchParams({
    ApplicationId: applicationId,
    Type: file.type || 'application/octet-stream',
    Mode: mode,
  })
  const res = await fetch(`${BASE}/file/upload?${query}`, { method: 'POST', headers: h, body: file })
  if (!res.ok) throw new Error(`上传失败: ${res.status}`)
  return (await res.json()) as { Url: string; CosUrl: string; CosBucket: string }
}

/** 实时文档解析 SSE：返回原始 Response，由调用方逐行读取取 doc_id */
export function parseFile(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE}/file/parse`, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
}

export async function createShare(applicationId: string, conversationId: string, records: unknown[], title = '') {
  const res = await fetch(`${BASE}/share/create`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ApplicationId: applicationId, ConversationId: conversationId, Records: records, Title: title }),
  })
  if (!res.ok) throw new Error(`创建分享失败: ${res.status}`)
  return ((await res.json()).Response as { Id: string }).Id
}

/** 分享读取：不带 X-User-Id（分享链接是给外部看的） */
export async function getShare(shareId: string) {
  const res = await fetch(`${BASE}/share/${encodeURIComponent(shareId)}`)
  if (!res.ok) throw new Error('分享不存在或已删除')
  return (await res.json()).Response as {
    ApplicationId?: string | null
    Title?: string
    ConversationId?: string | null
    Records: import('./sse/types').Record[]
    CreatedAt: number
  }
}

export async function rateMessage(applicationId: string, recordId: string, score: number) {
  const res = await fetch(`${BASE}/feedback/rate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ApplicationId: applicationId, RecordId: recordId, Score: score }),
  })
  if (!res.ok) throw new Error(`反馈失败: ${res.status}`)
}

export async function fetchReferenceDetails(applicationId: string, referenceIds: string[]) {
  const res = await fetch(`${BASE}/reference/detail`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ApplicationId: applicationId, ReferenceIds: referenceIds }),
  })
  if (!res.ok) throw new Error(`引用详情加载失败: ${res.status}`)
  return ((await res.json()).References ?? []) as Array<Record<string, any>>
}

export async function fetchSuggestions() {
  const res = await fetch(`${BASE}/suggestions`, { headers: headers(false) })
  if (!res.ok) return []
  const data = await res.json()
  return ((data.Response?.GroupList ?? []) as Array<{
    GroupId?: string
    Name?: string
    IconUrl?: string
    SuggestionList?: Array<{ SuggestionId?: string; Title?: string; PromptContent?: string }>
  }>)
}

/** 应用列表（ApplicationId / Name / Pattern） */
export async function listApplications() {
  try {
    const res = await fetch(`${BASE}/application/list`, { headers: headers(false) })
    if (!res.ok) return []
    return (await res.json()) as Array<{
      ApplicationId: string
      Name?: string
      Pattern?: string | null
      Avatar?: string
      Greeting?: string
    }>
  } catch {
    return []
  }
}

export interface ConversationItem {
  Id: string
  UserId: string
  ApplicationId?: string | null
  Title: string
  LastActiveAt: number
  CreatedAt: number
}
