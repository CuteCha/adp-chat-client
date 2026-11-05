/**
 * 反问澄清卡片（四种状态）：
 *   待澄清 —— 未提交且未过期，展示可交互题目
 *   已澄清 —— 已提交/跳过，折叠为「已澄清 N 个问题」摘要
 *   已过期 —— 未提交但用户已发起新一轮对话，只读且不可提交
 * 「其他」选项由前端追加，提交时用用户输入文本替代其 label。
 */
import { useEffect, useMemo, useState } from 'react'
import type {
  NormalizedQuestionnaireQuestion,
  Questionnaire,
  QuestionnaireAnswer,
  QuestionnaireSubmitItem,
} from '../sse/types'
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
import './questionnaire-card.css'

type OptionShape = { label: string; description: string }

function otherIndex(q: { options: unknown[] }): number {
  return q.options.length
}
function isOther(q: { options: unknown[] }, idx: number): boolean {
  return idx === otherIndex(q)
}
/** 选项列表 + 前端追加的「其他」 */
function withOther(q: { options: OptionShape[] }): OptionShape[] {
  return [...q.options, { label: OTHER_LABEL, description: '' }]
}
function optionLabel(q: { options: OptionShape[] }, idx: number): string {
  return isOther(q, idx) ? OTHER_LABEL : q.options[idx]?.label ?? ''
}

export default function QuestionnaireCard({
  raw,
  records,
  index,
  localAnswers,
  localSubmitted,
  onSubmit,
  onSkip,
}: {
  raw: Questionnaire
  records: Array<{ Role?: string }>
  index: number
  localAnswers?: QuestionnaireAnswer[] | null
  localSubmitted?: boolean
  onSubmit: (payload: Questionnaire, answers: QuestionnaireAnswer[]) => void
  onSkip: () => void
}) {
  const normalized = useMemo(() => normalizeQuestionnaire(raw), [raw])

  /** 历史回显也算已提交：上游会把答案放进 Answers */
  const answeredInHistory = (normalized?.answers.length ?? 0) > 0
  const submitted = !!localSubmitted || answeredInHistory || (!!localAnswers && localAnswers.length > 0)
  const expired = hasSubsequentUserRecord(records, index) && !submitted

  /** questionId → 选中的选项下标（含末尾前端追加的「其他」） */
  const [selections, setSelections] = useState<Record<number, number[]>>({})
  const [otherText, setOtherText] = useState<Record<number, string>>({})
  const [isOpen, setIsOpen] = useState(true)

  // 历史回显：把 Answers 反查成下标，作为卡片初值
  useEffect(() => {
    const value = normalized
    if (!value) return
    if (localAnswers?.length || answeredInHistory) return
    const defaults = buildDefaultAnswers(value, false)
    if (!defaults.length) return
    setSelections((prev) => {
      const next = { ...prev }
      for (const answer of defaults) {
        if (answer.questionId === -1) continue
        next[answer.questionId] = answer.selectedIndices ?? [answer.selectedIndex!]
      }
      return next
    })
  }, [normalized, localAnswers, answeredInHistory])

  if (!normalized) return null

  const questions = normalized.questions
  const answeredCount = countAnswered(normalized, {
    localAnswers,
    isExpired: expired,
    isSubmitted: submitted,
  })
  const summaryItems = buildSummaryItems(normalized, '跳过', localAnswers)
  const canSubmit = questions.every((q) => {
    const selected = selections[q.id] ?? []
    if (!selected.length) return !q.required
    return selected.every((idx) => idx !== otherIndex(q) || (otherText[q.id] ?? '').trim())
  })

  function toggle(q: NormalizedQuestionnaireQuestion, idx: number) {
    if (submitted || expired) return
    const current = selections[q.id] ?? []
    const next =
      q.type === 2
        ? current.includes(idx)
          ? current.filter((i) => i !== idx)
          : [...current, idx]
        : current[0] === idx
          ? []
          : [idx]
    setSelections((prev) => ({ ...prev, [q.id]: next }))
    if (!isOther(q, idx)) setOtherText((prev) => ({ ...prev, [q.id]: '' }))
  }

  /** 下标 → 上行文案：选「其他」时用用户输入替代 label */
  function resolveLabel(q: NormalizedQuestionnaireQuestion, idx: number): string {
    return isOther(q, idx)
      ? (otherText[q.id] ?? '').trim() || OTHER_LABEL
      : q.options[idx]?.label ?? ''
  }

  function submit() {
    if (!canSubmit || submitted || expired) return
    const items: QuestionnaireSubmitItem[] = questions
      .map((q) => {
        const selected = selections[q.id] ?? []
        return {
          questionText: q.text,
          isMulti: q.type === 2,
          selectedOption: selected.length ? resolveLabel(q, selected[0]) : '',
          selectedOptions: selected.map((idx) => resolveLabel(q, idx)),
        }
      })
      .filter((item) => item.selectedOptions.length > 0)

    const answers = buildSubmitAnswers(items)
    onSubmit(buildQuestionnairePayload(raw, answers), answers)
  }

  return (
    <div className="qc-clarity">
      <div className="qc-head">
        <span className="qc-title">{normalized.title}</span>
        <span className="qc-count">已澄清 {answeredCount} 个问题</span>
        <button className="qc-link" onClick={() => setIsOpen((prev) => !prev)}>
          {isOpen ? '收起' : '展开'}
        </button>
      </div>

      {isOpen && (
        <div className="qc-body">
          {/* 待澄清：可交互 */}
          {!submitted && !expired ? (
            <div>
              {questions.map((q) => (
                <div key={q.id} className="qc-q">
                  <div className="qc-q-title">
                    {q.text}
                    {q.required && <span className="qc-req">*</span>}
                    {q.type === 2 && <span className="qc-tag">多选</span>}
                  </div>
                  <div className="qc-options">
                    {withOther(q).map((opt, idx) => (
                      <button
                        key={idx}
                        className={`qc-opt${(selections[q.id] ?? []).includes(idx) ? ' qc-active' : ''}`}
                        onClick={() => toggle(q, idx)}
                      >
                        {optionLabel(q, idx)}
                        {opt.description && <span className="qc-opt-desc">{opt.description}</span>}
                      </button>
                    ))}
                  </div>
                  {(selections[q.id] ?? []).includes(otherIndex(q)) && (
                    <input
                      className="qc-other-input"
                      placeholder="请输入补充内容"
                      value={otherText[q.id] ?? ''}
                      onChange={(e) =>
                        setOtherText((prev) => ({ ...prev, [q.id]: e.target.value }))
                      }
                    />
                  )}
                </div>
              ))}
              <div className="qc-actions">
                <button className="qc-primary" disabled={!canSubmit} onClick={submit}>
                  提交
                </button>
                <button className="qc-ghost" onClick={onSkip}>
                  跳过
                </button>
              </div>
            </div>
          ) : (
            /* 已澄清 / 已过期：摘要 */
            <ul className="qc-summary">
              {summaryItems.map((item, i) => (
                <li key={i}>
                  <span className="qc-summary-q">{item.question}</span>
                  <span className="qc-summary-a">{item.answerLabel}</span>
                </li>
              ))}
              {expired && <li className="qc-expired-tip">该轮澄清已过期（用户已发起新的提问）</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
