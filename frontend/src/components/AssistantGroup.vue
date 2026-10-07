<script setup lang="ts">
/**
 * 助手合并块：一次任务里上游会返回多条 assistant record
 * （澄清轮一条、用户澄清后继续输出又一条，中间只隔着不可见的
 * questionnaire 用户回执）。渲染层把这些连续 assistant records
 * 合并进同一个 AI 气泡 —— 视觉上就是"AI 做了一次回答，中途澄清后接着输出"。
 */
import { computed } from 'vue'
import type { Questionnaire, QuestionnaireAnswer, Record as RecordV2 } from '../sse/types'
import MessageContent from './MessageContent.vue'
import QuestionnaireCard from './QuestionnaireCard.vue'
import { pickQuestionnaireContent } from '../utils/questionnaire'

/** 组内一条 assistant record 及其在原始 records 中的下标（澄清卡过期判断用） */
export interface AssistantEntry {
  record: RecordV2
  index: number
}

const props = defineProps<{
  entries: AssistantEntry[]
  records: Array<{ Role?: string }>
  applicationId?: string
  questionnaireState?: Record<string, { submitted: boolean; answers: QuestionnaireAnswer[] | null }>
  scores?: Record<string, number>
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'submitQuestionnaire', raw: Questionnaire, answers: QuestionnaireAnswer[], recordId: string): void
  (e: 'skipQuestionnaire', recordId: string): void
  (e: 'rate', recordId: string, score: number): void
}>()

function visibleMessages(record: RecordV2) {
  return (record.Messages ?? []).filter((m) => !pickQuestionnaireContent(m.Contents))
}

/** 该 record 中含 questionnaire 的 message（由澄清卡渲染，正文不重复展示） */
function clarityOf(record: RecordV2) {
  for (const message of record.Messages ?? []) {
    const raw = pickQuestionnaireContent(message.Contents)
    if (raw) return raw
  }
  return null
}

function failed(record: RecordV2) {
  return ['error', 'failed'].includes(record.Status)
}

/** 反馈按钮只在块尾显示一次（整个块是"一次回答"） */
const lastEntry = computed(() => props.entries[props.entries.length - 1])
</script>

<template>
  <div class="record">
    <div class="avatar">AI</div>
    <div class="bubble">
      <template v-for="entry in entries" :key="entry.record.RecordId">
        <MessageContent
          v-for="msg in visibleMessages(entry.record)"
          :key="`${entry.record.RecordId}-${msg.MessageId}`"
          :message="msg"
          :application-id="applicationId"
        />

        <QuestionnaireCard
          v-if="clarityOf(entry.record)"
          :raw="clarityOf(entry.record)!"
          :records="records"
          :index="entry.index"
          :local-answers="questionnaireState?.[entry.record.RecordId]?.answers ?? null"
          :local-submitted="questionnaireState?.[entry.record.RecordId]?.submitted ?? false"
          @submit="
            (payload, answers) => emit('submitQuestionnaire', payload, answers, entry.record.RecordId)
          "
          @skip="emit('skipQuestionnaire', entry.record.RecordId)"
        />

        <div v-if="failed(entry.record)" class="failed">
          {{ entry.record.StatusDesc || '生成失败' }}
        </div>
      </template>

      <div
        v-if="
          !readonly &&
          lastEntry &&
          lastEntry.record.RecordId &&
          lastEntry.record.RecordId !== 'placeholder-user'
        "
        class="feedback"
      >
        <button
          :class="{ on: scores?.[lastEntry.record.RecordId] === 1 }"
          title="点赞"
          @click="emit('rate', lastEntry.record.RecordId, 1)"
        >
          👍
        </button>
        <button
          :class="{ on: scores?.[lastEntry.record.RecordId] === 2 }"
          title="点踩"
          @click="emit('rate', lastEntry.record.RecordId, 2)"
        >
          👎
        </button>
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
.avatar {
  flex: 0 0 32px;
  height: 32px;
  border-radius: 8px;
  background: #eef1f6;
  color: #5b6472;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bubble {
  max-width: 78%;
  background: #fff;
  border: 1px solid #eceef2;
  border-radius: 10px;
  padding: 10px 14px;
  min-width: 0;
}
.feedback {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.feedback button {
  border: 1px solid #eceef2;
  background: #fff;
  border-radius: 6px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 13px;
}
.feedback button.on {
  border-color: #2b62d9;
  background: #f3f7ff;
}
.failed {
  margin-top: 6px;
  color: #d93026;
  font-size: 13px;
}
</style>
