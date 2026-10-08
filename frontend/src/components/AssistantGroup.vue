<script setup lang="ts">
/**
 * 助手合并块：一次任务里上游会返回多条 assistant record
 * （澄清轮一条、用户澄清后继续输出又一条，中间只隔着不可见的
 * questionnaire 用户回执）。渲染层把这些连续 assistant records
 * 合并进同一个 AI 气泡 —— 视觉上就是"AI 做了一次回答，中途澄清后接着输出"。
 */
import { computed, ref, watch } from 'vue'
import type { Questionnaire, QuestionnaireAnswer, Record as RecordV2 } from '../sse/types'
import MessageContent from './MessageContent.vue'
import QuestionnaireCard from './QuestionnaireCard.vue'
import StatusLine from './StatusLine.vue'
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
  /** 本块正在执行（流式进行中且是最后一个块）→ 点踩后显示执行提示 */
  running?: boolean
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

/** 执行中提示文案：与 MessageContent 折叠块下的提示保持一致 */
const RUN_PHRASES = ['正在执行…', '正在调用工具处理…', '正在等待执行结果…', '快好了，请稍候…']

/** 末条回答带着未回答的澄清卡 → 任务挂起等用户输入，不算完成 */
const clarifying = computed(() => {
  const entry = lastEntry.value
  if (!entry?.record.RecordId) return false
  if (!clarityOf(entry.record)) return false
  return !props.questionnaireState?.[entry.record.RecordId]?.submitted
})

/** 本次会话内刚跑完（流式 → 结束）才显示"任务完成"，历史加载不显示 */
const justFinished = ref(false)
watch(
  () => props.running,
  (now, was) => {
    if (was && !now) justFinished.value = true
  },
)
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true">
            <path d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V3a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.904M6.633 10.25l-2.508.001c-.621.004-1.16.497-1.16 1.118v7.007c0 .625.516 1.124 1.141 1.124h1.527M6.633 10.25V19.5" />
          </svg>
        </button>
        <button
          :class="{ on: scores?.[lastEntry.record.RecordId] === 2 }"
          title="点踩"
          @click="emit('rate', lastEntry.record.RecordId, 2)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true">
            <path d="M17.367 13.75c-.806 0-1.533.446-2.031 1.08a9.041 9.041 0 0 1-2.861 2.4c-.723.384-1.35.956-1.653 1.715a4.498 4.498 0 0 0-.322 1.672V21a.75.75 0 0 1-.75.75 2.25 2.25 0 0 1-2.25-2.25c0-1.152.26-2.243.723-3.218.266-.558-.107-1.282-.725-1.282H4.372c-1.026 0-1.945-.694-2.054-1.715a12.003 12.003 0 0 1-.068-1.285c0-2.674 1.043-5.105 2.649-6.896.388-.434.987-.681 1.605-.681h3.479c.483 0 .964.078 1.423.23l3.114 1.04c.458.153.94.23 1.423.23h1.619M17.367 13.75l2.508-.001c.621-.004 1.16-.497 1.16-1.118V5.624c0-.625-.516-1.124-1.141-1.124h-1.527M17.367 13.75V4.5" />
          </svg>
        </button>
        <!-- 任务执行中：块尾动态提示（与折叠工具调用的提示一致） -->
        <StatusLine v-if="running" :phrases="RUN_PHRASES" class="run-hint" />
        <!-- 流已结束但等用户回答澄清卡：继续转圈 + 澄清提示 -->
        <span v-else-if="clarifying" class="wait-badge">
          <span class="wait-spin" aria-hidden="true" />
          等待澄清后继续…
        </span>
        <!-- 本次会话内刚执行完成：绿圆圈 + 任务完成 -->
        <span v-else-if="justFinished" class="done-badge">
          <span class="done-dot" aria-hidden="true" />
          任务完成
        </span>
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
  align-items: center;
}
.run-hint {
  margin-left: 6px;
}
.done-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 6px;
  color: #5b6472;
  font-size: 12px;
}
.done-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 10px;
  border-radius: 50%;
  background: #34a853;
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
  color: #2b62d9;
}
.feedback button .icon {
  width: 15px;
  height: 15px;
  display: block;
  color: #5b6472;
}
.feedback button.on .icon {
  color: #2b62d9;
}
.wait-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 6px;
  color: #9aa1ab;
  font-size: 13px;
}
.wait-spin {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  border: 2px solid #d9e2ef;
  border-top-color: #34a853;
  border-radius: 50%;
  animation: ag-spin 0.9s linear infinite;
}
@keyframes ag-spin {
  to {
    transform: rotate(360deg);
  }
}
.failed {
  margin-top: 6px;
  color: #d93026;
  font-size: 13px;
}
</style>
