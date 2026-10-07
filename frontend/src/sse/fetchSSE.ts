/**
 * SSE 解析层 —— 从 model/sseRequest-reasoning.ts 原样搬运（axios → 原生 fetch + AbortController）。
 *
 * chunkSplitter 是关键：上游按字节推送，一个 chunk 可能包含多行或半行，
 * 且可能从 UTF-8 多字节字符中间切断，必须按字节缓冲后再解码。
 */

import type { SseEvent, ErrorEvent } from './types'

export interface FetchSSEOptions {
  success: (event: SseEvent) => void
  fail?: (msg?: unknown, errorEvent?: ErrorEvent) => void
  complete?: (isOk: boolean, msg?: string) => void
}

export const fetchSSE = async (
  fetchFn: () => Promise<Response>,
  options: FetchSSEOptions,
): Promise<void> => {
  const { success, fail, complete } = options
  try {
    const res = await fetchFn()
    if (!res.ok || !res.body) {
      const msg = `请求失败: ${res.status}`
      fail?.(msg)
      complete?.(false, msg)
      return
    }
    for await (const line of chunkSplitter(res.body)) {
      if (!line.startsWith('data:')) {
        continue // 心跳注释帧 ': ping' 在此被忽略
      }
      const payload = line.slice('data:'.length).trim()
      if (!payload || payload === '[DONE]') {
        continue
      }
      let event: SseEvent
      try {
        event = JSON.parse(payload) as SseEvent
      } catch {
        continue
      }
      if (event.Type === 'ping') {
        continue // 数据帧形式的保活事件
      }
      if (event.Type === 'error') {
        fail?.(event.Error?.Message, event)
        complete?.(false, event.Error?.Message)
        return
      }
      success(event)
    }
  } catch (err) {
    // 点「停止」触发 abort 时也会走到这里
    fail?.(err)
    complete?.(false, err instanceof Error ? err.message : undefined)
    return
  }
  complete?.(true)
}

export async function* chunkSplitter(src: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  let buffer = new Uint8Array(0)
  const textDecoder = new TextDecoder('utf-8')
  const newlineChar = '\n'.charCodeAt(0)
  const reader = src.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      const newBuffer = new Uint8Array(buffer.length + value.length)
      newBuffer.set(buffer)
      newBuffer.set(value, buffer.length)
      buffer = newBuffer

      let lineStart = 0
      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] === newlineChar) {
          const line = textDecoder.decode(buffer.slice(lineStart, i)).trim()
          if (line) yield line
          lineStart = i + 1
        }
      }
      buffer = buffer.slice(lineStart) // 保留半行，等待下一个 chunk
    }
    if (buffer.length > 0) {
      const line = textDecoder.decode(buffer).trim()
      if (line) yield line
    }
  } finally {
    reader.releaseLock()
  }
}
