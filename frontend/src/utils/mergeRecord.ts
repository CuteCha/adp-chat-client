/**
 * 归约层 —— 从 utils/mergeRecord-v2.ts 原样搬运（去掉 widget/questionnaire 相关分支）。
 * 纯函数：把单个 SSE 事件合并进 Record，供流式增量渲染使用。
 */

import type { Content, Message, Record, SseEvent } from '../sse/types'

export function applySseEventToRecord(event: SseEvent, current?: Record): Record | undefined {
  switch (event.Type) {
    case 'request_ack':
      return mergeRecord(current, event.RequestAck, true)
    case 'response.created':
    case 'response.processing':
    case 'response.completed':
      return mergeRecord(current, event.Response, event.Type === 'response.completed')
    case 'message.added':
      return upsertMessage(current, event.Message)
    case 'message.processing':
    case 'message.done':
      return upsertMessage(current, event.Message)
    case 'content.added':
      return addContent(current, event.MessageId, event.ContentIndex, event.Content)
    case 'reference.added':
      return addReference(current, event.MessageId, event.ContentIndex, event.Reference)
    case 'text.delta':
      return appendTextDelta(current, event.MessageId, event.ContentIndex, event.Text)
    default:
      return current
  }
}

function mergeRecord(current: Record | undefined, incoming: Record, replaceMessages: boolean): Record {
  const merged: Record = { ...(current ?? incoming), ...incoming }
  if (incoming.Messages === undefined && current?.Messages) {
    merged.Messages = current.Messages
  } else if (replaceMessages && incoming.Messages !== undefined) {
    merged.Messages = incoming.Messages
  }
  if (incoming.Procedures === undefined && current?.Procedures) merged.Procedures = current.Procedures
  if (incoming.StatInfo === undefined && current?.StatInfo) merged.StatInfo = current.StatInfo
  if (incoming.ExtraInfo === undefined && current?.ExtraInfo) merged.ExtraInfo = current.ExtraInfo
  return merged
}

function upsertMessage(current: Record | undefined, incoming: Message): Record | undefined {
  if (!current) return undefined
  const messages = current.Messages ? [...current.Messages] : []
  const idx = messages.findIndex((msg) => msg.MessageId === incoming.MessageId)
  if (idx === -1) {
    messages.push(incoming)
  } else {
    const existing = messages[idx]
    messages[idx] = {
      ...existing,
      ...incoming,
      Contents: incoming.Contents ?? existing.Contents,
      ExtraInfo: incoming.ExtraInfo
        ? { ...(existing.ExtraInfo ?? {}), ...incoming.ExtraInfo }
        : existing.ExtraInfo,
    }
  }
  return { ...current, Messages: messages }
}

function addContent(
  current: Record | undefined,
  messageId: string,
  contentIndex: number,
  content: Content,
): Record | undefined {
  if (!current) return undefined
  const { message, messages, messageIndex } = ensureMessage(current, messageId)
  if (!message) return { ...current, Messages: messages }
  const contents = message.Contents ? [...message.Contents] : []
  const existing = contents[contentIndex]
  contents[contentIndex] = existing ? { ...existing, ...content } : content
  messages[messageIndex] = { ...message, Contents: contents }
  return { ...current, Messages: messages }
}

function appendTextDelta(
  current: Record | undefined,
  messageId: string,
  contentIndex: number,
  text: string,
): Record | undefined {
  if (!current) return undefined
  const { message, messages, messageIndex } = ensureMessage(current, messageId)
  if (!message) return { ...current, Messages: messages }
  const contents = message.Contents ? [...message.Contents] : []
  const base: Content = contents[contentIndex] ?? { Type: 'text', Text: '' }
  contents[contentIndex] = { ...base, Text: (base.Text ?? '') + text }
  messages[messageIndex] = { ...message, Contents: contents }
  return { ...current, Messages: messages }
}

function addReference(
  current: Record | undefined,
  messageId: string,
  contentIndex: number,
  reference: NonNullable<Content['References']>[number],
): Record | undefined {
  if (!current) return undefined
  const { message, messages, messageIndex } = ensureMessage(current, messageId)
  if (!message) return { ...current, Messages: messages }
  const contents = message.Contents ? [...message.Contents] : []
  const base: Content = contents[contentIndex] ?? { Type: 'text', Text: '' }
  contents[contentIndex] = { ...base, References: upsertReference(base.References ?? [], reference) }
  messages[messageIndex] = { ...message, Contents: contents }
  return { ...current, Messages: messages }
}

function ensureMessage(current: Record, messageId: string) {
  const messages = current.Messages ? [...current.Messages] : []
  let messageIndex = messages.findIndex((msg) => msg.MessageId === messageId)
  if (messageIndex === -1) {
    messages.push({
      MessageId: messageId,
      Type: 'notice',
      Name: '',
      Title: '',
      Status: 'processing',
      StatusDesc: '',
      Contents: [],
    })
    messageIndex = messages.length - 1
  }
  return { message: messages[messageIndex], messages, messageIndex }
}

function upsertReference(references: NonNullable<Content['References']>, incoming: NonNullable<Content['References']>[number]) {
  const next = [...references]
  const key = referenceKey(incoming)
  const idx = next.findIndex((r) => referenceKey(r) === key)
  if (idx === -1) {
    next.push(incoming)
  } else {
    next[idx] = { ...next[idx], ...incoming }
  }
  return next
}

function referenceKey(reference: NonNullable<Content['References']>[number]): string {
  return (
    reference.Id ||
    reference.DocRefer?.ReferBizId ||
    reference.QaRefer?.ReferBizId ||
    reference.Url ||
    `${reference.Index ?? ''}:${reference.Name ?? ''}`
  )
}
