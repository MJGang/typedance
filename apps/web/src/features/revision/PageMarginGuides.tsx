import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react"
import type { PageMargins, PageSize } from "./pageMargins"
import { clampPageMargins } from "./pageMargins"

export type PageBounds = {
  x: number
  y: number
  width: number
  height: number
}

type MarginSide = keyof PageMargins

type PageMarginGuidesProps = {
  margins: PageMargins
  pageBounds: PageBounds
  pageSize: PageSize
  onMarginsChange: (margins: PageMargins) => void
}

type DragState = {
  pointerId: number
  side: MarginSide
  start: { x: number; y: number }
  origin: PageMargins
  latest: PageMargins
}

const GUIDE_HIT_SIZE = 24
const GUIDE_HOVER_COLOR = "rgba(224, 242, 254, 0.48)"
const GUIDE_DRAG_COLOR = "rgba(224, 242, 254, 0.9)"
const SIDE_LABELS: Record<MarginSide, string> = {
  top: "上边距",
  bottom: "下边距",
  left: "左边距",
  right: "右边距",
}

function getPageScale(pageBounds: PageBounds, pageSize: PageSize) {
  return {
    x: pageSize.width > 0 ? pageBounds.width / pageSize.width : 1,
    y: pageSize.height > 0 ? pageBounds.height / pageSize.height : 1,
  }
}

function getGuidePosition(side: MarginSide, margins: PageMargins, pageBounds: PageBounds, pageSize: PageSize) {
  const scale = getPageScale(pageBounds, pageSize)
  if (side === "left") return margins.left * scale.x
  if (side === "right") return pageBounds.width - margins.right * scale.x
  if (side === "top") return margins.top * scale.y
  return pageBounds.height - margins.bottom * scale.y
}

function getDraggedMargins(
  dragState: DragState,
  event: ReactPointerEvent<HTMLButtonElement>,
  pageBounds: PageBounds,
  pageSize: PageSize,
) {
  const scale = getPageScale(pageBounds, pageSize)
  const deltaX = scale.x === 0 ? 0 : (event.clientX - dragState.start.x) / scale.x
  const deltaY = scale.y === 0 ? 0 : (event.clientY - dragState.start.y) / scale.y
  const nextMargins = { ...dragState.origin }

  if (dragState.side === "left") nextMargins.left = dragState.origin.left + deltaX
  if (dragState.side === "right") nextMargins.right = dragState.origin.right - deltaX
  if (dragState.side === "top") nextMargins.top = dragState.origin.top + deltaY
  if (dragState.side === "bottom") nextMargins.bottom = dragState.origin.bottom - deltaY

  return clampPageMargins(nextMargins, pageSize)
}

function guideClassName(side: MarginSide, raised: boolean) {
  const vertical = side === "left" || side === "right"
  return [
    "pointer-events-auto absolute touch-none select-none rounded-sm bg-transparent p-0 transition-[background,backdrop-filter] duration-150",
    raised ? "z-30" : "z-10",
    vertical
      ? "td-page-margin-guide-x-resize top-0 cursor-ew-resize"
      : "td-page-margin-guide-y-resize left-0 cursor-ns-resize",
  ].filter(Boolean).join(" ")
}

function guideStyle(side: MarginSide, position: number, pageBounds: PageBounds): CSSProperties {
  const vertical = side === "left" || side === "right"
  if (vertical) {
    return {
      left: position,
      width: GUIDE_HIT_SIZE,
      height: pageBounds.height,
      transform: `translateX(-${GUIDE_HIT_SIZE / 2}px)`,
      cursor: "ew-resize",
    }
  }

  return {
    top: position,
    width: pageBounds.width,
    height: GUIDE_HIT_SIZE,
    transform: `translateY(-${GUIDE_HIT_SIZE / 2}px)`,
    cursor: "ns-resize",
  }
}

function guideSurfaceStyle(
  side: MarginSide,
  state: "dragging" | "hovered" | null,
): CSSProperties {
  if (state === null) return {}

  const vertical = side === "left" || side === "right"
  const color = state === "dragging" ? GUIDE_DRAG_COLOR : GUIDE_HOVER_COLOR
  const blur = state === "dragging" ? "blur(3px)" : "blur(2px)"
  const gradient = vertical
    ? `linear-gradient(to right, transparent 0%, ${color} 50%, transparent 100%)`
    : `linear-gradient(to bottom, transparent 0%, ${color} 50%, transparent 100%)`

  return {
    background: gradient,
    backdropFilter: blur,
    WebkitBackdropFilter: blur,
  }
}

function guideLineClassName(side: MarginSide) {
  const vertical = side === "left" || side === "right"
  return vertical
    ? "absolute inset-y-0 left-1/2 border-l border-dashed border-blue-500"
    : "absolute left-0 top-1/2 w-full border-t border-dashed border-blue-500"
}

export function PageMarginGuides({
  margins,
  pageBounds,
  pageSize,
  onMarginsChange,
}: PageMarginGuidesProps) {
  const dragStateRef = useRef<DragState | null>(null)
  const [draggingSide, setDraggingSide] = useState<MarginSide | null>(null)
  const [hoveredSide, setHoveredSide] = useState<MarginSide | null>(null)
  const [temporaryMargins, setTemporaryMargins] = useState(margins)

  useEffect(() => {
    if (dragStateRef.current) return
    setTemporaryMargins(margins)
  }, [
    margins.bottom,
    margins.left,
    margins.right,
    margins.top,
  ])

  const handlePointerDown = (side: MarginSide, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || dragStateRef.current) return

    const initialMargins = clampPageMargins(temporaryMargins, pageSize)
    dragStateRef.current = {
      pointerId: event.pointerId,
      side,
      start: { x: event.clientX, y: event.clientY },
      origin: initialMargins,
      latest: initialMargins,
    }
    setDraggingSide(side)
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const nextMargins = getDraggedMargins(dragState, event, pageBounds, pageSize)
    dragState.latest = nextMargins
    setTemporaryMargins(nextMargins)
    onMarginsChange(nextMargins)
    event.preventDefault()
    event.stopPropagation()
  }

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    const finalMargins = event.type === "pointercancel"
      ? dragState.latest
      : getDraggedMargins(dragState, event, pageBounds, pageSize)
    dragStateRef.current = null
    setDraggingSide(null)
    setTemporaryMargins(finalMargins)
    onMarginsChange(finalMargins)
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      role="group"
      aria-label="页面边距辅助线"
      className="td-module-interaction-only pointer-events-none absolute z-10"
      style={{
        left: pageBounds.x,
        top: pageBounds.y,
        width: pageBounds.width,
        height: pageBounds.height,
      }}
    >
      {(["top", "bottom", "left", "right"] as MarginSide[]).map((side) => {
        const value = temporaryMargins[side]
        const dragging = draggingSide === side
        const raised = dragging || (draggingSide === null && hoveredSide === side)
        const surfaceState = dragging
          ? "dragging"
          : hoveredSide === side
            ? "hovered"
            : null
        return (
          <button
            key={side}
            type="button"
            aria-label={`拖拽${SIDE_LABELS[side]}，当前 ${value}px`}
            title={`${SIDE_LABELS[side]} ${value}px`}
            data-dragging={dragging ? "true" : undefined}
            data-testid={`page-margin-guide-${side}`}
            className={guideClassName(side, raised)}
            style={{
              ...guideStyle(side, getGuidePosition(side, temporaryMargins, pageBounds, pageSize), pageBounds),
              ...guideSurfaceStyle(side, surfaceState),
            }}
            onPointerEnter={() => setHoveredSide(side)}
            onPointerLeave={() => {
              setHoveredSide((currentSide) => (currentSide === side ? null : currentSide))
            }}
            onPointerDown={(event) => handlePointerDown(side, event)}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          >
            <span aria-hidden="true" className={guideLineClassName(side)} />
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-neutral-950 px-2 py-1 text-[11px] font-medium leading-none text-white shadow-sm"
            >
              {value}px
            </span>
          </button>
        )
      })}
    </div>
  )
}
