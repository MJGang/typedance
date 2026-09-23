import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react"
import {
  MIN_COLUMN_WIDTH_PERCENT,
  columnGridTemplate,
  normalizeColumnWidths,
  resizeColumnWidths,
  serializeColumnWidths,
  type ColumnsCount,
  type ColumnsGap,
  type ColumnWidths,
} from "@typedance/tiptap-layout"
import { ColumnControls } from "./ColumnControls"

const KEYBOARD_RESIZE_STEP = 5

function getColumnsCount(value: unknown): ColumnsCount {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= 6
    ? value as ColumnsCount
    : 2
}

function getColumnsGap(value: unknown): ColumnsGap {
  return value === "compact" || value === "wide" ? value : "default"
}

function getGapPixels(gap: ColumnsGap) {
  if (gap === "compact") return 6
  if (gap === "wide") return 16
  return 10
}

function resizeOverlayTemplate(widths: ColumnWidths, gapPixels: number) {
  return widths
    .flatMap((width, index) => (
      index === widths.length - 1
        ? [`minmax(0, ${width}fr)`]
        : [`minmax(0, ${width}fr)`, `${gapPixels}px`]
    ))
    .join(" ")
}

type PointerResizeSession = {
  pointerId: number
  dividerIndex: number
  startX: number
  availableWidth: number
  startWidths: ColumnWidths
  previousCursor: string
  previousUserSelect: string
}

export function ColumnsNodeView({ editor, getPos, node, updateAttributes }: ReactNodeViewProps) {
  const count = getColumnsCount(node.attrs.count)
  const gap = getColumnsGap(node.attrs.gap)
  const gapPixels = getGapPixels(gap)
  const persistedWidths = useMemo(
    () => normalizeColumnWidths(node.attrs.widths, count),
    [count, node.attrs.widths],
  )
  const [draftWidths, setDraftWidths] = useState<ColumnWidths>(persistedWidths)
  const overlayTemplate = resizeOverlayTemplate(draftWidths, gapPixels)
  const [isResizing, setIsResizing] = useState(false)
  const [hasEditorSelection, setHasEditorSelection] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const draftWidthsRef = useRef<ColumnWidths>(persistedWidths)
  const pointerResizeRef = useRef<PointerResizeSession | null>(null)

  const updateDraftWidths = useCallback((widths: ColumnWidths) => {
    draftWidthsRef.current = widths
    setDraftWidths(widths)
  }, [])

  const restoreDocumentInteraction = useCallback((session: PointerResizeSession) => {
    document.body.style.cursor = session.previousCursor
    document.body.style.userSelect = session.previousUserSelect
    document.body.classList.remove("td-column-resizing")
  }, [])

  useEffect(() => {
    if (!pointerResizeRef.current) {
      updateDraftWidths(persistedWidths)
    }
  }, [persistedWidths, updateDraftWidths])

  useEffect(() => {
    const syncSelection = () => {
      const position = getPos()
      const anchor = editor.state.selection.anchor
      setHasEditorSelection(
        editor.isFocused
        && typeof position === "number"
        && anchor > position
        && anchor < position + node.nodeSize,
      )
    }

    syncSelection()
    editor.on("focus", syncSelection)
    editor.on("blur", syncSelection)
    editor.on("selectionUpdate", syncSelection)
    return () => {
      editor.off("focus", syncSelection)
      editor.off("blur", syncSelection)
      editor.off("selectionUpdate", syncSelection)
    }
  }, [editor, getPos, node.nodeSize])

  const startPointerResize = useCallback((dividerIndex: number, event: PointerEvent<HTMLDivElement>) => {
    if (!editor.isEditable || event.button !== 0 || pointerResizeRef.current || document.body.classList.contains("td-column-resizing")) return

    const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 0
    const availableWidth = containerWidth - gapPixels * (count - 1)
    if (availableWidth <= 0) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointerResizeRef.current = {
      pointerId: event.pointerId,
      dividerIndex,
      startX: event.clientX,
      availableWidth,
      startWidths: draftWidthsRef.current,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = "ew-resize"
    document.body.style.userSelect = "none"
    document.body.classList.add("td-column-resizing")
    setIsResizing(true)
  }, [count, editor, gapPixels])

  const movePointerResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = pointerResizeRef.current
    if (!session || event.pointerId !== session.pointerId) return

    event.preventDefault()
    const deltaPercentage = (event.clientX - session.startX) / session.availableWidth * 100
    updateDraftWidths(resizeColumnWidths(session.startWidths, session.dividerIndex, deltaPercentage))
  }, [updateDraftWidths])

  const finishPointerResize = useCallback((commit: boolean, clientX?: number) => {
    const session = pointerResizeRef.current
    if (!session) return

    const finalWidths = commit && typeof clientX === "number"
      ? resizeColumnWidths(
          session.startWidths,
          session.dividerIndex,
          (clientX - session.startX) / session.availableWidth * 100,
        )
      : draftWidthsRef.current
    restoreDocumentInteraction(session)
    pointerResizeRef.current = null
    setIsResizing(false)

    if (commit && editor.isEditable) {
      updateDraftWidths(finalWidths)
      updateAttributes({ widths: finalWidths })
    } else {
      updateDraftWidths(persistedWidths)
    }
  }, [editor, persistedWidths, restoreDocumentInteraction, updateAttributes, updateDraftWidths])

  const finishPointerEvent = useCallback((event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const session = pointerResizeRef.current
    if (!session || event.pointerId !== session.pointerId) return

    event.preventDefault()
    event.stopPropagation()
    finishPointerResize(commit, commit ? event.clientX : undefined)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
  }, [finishPointerResize])

  useEffect(() => {
    if (!isResizing) return
    const cancelResize = () => finishPointerResize(false)
    window.addEventListener("blur", cancelResize)
    return () => window.removeEventListener("blur", cancelResize)
  }, [finishPointerResize, isResizing])

  useEffect(() => () => {
    const session = pointerResizeRef.current
    if (session) restoreDocumentInteraction(session)
    pointerResizeRef.current = null
  }, [restoreDocumentInteraction])

  const resizeWithKeyboard = useCallback((dividerIndex: number, event: KeyboardEvent<HTMLDivElement>) => {
    if (!editor.isEditable || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return

    event.preventDefault()
    event.stopPropagation()
    const direction = event.key === "ArrowRight" ? 1 : -1
    const nextWidths = resizeColumnWidths(
      draftWidthsRef.current,
      dividerIndex,
      direction * KEYBOARD_RESIZE_STEP,
    )
    updateDraftWidths(nextWidths)
    updateAttributes({ widths: nextWidths })
  }, [editor, updateAttributes, updateDraftWidths])

  return (
    <NodeViewWrapper
      ref={containerRef}
      className="td-columns td-columns-editor"
      data-count={count}
      data-gap={gap}
      data-widths={serializeColumnWidths(draftWidths, count)}
      data-editable={editor.isEditable || undefined}
      data-selection-within={hasEditorSelection || undefined}
      data-resizing={isResizing || undefined}
    >
      <NodeViewContent
        className="td-columns-content"
        style={{ gridTemplateColumns: columnGridTemplate(draftWidths, count) }}
      />
      {editor.isEditable ? (
        <div
          className="td-columns-resize-overlay"
          contentEditable={false}
          style={{ gridTemplateColumns: overlayTemplate }}
        >
          {isResizing ? draftWidths.map((width, index) => (
            <span
              key={`width-${index}`}
              className="td-column-width-label pointer-events-none z-10 min-w-11 justify-self-center self-center rounded-full bg-zinc-600 px-2 py-1 text-center text-[13px] leading-none font-semibold text-white shadow-sm"
              style={{ gridColumn: index * 2 + 1, gridRow: 1 }}
              contentEditable={false}
              aria-hidden="true"
            >
              {Math.round(width)}%
            </span>
          )) : null}
          {Array.from({ length: count - 1 }, (_, dividerIndex) => {
            const pairTotal = draftWidths[dividerIndex] + draftWidths[dividerIndex + 1]
            return (
              <div
                key={dividerIndex}
                role="separator"
                aria-label={`调整第 ${dividerIndex + 1} 栏与第 ${dividerIndex + 2} 栏宽度`}
                aria-orientation="vertical"
                aria-valuemin={MIN_COLUMN_WIDTH_PERCENT}
                aria-valuemax={Math.round(pairTotal - MIN_COLUMN_WIDTH_PERCENT)}
                aria-valuenow={Math.round(draftWidths[dividerIndex])}
                className="td-column-resize-handle"
                data-active={isResizing && pointerResizeRef.current?.dividerIndex === dividerIndex || undefined}
                style={{ gridColumn: dividerIndex * 2 + 2, gridRow: 1 }}
                tabIndex={0}
                onKeyDown={(event) => resizeWithKeyboard(dividerIndex, event)}
                onPointerDown={(event) => startPointerResize(dividerIndex, event)}
                onPointerMove={movePointerResize}
                onPointerUp={(event) => finishPointerEvent(event, true)}
                onPointerCancel={(event) => finishPointerEvent(event, false)}
                onLostPointerCapture={() => finishPointerResize(false)}
              />
            )
          })}
        </div>
      ) : null}
      {editor.isEditable ? (
        <ColumnControls
          editor={editor}
          getPos={getPos}
          containerRef={containerRef}
          count={count}
          gridTemplateColumns={overlayTemplate}
        />
      ) : null}
    </NodeViewWrapper>
  )
}
