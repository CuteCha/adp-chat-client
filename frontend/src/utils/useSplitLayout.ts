/**
 * 三栏布局宽度管理：左（任务历史）/ 中（对话）/ 右（工作区）。
 * - 两侧宽度可拖拽、可键盘微调，并持久化到 localStorage
 * - 中间对话区始终 flex:1 自适应
 * - 容器变窄时两侧按比例压缩，保证中间区域至少 MAIN_MIN_WIDTH
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export type SplitSide = 'history' | 'workspace'

export const SPLIT_HANDLE_WIDTH = 6
const MAIN_MIN_WIDTH = 320

const RANGES = {
  history: { min: 200, max: 420, initial: 240 },
  workspace: { min: 320, max: 900, initial: 560 },
} as const

const KEYS = {
  historyWidth: 'adp.layout.historyWidth',
  workspaceWidth: 'adp.layout.workspaceWidth',
  historyOpen: 'adp.layout.historyOpen',
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function readWidth(key: string, side: SplitSide): number {
  const raw = Number(localStorage.getItem(key))
  return Number.isFinite(raw) && raw > 0
    ? clamp(raw, RANGES[side].min, RANGES[side].max)
    : RANGES[side].initial
}

/** 默认展开历史；只在用户主动收起后记住收起状态 */
function readHistoryOpen(): boolean {
  return localStorage.getItem(KEYS.historyOpen) !== '0'
}

export function useSplitLayout(historyAvailable: boolean, workspaceVisible: boolean) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [shellWidth, setShellWidth] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(readHistoryOpen)
  const [widths, setWidths] = useState(() => ({
    history: readWidth(KEYS.historyWidth, 'history'),
    workspace: readWidth(KEYS.workspaceWidth, 'workspace'),
  }))

  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      setShellWidth(entries[0]?.contentRect.width ?? 0)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    localStorage.setItem(KEYS.historyWidth, String(widths.history))
    localStorage.setItem(KEYS.workspaceWidth, String(widths.workspace))
  }, [widths])
  useEffect(() => {
    localStorage.setItem(KEYS.historyOpen, historyOpen ? '1' : '0')
  }, [historyOpen])

  const historyShown = historyAvailable && historyOpen
  const handleCount = (historyShown ? 1 : 0) + (workspaceVisible ? 1 : 0)
  const desired = {
    history: historyShown ? widths.history : 0,
    workspace: workspaceVisible ? widths.workspace : 0,
  }
  const sum = desired.history + desired.workspace
  const available = Math.max(0, shellWidth - MAIN_MIN_WIDTH - handleCount * SPLIT_HANDLE_WIDTH)
  const scale = shellWidth > 0 && sum > 0 && sum > available ? available / sum : 1
  const effective = {
    history: Math.round(desired.history * scale),
    workspace: Math.round(desired.workspace * scale),
  }

  const startDrag = useCallback(
    (side: SplitSide, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const shell = shellRef.current
      if (!shell) return
      const rect = shell.getBoundingClientRect()
      const range = RANGES[side]
      const other =
        side === 'history'
          ? workspaceVisible
            ? effective.workspace
            : 0
          : historyShown
            ? effective.history
            : 0
      const reserved = other + MAIN_MIN_WIDTH + handleCount * SPLIT_HANDLE_WIDTH
      const max = Math.max(range.min, Math.min(range.max, rect.width - reserved))

      const onMove = (e: PointerEvent) => {
        const raw = side === 'history' ? e.clientX - rect.left : rect.right - e.clientX
        const next = Math.round(clamp(raw, range.min, max))
        setWidths((prev) => (prev[side] === next ? prev : { ...prev, [side]: next }))
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.classList.remove('app-dragging')
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      document.body.classList.add('app-dragging')
    },
    [workspaceVisible, historyShown, effective.workspace, effective.history, handleCount],
  )

  const stepWidth = useCallback((side: SplitSide, delta: number) => {
    setWidths((prev) => ({
      ...prev,
      [side]: clamp(prev[side] + delta, RANGES[side].min, RANGES[side].max),
    }))
  }, [])

  const toggleHistory = useCallback(() => setHistoryOpen((prev) => !prev), [])

  return {
    shellRef,
    historyOpen,
    toggleHistory,
    historyWidth: effective.history,
    workspaceWidth: effective.workspace,
    startDrag,
    stepWidth,
  }
}
