import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react"
import { Ellipsis, Plus, Trash2 } from "lucide-react"
import type { ReactNodeViewProps } from "@tiptap/react"
import type { ColumnsCount } from "@typedance/tiptap-layout"

const DRAG_START_DISTANCE = 5

type Props = {
  editor: ReactNodeViewProps["editor"]
  getPos: ReactNodeViewProps["getPos"]
  containerRef: RefObject<HTMLDivElement | null>
  count: ColumnsCount
  gridTemplateColumns: string
}

type DragSession = {
  pointerId: number
  fromIndex: number
  toIndex: number
  startX: number
  startY: number
  dragging: boolean
  previousCursor: string
  previousUserSelect: string
}

type DropTarget = { index: number; x: number }

function restoreDocumentInteraction(session: DragSession) {
  document.body.style.cursor = session.previousCursor
  document.body.style.userSelect = session.previousUserSelect
  document.body.classList.remove("td-column-reordering")
}

export function ColumnControls({ editor, getPos, containerRef, count, gridTemplateColumns }: Props) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [gripHoverIndex, setGripHoverIndex] = useState<number | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [addHoverIndex, setAddHoverIndex] = useState<number | null>(null)
  const [menuOpenIndex, setMenuOpenIndex] = useState<number | null>(null)
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const dragRef = useRef<DragSession | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    setHoveredIndex(null)
    setGripHoverIndex(null)
    setFocusedIndex(null)
    setAddHoverIndex(null)
    setMenuOpenIndex(null)
  }, [count])

  const getColumnElements = useCallback(() => {
    const root = containerRef.current
    if (!root) return []
    return [...root.querySelectorAll<HTMLElement>(".td-column")]
      .filter((element) => element.closest(".td-columns-editor") === root)
  }, [containerRef])

  const getDropIndex = useCallback((clientX: number, clientY: number, grip: HTMLElement) => {
    const elements = getColumnElements()
    if (elements.length !== count) return null
    const firstRect = elements[0].getBoundingClientRect()
    const lastRect = elements[count - 1].getBoundingClientRect()
    const gripRect = grip.getBoundingClientRect()
    if (
      clientX < firstRect.left || clientX > lastRect.right
      || clientY < Math.min(firstRect.top, gripRect.top)
      || clientY > Math.max(firstRect.bottom, lastRect.bottom)
    ) return null

    const targetIndex = elements.findIndex((column) => clientX < column.getBoundingClientRect().right)
    return targetIndex < 0 ? count - 1 : targetIndex
  }, [count, getColumnElements])

  const runColumnCommand = useCallback((command: (position: number) => boolean) => {
    if (!editor.isEditable) return false
    const position = getPos()
    return typeof position === "number" && command(position)
  }, [editor, getPos])

  useEffect(() => {
    const root = containerRef.current
    if (!root) return

    const handlePointerOver = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const control = target.closest<HTMLElement>("[data-column-control-index]")
      if (control?.closest(".td-columns-editor") === root) {
        setHoveredIndex(Number(control.dataset.columnControlIndex))
        return
      }
      const column = target.closest<HTMLElement>(".td-column")
      setHoveredIndex(column?.closest(".td-columns-editor") === root
        ? getColumnElements().indexOf(column)
        : null)
    }
    const handlePointerLeave = () => setHoveredIndex(null)
    root.addEventListener("pointerover", handlePointerOver)
    root.addEventListener("pointerleave", handlePointerLeave)
    return () => {
      root.removeEventListener("pointerover", handlePointerOver)
      root.removeEventListener("pointerleave", handlePointerLeave)
    }
  }, [containerRef, getColumnElements])

  const finishDrag = useCallback(() => {
    const session = dragRef.current
    if (!session) return null
    restoreDocumentInteraction(session)
    dragRef.current = null
    setDragFromIndex(null)
    setDropTarget(null)
    return session
  }, [])

  useEffect(() => {
    const cancel = () => finishDrag()
    window.addEventListener("blur", cancel)
    return () => {
      window.removeEventListener("blur", cancel)
      const session = dragRef.current
      if (session) restoreDocumentInteraction(session)
      dragRef.current = null
    }
  }, [finishDrag])

  const startDrag = (index: number, event: PointerEvent<HTMLButtonElement>) => {
    if (!editor.isEditable || event.button !== 0 || dragRef.current) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      fromIndex: index,
      toIndex: index,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    }
  }

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const session = dragRef.current
    if (!session || session.pointerId !== event.pointerId) return
    if (!session.dragging && Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < DRAG_START_DISTANCE) return

    event.preventDefault()
    if (!session.dragging) {
      session.dragging = true
      document.body.style.cursor = "grabbing"
      document.body.style.userSelect = "none"
      document.body.classList.add("td-column-reordering")
      setDragFromIndex(session.fromIndex)
      setMenuOpenIndex(null)
    }

    const index = getDropIndex(event.clientX, event.clientY, event.currentTarget)
    if (index === null) {
      session.toIndex = session.fromIndex
      setDropTarget(null)
      return
    }
    session.toIndex = index
    if (index === session.fromIndex) {
      setDropTarget(null)
      return
    }
    const targetRect = getColumnElements()[index].getBoundingClientRect()
    const rootLeft = containerRef.current?.getBoundingClientRect().left ?? 0
    setDropTarget({ index, x: (session.fromIndex < index ? targetRect.right : targetRect.left) - rootLeft })
  }

  const endDrag = (event: PointerEvent<HTMLButtonElement>, commit: boolean) => {
    const session = dragRef.current
    if (!session || session.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    session.toIndex = getDropIndex(event.clientX, event.clientY, event.currentTarget) ?? session.fromIndex
    const finished = finishDrag()
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    if (!finished?.dragging) return
    suppressClickRef.current = true
    window.setTimeout(() => { suppressClickRef.current = false }, 0)
    if (commit && finished.toIndex !== finished.fromIndex) {
      runColumnCommand((position) => editor.commands.moveColumnAt(position, finished.fromIndex, finished.toIndex))
    }
  }

  const candidateActiveIndex = dragFromIndex ?? gripHoverIndex ?? focusedIndex ?? menuOpenIndex
  const activeIndex = candidateActiveIndex !== null && candidateActiveIndex < count ? candidateActiveIndex : null

  return (
    <div
      className="td-columns-controls-overlay pointer-events-none absolute inset-0 grid"
      contentEditable={false}
      style={{ gridTemplateColumns }}
    >
      {activeIndex !== null ? (
        <div
          className="pointer-events-none z-0 rounded-[4px] ring-1 ring-inset ring-blue-500"
          style={{ gridColumn: activeIndex * 2 + 1, gridRow: 1 }}
          aria-hidden="true"
        />
      ) : null}
      {dropTarget ? (
        <div
          className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-blue-500"
          style={{ left: dropTarget.x }}
          aria-hidden="true"
        />
      ) : null}
      {addHoverIndex !== null && addHoverIndex < count && count < 6 ? (
        <div
          className="td-column-add-guide pointer-events-none z-10 w-[3px] self-stretch justify-self-center rounded-full bg-blue-500"
          style={{
            gridColumn: addHoverIndex === count - 1 ? addHoverIndex * 2 + 1 : addHoverIndex * 2 + 2,
            gridRow: 1,
            justifySelf: addHoverIndex === count - 1 ? "end" : "center",
            transform: addHoverIndex === count - 1 ? "translateX(50%)" : undefined,
          }}
          aria-hidden="true"
        />
      ) : null}
      {Array.from({ length: count }, (_, index) => {
        const visible = hoveredIndex === index || gripHoverIndex === index || focusedIndex === index || menuOpenIndex === index || dragFromIndex === index
        const active = activeIndex === index
        return (
          <div
            key={`grip-${index}`}
            className="pointer-events-none relative z-20 -mt-4 h-0 w-10 justify-self-center"
            style={{ gridColumn: index * 2 + 1, gridRow: 1 }}
          >
            <button
              type="button"
              aria-label={`拖动第 ${index + 1} 栏`}
              aria-expanded={menuOpenIndex === index}
              title={`拖动第 ${index + 1} 栏；左右方向键可调整顺序，点击显示删除`}
              data-column-control-index={index}
              data-visible={visible || undefined}
              data-active={active || undefined}
              className="td-column-grip pointer-events-auto absolute left-0 top-0 flex h-3 w-10 touch-none items-center justify-center rounded-full bg-muted text-muted-foreground opacity-0 transition-colors duration-150 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 data-[visible=true]:opacity-100 data-[active=true]:bg-blue-500 data-[active=true]:text-white"
              onPointerEnter={() => setGripHoverIndex(index)}
              onPointerLeave={() => setGripHoverIndex((current) => current === index ? null : current)}
              onFocus={() => setFocusedIndex(index)}
              onBlur={() => setFocusedIndex((current) => current === index ? null : current)}
              onPointerDown={(event) => startDrag(index, event)}
              onPointerMove={moveDrag}
              onPointerUp={(event) => endDrag(event, true)}
              onPointerCancel={(event) => endDrag(event, false)}
              onLostPointerCapture={() => finishDrag()}
              onClick={(event) => {
                event.stopPropagation()
                if (suppressClickRef.current) {
                  suppressClickRef.current = false
                  return
                }
                setMenuOpenIndex((current) => current === index ? null : index)
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setMenuOpenIndex(null)
                  return
                }
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
                event.preventDefault()
                event.stopPropagation()
                const target = index + (event.key === "ArrowRight" ? 1 : -1)
                if (target >= 0 && target < count) {
                  runColumnCommand((position) => editor.commands.moveColumnAt(position, index, target))
                }
              }}
            >
              <Ellipsis className="pointer-events-none size-4" aria-hidden="true" />
            </button>
            {menuOpenIndex === index ? (
              <button
                type="button"
                aria-label={`删除第 ${index + 1} 栏`}
                title={`删除第 ${index + 1} 栏`}
                data-column-control-index={index}
                className="td-column-delete pointer-events-auto absolute -top-7 left-1/2 flex size-6 -translate-x-1/2 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm hover:border-destructive hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  setMenuOpenIndex(null)
                  runColumnCommand((position) => editor.commands.removeColumnAt(position, index))
                }}
              >
                <Trash2 className="pointer-events-none size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        )
      })}
      {count < 6 ? Array.from({ length: count }, (_, index) => (
        <button
          key={`add-${index}`}
          type="button"
          aria-label={`在第 ${index + 1} 栏后插入新栏`}
          title={`在第 ${index + 1} 栏后插入新栏`}
          data-column-control-index={index}
          className={`td-column-add-button group pointer-events-auto relative z-20 -mt-6 flex size-6 cursor-pointer items-center justify-center self-start rounded-md border border-transparent bg-transparent text-blue-500 hover:border-border hover:bg-background focus-visible:border-border focus-visible:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${index === count - 1 ? "justify-self-end translate-x-1/2" : "justify-self-center"}`}
          style={{ gridColumn: index === count - 1 ? index * 2 + 1 : index * 2 + 2, gridRow: 1 }}
          onPointerEnter={() => setAddHoverIndex(index)}
          onPointerLeave={() => setAddHoverIndex((current) => current === index ? null : current)}
          onFocus={() => setAddHoverIndex(index)}
          onBlur={() => setAddHoverIndex((current) => current === index ? null : current)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            setAddHoverIndex(null)
            setMenuOpenIndex(null)
            runColumnCommand((position) => editor.commands.insertColumnAt(position, index))
          }}
        >
          <span className="pointer-events-none size-1 rounded-full bg-muted-foreground/40 group-hover:hidden group-focus-visible:hidden" aria-hidden="true" />
          <Plus className="pointer-events-none hidden size-3.5 group-hover:block group-focus-visible:block" aria-hidden="true" />
        </button>
      )) : null}
    </div>
  )
}
