<script setup lang="ts">
/**
 * 反问澄清卡片（四种状态）：
 *   待澄清 —— 未提交且未过期，展示可交互题目
 *   已澄清 —— 已提交/跳过，折叠为「已澄清 N 个问题」摘要
 *   已过期 —— 未提交但用户已发起新一轮对话，只读且不可提交
 * 「其他」选项由前端追加，提交时用用户输入文本替代其 label。
 */
import { computed, ref, watch } from 'vue'
import type { Questionnaire, QuestionnaireAnswer, QuestionnaireSubmitItem } from '../sse/types'
import {
  OTHER_LABEL,
  buildDefaultAnswers,
  buildQuestionnairePayload,
  buildSubmitAnswers,
  buildSummaryItems,
  countAnswered,
  hasSubsequentUserRecord,
  normalizeQuestionnaire,
} from '../utils/questionnaire'

const props = defineProps<{
  raw: Questionnaire
  records: Array<{ Role?: string }>
  index: number
  localAnswers?: QuestionnaireAnswer[] | null
  localSubmitted?: boolean
}>()
const emit = defineEmits<{
  (e: 'submit', payload: Questionnaire, answers: QuestionnaireAnswer[]): void
  (e: 'skip'): void
}>()

const normalized = computed(() => normalizeQuestionnaire(props.raw))

/** 历史回显也算已提交：上游会把答案放进 Answers */
const answeredInHistory = computed(() => (normalized.value?.answers.length ?? 0) > 0)
const submitted = computed(
  () => props.localSubmitted || answeredInHistory.value || (!!props.localAnswers && props.localAnswers.length > 0),
)
const expired = computed(() => hasSubsequentUserRecord(props.records, props.index) && !submitted.value)

/** questionId → 选中的选项下标（含末尾前端追加的「其他」） */
const selections = ref<Record<number, number[]>>({})
const otherText = ref<Record<number, string>>({})
const isOpen = ref(true)

// 历史回显：把 Answers 反查成下标，作为卡片初值
watch(
  normalized,
  (value) => {
    if (!value) return
    if (props.localAnswers?.length || answeredInHistory.value) return
    const defaults = buildDefaultAnswers(value, false)
    for (const answer of defaults) {
      if (answer.questionId === -1) continue
      selections.value[answer.questionId] = answer.selectedIndices ?? [answer.selectedIndex!]
    }
  },
  { immediate: true },
)

const questions = computed(() => normalized.value?.questions ?? [])
const answeredCount = computed(() =>
  countAnswered(normalized.value, {
    localAnswers: props.localAnswers,
    isExpired: expired.value,
    isSubmitted: submitted.value,
  }),
)
const summaryItems = computed(() => buildSummaryItems(normalized.value, '跳过', props.localAnswers))
const canSubmit = computed(() =>
  questions.value.every((q) => {
    const selected = selections.value[q.id] ?? []
    if (!selected.length) return !q.required
    return selected.every((idx) => idx !== otherIndex(q) || (otherText.value[q.id] ?? '').trim())
  }),
)

function otherIndex(q: { options: unknown[] }): number {
  return q.options.length
}
function isOther(q: { options: unknown[] }, idx: number): boolean {
  return idx === otherIndex(q)
}
/** 选项列表 + 前端追加的「其他」 */
function withOther(q: { options: { label: string; description: string }[] }) {
  return [...q.options, { label: OTHER_LABEL, description: '' }]
}
function optionLabel(q: { options: { label: string }[] }, idx: number): string {
  return isOther(q, idx) ? OTHER_LABEL : q.options[idx]?.label ?? ''
}
function toggle(q: { id: number; type: 1 | 2; options: unknown[] }, idx: number) {
  if (submitted.value || expired.value) return
  const current = selections.value[q.id] ?? []
  if (q.type === 2) {
    selections.value[q.id] = current.includes(idx)
      ? current.filter((i) => i !== idx)
      : [...current, idx]
  } else {
    selections.value[q.id] = current[0] === idx ? [] : [idx]
  }
  if (!isOther(q, idx)) otherText.value[q.id] = ''
}
/** 下标 → 上行文案：选「其他」时用用户输入替代 label */
function resolveLabel(q: { id: number; options: { label: string }[] }, idx: number): string {
  return isOther(q, idx) ? (otherText.value[q.id] ?? '').trim() || OTHER_LABEL : q.options[idx]?.label ?? ''
}

function submit() {
  if (!canSubmit.value || submitted.value || expired.value) return
  const items: QuestionnaireSubmitItem[] = questions.value
    .map((q) => {
      const selected = selections.value[q.id] ?? []
      return {
        questionText: q.text,
        isMulti: q.type === 2,
        selectedOption: selected.length ? resolveLabel(q, selected[0]) : '',
        selectedOptions: selected.map((idx) => resolveLabel(q, idx)),
      }
    })
    .filter((item) => item.selectedOptions.length > 0)

  const answers = buildSubmitAnswers(items)
  emit('submit', buildQuestionnairePayload(props.raw, answers), answers)
}
</script>

<template>
  <div v-if="normalized" class="clarity">
    <div class="clarity-head">
      <span class="clarity-title">{{ normalized.title }}</span>
      <span class="clarity-count">已澄清 {{ answeredCount }} 个问题</span>
      <button class="link" @click="isOpen = !isOpen">{{ isOpen ? '收起' : '展开' }}</button>
    </div>

    <div v-show="isOpen" class="clarity-body">
      <!-- 待澄清：可交互 -->
      <div v-if="!submitted && !expired">
        <div v-for="q in questions" :key="q.id" class="q">
          <div class="q-title">
            {{ q.text }}
            <span v-if="q.required" class="req">*</span>
            <span v-if="q.type === 2" class="tag">多选</span>
          </div>
          <div class="q-options">
            <button
              v-for="(opt, idx) in withOther(q)"
              :key="idx"
              class="opt"
              :class="{ active: (selections[q.id] ?? []).includes(idx) }"
              @click="toggle(q, idx)"
            >
              {{ optionLabel(q, idx) }}
              <span v-if="opt.description" class="opt-desc">{{ opt.description }}</span>
            </button>
          </div>
          <input
            v-if="(selections[q.id] ?? []).includes(otherIndex(q))"
            v-model="otherText[q.id]"
            class="other-input"
            placeholder="请输入补充内容"
          />
        </div>
        <div class="clarity-actions">
          <button class="primary" :disabled="!canSubmit" @click="submit">提交</button>
          <button class="ghost" @click="emit('skip')">跳过</button>
        </div>
      </div>

      <!-- 已澄清 / 已过期：摘要 -->
      <ul v-else class="summary">
        <li v-for="(item, i) in summaryItems" :key="i">
          <span class="summary-q">{{ item.question }}</span>
          <span class="summary-a">{{ item.answerLabel }}</span>
        </li>
        <li v-if="expired" class="expired-tip">该轮澄清已过期（用户已发起新的提问）</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.clarity {
  margin: 8px 0;
  border: 1px solid #e4e8f0;
  border-radius: 10px;
  background: #fbfcfe;
  overflow: hidden;
}
.clarity-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid #eef1f6;
  font-size: 13px;
}
.clarity-title {
  font-weight: 600;
}
.clarity-count {
  color: #7a8290;
}
.link {
  margin-left: auto;
  border: none;
  background: none;
  color: #2b62d9;
  cursor: pointer;
  font-size: 12px;
}
.clarity-body {
  padding: 10px 12px;
}
.q {
  margin-bottom: 12px;
}
.q-title {
  font-size: 13px;
  margin-bottom: 6px;
}
.req {
  color: #d93026;
}
.tag {
  margin-left: 6px;
  font-size: 11px;
  background: #eef1f6;
  color: #5b6472;
  border-radius: 3px;
  padding: 1px 6px;
}
.q-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.opt {
  border: 1px solid #dfe3ea;
  background: #fff;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.opt.active {
  border-color: #2b62d9;
  background: #f3f7ff;
  color: #2b62d9;
}
.opt-desc {
  display: block;
  font-size: 11px;
  color: #9aa1ab;
}
.other-input {
  margin-top: 6px;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dfe3ea;
  border-radius: 6px;
  padding: 6px 10px;
  font: inherit;
}
.clarity-actions {
  display: flex;
  gap: 10px;
}
.primary {
  background: #2b62d9;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 18px;
  cursor: pointer;
}
.primary:disabled {
  background: #c3cbd8;
  cursor: not-allowed;
}
.ghost {
  background: #fff;
  border: 1px solid #dfe3ea;
  border-radius: 6px;
  padding: 6px 18px;
  cursor: pointer;
}
.summary {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.summary li {
  display: flex;
  gap: 10px;
  padding: 3px 0;
}
.summary-q {
  color: #5b6472;
  flex: 0 0 auto;
  max-width: 60%;
}
.summary-a {
  color: #2b62d9;
}
.expired-tip {
  color: #9aa1ab;
  font-size: 12px;
}
</style>
