import {
  type ChangeEvent,
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
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
  onMarginsCommit?: (margins: PageMargins) => void
}

type DragState = {
  pointerId: number
  side: MarginSide
  start: { x: number; y: number }
  origin: PageMargins
  latest: PageMargins
}

type EditingState = {
  side: MarginSide
  value: string
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
  event: ReactPointerEvent<HTMLElement>,
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

function guideLabelStyle(side: MarginSide, position: number, pageBounds: PageBounds): CSSProperties {
  const vertical = side === "left" || side === "right"
  return vertical
    ? {
      left: position,
      top: pageBounds.height / 2,
      transform: "translate(-50%, -50%)",
    }
    : {
      left: pageBounds.width / 2,
      top: position,
      transform: "translate(-50%, -50%)",
    }
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "")
}

export function PageMarginGuides({
  margins,
  pageBounds,
  pageSize,
  onMarginsChange,
  onMarginsCommit,
}: PageMarginGuidesProps) {
  const dragStateRef = useRef<DragState | null>(null)
  const [draggingSide, setDraggingSide] = useState<MarginSide | null>(null)
  const [hoveredSide, setHoveredSide] = useState<MarginSide | null>(null)
  const [temporaryMargins, setTemporaryMargins] = useState(margins)
  const [editingState, setEditingState] = useState<EditingState | null>(null)

  useEffect(() => {
    if (dragStateRef.current || editingState) return
    setTemporaryMargins(margins)
  }, [
    editingState,
    margins.bottom,
    margins.left,
    margins.right,
    margins.top,
  ])

  const handlePointerDown = (side: MarginSide, event: ReactPointerEvent<HTMLElement>) => {
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

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const nextMargins = getDraggedMargins(dragState, event, pageBounds, pageSize)
    dragState.latest = nextMargins
    setTemporaryMargins(nextMargins)
    onMarginsChange(nextMargins)
    event.preventDefault()
    event.stopPropagation()
  }

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
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
    onMarginsCommit?.(finalMargins)
    event.preventDefault()
    event.stopPropagation()
  }

  const startEditing = (side: MarginSide) => {
    if (dragStateRef.current) return
    setEditingState({ side, value: String(temporaryMargins[side]) })
  }

  const commitEditing = (side: MarginSide, rawValue: string) => {
    const nextValue = digitsOnly(rawValue)
    setEditingState(null)
    if (nextValue === "") return

    const nextMargins = clampPageMargins({
      ...temporaryMargins,
      [side]: Number.parseInt(nextValue, 10),
    }, pageSize)
    setTemporaryMargins(nextMargins)
    onMarginsChange(nextMargins)
    onMarginsCommit?.(nextMargins)
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = digitsOnly(event.target.value)
    setEditingState((current) => (current ? { ...current, value } : current))
  }

  const handleInputKeyDown = (
    side: MarginSide,
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      commitEditing(side, event.currentTarget.value)
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.key === "Escape") {
      setEditingState(null)
      event.preventDefault()
      event.stopPropagation()
    }
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
        const position = getGuidePosition(side, temporaryMargins, pageBounds, pageSize)
        const dragging = draggingSide === side
        const raised = dragging || (draggingSide === null && hoveredSide === side)
        const editing = editingState?.side === side
        const surfaceState = dragging
          ? "dragging"
          : hoveredSide === side
            ? "hovered"
            : null
        return (
          <Fragment key={side}>
          <button
            type="button"
            aria-label={`拖拽${SIDE_LABELS[side]}，当前 ${value}px`}
            title={`${SIDE_LABELS[side]} ${value}px`}
            data-dragging={dragging ? "true" : undefined}
            data-testid={`page-margin-guide-${side}`}
            className={guideClassName(side, raised)}
            style={{
              ...guideStyle(side, position, pageBounds),
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
          </button>
          {editing ? (
            <label
              key={`${side}-input`}
              className="pointer-events-auto absolute z-40 inline-flex h-5 items-center rounded bg-neutral-950 px-1.5 py-0.5 text-[11px] font-medium leading-none text-white shadow-sm"
              data-testid={`page-margin-editor-${side}`}
              style={guideLabelStyle(side, position, pageBounds)}
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
            >
              <input
                autoFocus
                aria-label={`Edit ${side} margin value`}
                className="h-4 min-w-5 bg-transparent p-0 text-center font-medium leading-none text-white outline-none"
                data-testid={`page-margin-input-${side}`}
                inputMode="numeric"
                pattern="[0-9]*"
                style={{ width: `${Math.max(2, editingState.value.length)}ch` }}
                value={editingState.value}
                onBlur={(event) => commitEditing(side, event.currentTarget.value)}
                onChange={handleInputChange}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={(event) => handleInputKeyDown(side, event)}
              />
              <span data-testid={`page-margin-unit-${side}`}>px</span>
            </label>
          ) : (
            <button
              key={`${side}-label`}
              type="button"
              aria-label={`Edit ${side} margin value`}
              className="pointer-events-auto absolute z-40 rounded bg-neutral-950 px-2 py-1 text-[11px] font-medium leading-none text-white shadow-sm"
              data-testid={`page-margin-label-${side}`}
              style={guideLabelStyle(side, position, pageBounds)}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                startEditing(side)
              }}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
            >
              {value}px
            </button>
          )}
          </Fragment>
        )
      })}
    </div>
  )
}
