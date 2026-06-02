import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { ChevronDown, ListTree } from "lucide-react"
import type { ModuleAnchor } from "@typedance/contracts"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { clampOutlinePosition } from "./moduleInteractions"

export type DraftCanvasSaveStatus = "idle" | "saving" | "saved" | "error"

export type DraggableModuleOutlineProps = {
  anchors: ModuleAnchor[]
  activeModuleId: string | null
  expanded: boolean
  position: { x: number; y: number }
  bounds: { width: number; height: number }
  saveStatus: DraftCanvasSaveStatus
  onRetrySave?: () => void
  onExpandedChange: (expanded: boolean) => void
  onPositionCommit: (position: { x: number; y: number }) => void
  onActivateModule: (moduleId: string) => void
  onScrollToAnchor: (anchor: ModuleAnchor) => void
}

type Position = { x: number; y: number }

type DragState = {
  pointerId: number
  start: Position
  origin: Position
  latest: Position
}

export function draftCanvasSaveStatusLabel(status: DraftCanvasSaveStatus) {
  if (status === "saving") return "正在保存"
  if (status === "saved") return "已保存"
  if (status === "error") return "保存失败"
  return ""
}

export function DraggableModuleOutline({
  anchors,
  activeModuleId,
  expanded,
  position,
  bounds,
  saveStatus,
  onRetrySave,
  onExpandedChange,
  onPositionCommit,
  onActivateModule,
  onScrollToAnchor,
}: DraggableModuleOutlineProps) {
  const outlineRef = useRef<HTMLElement>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const [temporaryPosition, setTemporaryPosition] = useState(position)

  useEffect(() => {
    if (!dragStateRef.current) setTemporaryPosition(position)
  }, [position])

  const clampPosition = (nextPosition: Position) => {
    const rect = outlineRef.current?.getBoundingClientRect()
    return clampOutlinePosition(
      nextPosition,
      bounds,
      { width: rect?.width ?? 0, height: rect?.height ?? 0 },
    )
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current) return

    const dragState = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: temporaryPosition,
      latest: clampPosition(temporaryPosition),
    }
    dragStateRef.current = dragState
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const nextPosition = clampPosition({
      x: dragState.origin.x + event.clientX - dragState.start.x,
      y: dragState.origin.y + event.clientY - dragState.start.y,
    })
    dragState.latest = nextPosition
    setTemporaryPosition(nextPosition)
  }

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    const finalPosition = event.type === "pointercancel"
      ? dragState.latest
      : clampPosition({
          x: dragState.origin.x + event.clientX - dragState.start.x,
          y: dragState.origin.y + event.clientY - dragState.start.y,
        })
    dragStateRef.current = null
    setTemporaryPosition(finalPosition)
    onPositionCommit(finalPosition)
  }

  return (
    <aside
      ref={outlineRef}
      aria-label="简历模块大纲"
      className="td-module-interaction-only absolute z-20 w-52 border border-border bg-background/95 shadow-sm backdrop-blur"
      style={{ left: temporaryPosition.x, top: temporaryPosition.y }}
    >
      <div className="flex items-center">
        <div
          data-testid="module-outline-drag-handle"
          className="flex min-w-0 flex-1 cursor-move touch-none select-none items-center gap-2 px-3 py-2 text-sm font-medium"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <ListTree className="size-4 shrink-0" />
          模块大纲
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 rounded-none"
          aria-expanded={expanded}
          aria-label={expanded ? "折叠模块大纲" : "展开模块大纲"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onExpandedChange(!expanded)}
        >
          <ChevronDown
            className={cn(
              "size-4 transition-transform duration-150",
              expanded && "rotate-180",
            )}
          />
        </Button>
      </div>
      <div
        className={cn(
          "flex min-h-5 items-center justify-between gap-2 border-t border-border px-2 py-1 text-xs text-muted-foreground",
          saveStatus === "error" && "text-destructive",
        )}
      >
        <span aria-live="polite">{draftCanvasSaveStatusLabel(saveStatus)}</span>
        {saveStatus === "error" && onRetrySave ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onRetrySave}
          >
            重试保存
          </Button>
        ) : null}
      </div>
      {expanded ? (
        <div className="max-h-80 overflow-y-auto border-t border-border p-1">
          {anchors.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">暂无可用模块大纲。</p>
          ) : (
            anchors.map((anchor) => {
              const active = anchor.module_id === activeModuleId
              return (
                <Button
                  key={anchor.module_id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-current={active ? "true" : undefined}
                  data-active={active ? "true" : undefined}
                  className={cn(
                    "h-auto w-full justify-start whitespace-normal py-1.5 pl-2 text-left text-xs",
                    active && "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300",
                  )}
                  onClick={() => {
                    onActivateModule(anchor.module_id)
                    onScrollToAnchor(anchor)
                  }}
                >
                  {anchor.title}
                </Button>
              )
            })
          )}
        </div>
      ) : null}
    </aside>
  )
}
