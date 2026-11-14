/** 可拖拽的竖直分界线（左右方向键也能微调 20px） */
import type { KeyboardEvent, PointerEvent } from 'react'
import type { SplitSide } from '../utils/useSplitLayout'

export default function SplitHandle({
  side,
  onDrag,
  onStep,
}: {
  side: SplitSide
  onDrag: (side: SplitSide, event: PointerEvent<HTMLDivElement>) => void
  onStep: (side: SplitSide, delta: number) => void
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const dir = event.key === 'ArrowRight' ? 1 : -1
    onStep(side, side === 'history' ? dir * 20 : -dir * 20)
  }

  return (
    <div
      className="app-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整区域宽度"
      title="拖动调整区域宽度"
      tabIndex={0}
      onPointerDown={(event) => onDrag(side, event)}
      onKeyDown={onKeyDown}
    />
  )
}
