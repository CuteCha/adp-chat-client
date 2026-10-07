<script setup lang="ts">
/**
 * 用户气泡：文本 + 附件。
 * 助手记录由 AssistantGroup 渲染（多条合并为一个 AI 块）。
 */
import { computed } from 'vue'
import type { Content, Record as RecordV2 } from '../sse/types'
import Markdown from './Markdown.vue'
import { isUserRecordInvisible } from '../utils/record'

const props = defineProps<{
  record: RecordV2
}>()

const messages = computed(() => props.record.Messages ?? [])

/** 用户只渲染 question 消息（没有则退回第一条） */
const question = computed(() => {
  const msgs = messages.value
  return msgs.find((m) => m.Type === 'question') ?? msgs[0]
})

const userText = computed(() => {
  const msg = question.value
  return (msg?.Contents ?? []).filter((c) => c.Type === 'text').map((c) => c.Text ?? '').join('')
})

const attachments = computed<NonNullable<Content['File']>[]>(() => {
  return (question.value?.Contents ?? [])
    .filter((c) => c.Type === 'file' && c.File)
    .map((c) => c.File!)
})
</script>

<template>
  <div v-if="!isUserRecordInvisible(record)" class="record user">
    <div class="avatar">我</div>
    <div class="bubble">
      <Markdown v-if="userText" :source="userText" />
      <div v-if="attachments.length" class="files">
        <a
          v-for="(file, i) in attachments"
          :key="i"
          class="file-pill"
          :href="file.FileUrl"
          target="_blank"
          rel="noreferrer"
        >
          {{ file.FileName }}
        </a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.record {
  display: flex;
  gap: 12px;
  padding: 8px 0;
}
.record.user {
  flex-direction: row-reverse;
}
.avatar {
  flex: 0 0 32px;
  height: 32px;
  border-radius: 8px;
  background: #2b62d9;
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bubble {
  max-width: 78%;
  background: #f3f7ff;
  border: 1px solid #dbe6ff;
  border-radius: 10px;
  padding: 10px 14px;
  min-width: 0;
}
.files {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.file-pill {
  font-size: 12px;
  background: #eef3ff;
  border: 1px solid #dbe6ff;
  border-radius: 4px;
  padding: 2px 8px;
  color: #2b62d9;
  text-decoration: none;
}
</style>
