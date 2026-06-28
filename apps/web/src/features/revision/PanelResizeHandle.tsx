import { useCallback, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

type PanelResizeHandleProps = {
  ariaLabel: string
  direction: 1 | -1
  min: number
  max: number
  value: number
  onResize: (width: number) => void
  onResizeEnd: (width: number) => void
  className?: string
}

const KEYBOARD_STEP = 16
const KEYBOARD_LARGE_STEP = 48

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function PanelResizeHandle({
  ariaLabel,
  direction,
  min,
  max,
  value,
  onResize,
  onResizeEnd,
  className,
}: PanelResizeHandleProps) {
  const dragRef = useRef<{ startX: number; startValue: number; latestValue: number } | null>(null)
  const previousUserSelectRef = useRef("")

  const finishDrag = useCallback((commit: boolean) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    document.body.style.userSelect = previousUserSelectRef.current
    if (commit) onResizeEnd(drag.latestValue)
  }, [onResizeEnd])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const nextValue = clamp(drag.startValue + direction * (event.clientX - drag.startX), min, max)
      drag.latestValue = nextValue
      onResize(nextValue)
    }
    const handlePointerUp = () => finishDrag(true)
    const handlePointerCancel = () => finishDrag(false)
    const handleBlur = () => finishDrag(true)
    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("pointercancel", handlePointerCancel)
    window.addEventListener("blur", handleBlur)
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerCancel)
      window.removeEventListener("blur", handleBlur)
      finishDrag(false)
    }
  }, [direction, finishDrag, max, min, onResize])

  return (
    <div className={cn("relative z-20 w-0 shrink-0", className)}>
      <div
        role="separator"
        aria-label={ariaLabel}
        aria-orientation="vertical"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value)}
        tabIndex={0}
        className="group absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none"
        onPointerDown={(event) => {
          event.preventDefault()
          previousUserSelectRef.current = document.body.style.userSelect
          document.body.style.userSelect = "none"
          dragRef.current = { startX: event.clientX, startValue: value, latestValue: value }
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
          event.preventDefault()
          const visualDirection = event.key === "ArrowRight" ? 1 : -1
          const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP
          const nextValue = clamp(value + direction * visualDirection * step, min, max)
          onResize(nextValue)
          onResizeEnd(nextValue)
        }}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary group-active:bg-primary" />
      </div>
    </div>
  )
}
