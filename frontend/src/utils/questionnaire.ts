/**
 * 反问澄清（questionnaire）协议适配层。
 *
 * 从 utils/questionnaire.ts 精简而来，保留与线上完全一致的三件事：
 *   1. 把后端结构归一化为渲染层可用的结构（Index/Question/Label → id/text/label）
 *   2. 历史回显：用「问题文本 + 选项文案」反查下标（同一题重复 label 时命中首个）
 *   3. 构造上行内容体：Answers 优先 clear，单选也统一为长度 1 的数组
 *
 * 「其他」选项由前端追加（后端不下发），提交时用用户输入的文本替代其 label。
 */

import type {
  Content,
  NormalizedQuestionnaire,
  NormalizedQuestionnaireOption,
  NormalizedQuestionnaireQuestion,
  Questionnaire,
  QuestionnaireAnswer,
  QuestionnaireDefaultAnswer,
  QuestionnaireOption,
  QuestionnaireSubmitItem,
  QuestionnaireSummaryItem,
} from '../sse/types'

export const QUESTIONNAIRE_CONTENT_TYPE = 'questionnaire'
export const OTHER_LABEL = '其他'

function pick<K extends string>(
  obj: Record<string, any> | undefined,
  ...keys: K[]
): any {
  if (!obj) return undefined
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k]
  }
  return undefined
}

/** 从 Contents 中取出澄清内容体 */
export function pickQuestionnaireContent(contents?: Content[]): Questionnaire | null {
  if (!contents?.length) return null
  const item = contents.find((c) => c?.Type === QUESTIONNAIRE_CONTENT_TYPE)
  return item?.Questionnaire ?? null
}

function readOptionLabel(option: QuestionnaireOption): string {
  return option.Label ?? option.label ?? ''
}

function readOptionDescription(option: QuestionnaireOption): string {
  return option.Description ?? option.description ?? ''
}

export function readSelectedLabels(answer: QuestionnaireAnswer): string[] {
  return answer.SelectedLabels ?? answer.selected_labels ?? answer.selectedLabels ?? []
}

export function readAnswerQuestion(answer: QuestionnaireAnswer): string {
  return answer.Question ?? answer.question ?? ''
}

export function isMultipleChoice(question: { type: 1 | 2 }): boolean {
  return question.type === 2
}

export function normalizeQuestionnaire(
  questionnaire: Questionnaire | null | undefined,
  fallbackTitle = '问题澄清',
): NormalizedQuestionnaire | null {
  if (!questionnaire) return null
  const raw = questionnaire as Record<string, any>
  const rawQuestions = pick(raw, 'Questions', 'questions') ?? []
  const rawAnswers = pick(raw, 'Answers', 'answers') ?? []
  const title = pick(raw, 'Title', 'title')

  const questions: NormalizedQuestionnaireQuestion[] = rawQuestions.map(
    (item: Record<string, any>, idx: number) => {
      const options: NormalizedQuestionnaireOption[] = (
        pick(item, 'Options', 'options') ?? []
      ).map((opt: QuestionnaireOption) => ({
        label: readOptionLabel(opt),
        description: readOptionDescription(opt),
      }))
      return {
        id: pick(item, 'Index', 'index') ?? idx,
        text: pick(item, 'Question', 'question') ?? '',
        type: pick(item, 'Type', 'type') ?? 1,
        required: pick(item, 'Required', 'required'),
        options,
      }
    },
  )

  return { title: title || fallbackTitle, questions, answers: rawAnswers }
}

/** 历史回显：把 answers 反查成下标形式 */
export function buildDefaultAnswers(
  normalized: NormalizedQuestionnaire | null,
  isSubmitted: boolean,
): QuestionnaireDefaultAnswer[] {
  if (!normalized) return []
  const { questions, answers } = normalized

  // 已提交但无答案（跳过场景）：用占位数据让卡片进入已提交态
  if (isSubmitted && !answers.length) return [{ questionId: -1, selectedIndex: -1 }]
  if (!answers.length) return []

  const result: QuestionnaireDefaultAnswer[] = []
  for (const answer of answers) {
    const selectedLabels = readSelectedLabels(answer)
    if (!selectedLabels.length) continue
    const question = questions.find((q) => q.text === readAnswerQuestion(answer))
    if (!question) continue

    if (isMultipleChoice(question)) {
      const selectedIndices = selectedLabels
        .map((label) => question.options.findIndex((opt) => opt.label === label))
        .filter((idx) => idx !== -1)
      if (selectedIndices.length) result.push({ questionId: question.id, selectedIndices })
      continue
    }
    const selectedIndex = question.options.findIndex(
      (opt) => opt.label === selectedLabels[0],
    )
    if (selectedIndex !== -1) result.push({ questionId: question.id, selectedIndex })
  }
  return result
}

/** 上行容忍的结果转换为 Answers */
export function buildSubmitAnswers(items: QuestionnaireSubmitItem[]): QuestionnaireAnswer[] {
  return items.map((item) => ({
    Question: item.questionText,
    SelectedLabels: item.isMulti ? item.selectedOptions ?? [] : [item.selectedOption],
  }))
}

/** 构造上行内容体：保留原始字段，仅替换 Answers */
export function buildQuestionnairePayload(
  raw: Questionnaire,
  answers: QuestionnaireAnswer[],
): Questionnaire {
  const rawRecord = raw as Record<string, any>
  const payload: Record<string, any> = { ...rawRecord, Answers: answers }
  if ('answers' in rawRecord) payload.answers = answers
  if ('SelectedLabels' in rawRecord) delete payload.SelectedLabels
  return payload as Questionnaire
}

export function countAnswered(
  normalized: NormalizedQuestionnaire | null,
  options: { localAnswers?: QuestionnaireAnswer[] | null; isExpired?: boolean; isSubmitted?: boolean } = {},
): number {
  if (!normalized) return 0
  const { localAnswers, isExpired = false, isSubmitted = false } = options
  if (isExpired && !isSubmitted) return 0
  return (localAnswers ?? normalized.answers ?? []).length
}

export function buildSummaryItems(
  normalized: NormalizedQuestionnaire | null,
  skippedLabel: string,
  localAnswers?: QuestionnaireAnswer[] | null,
): QuestionnaireSummaryItem[] {
  if (!normalized) return []
  const answers = localAnswers ?? normalized.answers
  if (!answers?.length) {
    return normalized.questions.map((q) => ({ question: q.text, answerLabel: skippedLabel }))
  }
  return answers.map((answer) => ({
    question: readAnswerQuestion(answer),
    answerLabel: readSelectedLabels(answer).join('、'),
  }))
}

/** 该 Record 之后是否已有新一轮用户输入（澄清已过期） */
export function hasSubsequentUserRecord(list: Array<{ Role?: string }>, index: number): boolean {
  for (let i = index + 1; i < list.length; i++) {
    if (list[i]?.Role === 'user') return true
  }
  return false
}

/** 历史回显里，紧邻的下一条用户消息是否为「跳过」 */
export function isHistoryQuestionnaireSkipped(
  list: Array<{ Role?: string; Messages?: Array<{ Type?: string; Contents?: Content[] }> }>,
  index: number,
  skipText = '跳过',
): boolean {
  const text = (skipText || '跳过').trim()
  for (let i = index + 1; i < list.length; i++) {
    const next = list[i]
    if (next?.Role !== 'user') continue
    const messages = next.Messages ?? []
    const primary = messages.find((m) => m.Type === 'question') ?? messages[0]
    const contents = primary?.Contents ?? []
    if (!contents.length) return false
    for (const c of contents) {
      if (c.Type === 'text') return (c.Text ?? '').trim() === text
      return false
    }
    return false
  }
  return false
}

/** 纯 questionnaire 的用户回放消息：整条隐藏（答案已体现在助手的摘要卡里） */
export function isQuestionnaireAnswerRecord(record: { Role?: string; Messages?: Array<{ Contents?: Content[] }> }): boolean {
  if (record?.Role !== 'user') return false
  const contents = record.Messages?.[0]?.Contents
  if (!contents?.length) return false
  let hasQuestionnaire = false
  for (const content of contents) {
    if (content.Type === QUESTIONNAIRE_CONTENT_TYPE) {
      hasQuestionnaire = true
      continue
    }
    if (content.Type === 'text' && !content.Text) continue
    return false
  }
  return hasQuestionnaire
}
