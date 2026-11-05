/** 执行中动态提示：转圈 + 轮播文案，避免长时间无可见输出时"看似卡住" */
import { useEffect, useState } from 'react'
import './status-line.css'

/** 默认轮播文案 */
export const DEFAULT_PHRASES = [
  '我先把目标捋顺，马上开工…',
  '正在翻翻上下文，看看你真正需要什么…',
  '正在整理思路，组织答案…',
  '正在检索相关资料…',
  '正在生成内容，请稍候…',
]

export default function StatusLine({
  phrases = DEFAULT_PHRASES,
  interval = 4000,
  className = '',
}: {
  phrases?: string[]
  interval?: number
  className?: string
}) {
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIdx((prev) => (prev + 1) % phrases.length)
    }, interval)
    return () => window.clearInterval(timer)
  }, [phrases.length, interval])

  return (
    <div className={`status-line ${className}`.trim()}>
      <span className="status-spinner" aria-hidden="true" />
      <span className="status-text">{phrases[idx]}</span>
    </div>
  )
}
