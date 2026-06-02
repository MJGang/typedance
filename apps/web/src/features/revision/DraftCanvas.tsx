import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import type { ModuleAnchor, SourceResumeCanvas } from "@typedance/contracts"
import type { ResumeDocJson, ResumeEditorChange } from "../workspace/editor"
import {
  ResumeRichTextEditor,
  type ResumeRichTextEditorHandle,
} from "../workspace/components/ResumeRichTextEditor"
import {
  DraggableModuleOutline,
  type DraftCanvasSaveStatus,
} from "./DraggableModuleOutline"
import { ModuleInteractionLayer } from "./ModuleInteractionLayer"
import {
  buildModuleVisualRegions,
  getDefaultModuleOutlinePosition,
  loadModuleOutlinePreferences,
  saveModuleOutlinePreferences,
  type ModuleVisualRegion,
} from "./moduleInteractions"

export type { DraftCanvasSaveStatus } from "./DraggableModuleOutline"

type DraftCanvasProps = {
  canvas: SourceResumeCanvas
  onChange: (change: ResumeEditorChange) => void
  onRetrySave?: () => void
  saveStatus: DraftCanvasSaveStatus
}

type Position = { x: number; y: number }
type Size = { width: number; height: number }

function sameSize(left: Size, right: Size) {
  return left.width === right.width && left.height === right.height
}

function getElementSize(element: HTMLElement): Size {
  const rect = element.getBoundingClientRect()
  return {
    width: element.clientWidth || rect.width,
    height: element.clientHeight || rect.height,
  }
}

function requestMeasureFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback)
  }
  return window.setTimeout(() => callback(performance.now()), 0)
}

function cancelMeasureFrame(frameId: number) {
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(frameId)
    return
  }
  window.clearTimeout(frameId)
}

function DraftCanvasWorkspace({
  canvas,
  onChange,
  onRetrySave,
  saveStatus,
}: DraftCanvasProps) {
  const editorRef = useRef<ResumeRichTextEditorHandle>(null)
  const canvasRootRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const anchors = useMemo(
    () => [...canvas.module_anchors].sort((left, right) => left.order - right.order),
    [canvas.module_anchors],
  )
  const initialPreferences = useMemo(
    () => loadModuleOutlinePreferences(canvas.document_id),
    [canvas.document_id],
  )
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null)
  const [hoveredModuleId, setHoveredModuleId] = useState<string | null>(null)
  const [outlineVisible, setOutlineVisible] = useState(initialPreferences?.visible ?? true)
  const [outlineExpanded, setOutlineExpanded] = useState(initialPreferences?.expanded ?? true)
  const [outlinePosition, setOutlinePosition] = useState<Position | null>(
    initialPreferences?.position ?? null,
  )
  const outlinePositionRef = useRef(outlinePosition)
  const [outlineBounds, setOutlineBounds] = useState<Size>({ width: 0, height: 0 })
  const [regions, setRegions] = useState<ModuleVisualRegion[]>([])
  outlinePositionRef.current = outlinePosition

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return

    frameRef.current = requestMeasureFrame(() => {
      frameRef.current = null
      const root = canvasRootRef.current
      if (!root) return

      const rootRect = root.getBoundingClientRect()
      const nextBounds = getElementSize(root)
      setOutlineBounds((currentBounds) => (
        sameSize(currentBounds, nextBounds) ? currentBounds : nextBounds
      ))

      const nodes = [...root.querySelectorAll<HTMLElement>("[data-canvas-node-id]")]
        .map((node) => {
          const rect = node.getBoundingClientRect()
          return {
            canvasNodeId: node.dataset.canvasNodeId ?? "",
            rect: {
              top: rect.top - rootRect.top,
              bottom: rect.bottom - rootRect.top,
              left: rect.left - rootRect.left,
              right: rect.right - rootRect.left,
            },
          }
        })
        .filter((node) => node.canvasNodeId)
      const gaps = [...root.querySelectorAll<HTMLElement>(".rm-pagination-gap")]
        .map((gap) => {
          const rect = gap.getBoundingClientRect()
          return {
            top: rect.top - rootRect.top,
            bottom: rect.bottom - rootRect.top,
          }
        })

      setRegions(buildModuleVisualRegions({ anchors, nodes, gaps }))

      if (
        outlinePositionRef.current === null
        && nextBounds.width > 0
        && nextBounds.height > 0
      ) {
        const outline = root.querySelector<HTMLElement>("[aria-label='简历模块大纲']")
        if (outline) {
          setOutlinePosition(getDefaultModuleOutlinePosition(nextBounds, getElementSize(outline)))
        }
      }
    })
  }, [anchors])

  useEffect(() => {
    const root = canvasRootRef.current
    if (!root) return

    const viewport = root.querySelector<HTMLElement>(".td-editor-print-wrapper")
    const prosemirror = root.querySelector<HTMLElement>(".ProseMirror")
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleMeasure)

    resizeObserver?.observe(root)
    if (viewport) {
      resizeObserver?.observe(viewport)
      viewport.addEventListener("scroll", scheduleMeasure, { passive: true })
    }
    if (prosemirror) resizeObserver?.observe(prosemirror)
    scheduleMeasure()

    return () => {
      resizeObserver?.disconnect()
      viewport?.removeEventListener("scroll", scheduleMeasure)
      if (frameRef.current !== null) {
        cancelMeasureFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [scheduleMeasure])

  useEffect(() => {
    scheduleMeasure()
  }, [canvas.doc_json, outlineExpanded, outlineVisible, scheduleMeasure])

  useEffect(() => {
    if (outlinePosition === null) return
    saveModuleOutlinePreferences(canvas.document_id, {
      visible: outlineVisible,
      expanded: outlineExpanded,
      position: outlinePosition,
    })
  }, [
    canvas.document_id,
    outlineExpanded,
    outlinePosition,
    outlineVisible,
  ])

  const handleEditorChange = useCallback((change: ResumeEditorChange) => {
    onChange(change)
    scheduleMeasure()
  }, [onChange, scheduleMeasure])

  const scrollToAnchor = useCallback((anchor: ModuleAnchor) => {
    setActiveModuleId(anchor.module_id)
    const firstNodeId = anchor.canvas_node_ids[0]
    if (firstNodeId) {
      editorRef.current?.scrollToCanvasNode(firstNodeId, { topOffset: 16 })
    }
    scheduleMeasure()
  }, [scheduleMeasure])

  const handlePointerOver = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) {
      setHoveredModuleId(null)
      return
    }

    const moduleNode = target.closest<HTMLElement>("[data-module-id]")
    const moduleId = moduleNode && event.currentTarget.contains(moduleNode)
      ? moduleNode.dataset.moduleId
      : undefined
    setHoveredModuleId(moduleId || null)
  }, [])

  return (
    <div
      ref={canvasRootRef}
      className="td-source-resume-canvas relative min-h-0"
      onPointerOver={handlePointerOver}
      onPointerLeave={() => setHoveredModuleId(null)}
    >
      <ResumeRichTextEditor
        ref={editorRef}
        ariaLabel="原始简历编辑区"
        docJson={canvas.doc_json as ResumeDocJson}
        moduleOutlineVisible={outlineVisible}
        onChange={handleEditorChange}
        onModuleOutlineVisibleChange={setOutlineVisible}
        onSourceCanvasModuleChange={setActiveModuleId}
      />
      <ModuleInteractionLayer
        regions={regions}
        activeModuleId={activeModuleId}
        hoveredModuleId={hoveredModuleId}
      />
      {outlineVisible ? (
        <DraggableModuleOutline
          anchors={anchors}
          activeModuleId={activeModuleId}
          expanded={outlineExpanded}
          position={outlinePosition ?? { x: 0, y: 0 }}
          bounds={outlineBounds}
          saveStatus={saveStatus}
          onRetrySave={onRetrySave}
          onExpandedChange={setOutlineExpanded}
          onPositionCommit={setOutlinePosition}
          onActivateModule={setActiveModuleId}
          onScrollToAnchor={scrollToAnchor}
        />
      ) : null}
    </div>
  )
}

export function DraftCanvas(props: DraftCanvasProps) {
  return <DraftCanvasWorkspace key={props.canvas.document_id} {...props} />
}
