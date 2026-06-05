import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ModuleAnchor, SourceResumeCanvas } from "@typedance/contracts"
import type { ResumeDocJson, ResumeEditorChange } from "../workspace/editor"
import { defaultClassicA4Style } from "../templates/data"
import { generateWorkspaceCSS } from "../templates/style-engine/css-generator"
import {
  ResumeRichTextEditor,
  type ResumeRichTextEditorHandle,
} from "../workspace/components/ResumeRichTextEditor"
import {
  DraggableModuleOutline,
  type DraftCanvasSaveStatus,
} from "./DraggableModuleOutline"
import {
  getDefaultModuleOutlinePosition,
  loadModuleOutlinePreferences,
  saveModuleOutlinePreferences,
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

const SOURCE_CANVAS_CLASSIC_CSS = generateWorkspaceCSS(
  defaultClassicA4Style.blocks ?? {},
  ".td-source-resume-canvas .rm-with-pagination",
)

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

function getSourceCanvasViewport(root: HTMLElement): HTMLElement | null {
  return root.closest<HTMLElement>(".td-source-resume-canvas-viewport")
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
  const [outlineVisible, setOutlineVisible] = useState(initialPreferences?.visible ?? true)
  const [outlineExpanded, setOutlineExpanded] = useState(initialPreferences?.expanded ?? true)
  const [outlinePosition, setOutlinePosition] = useState<Position | null>(
    initialPreferences?.position ?? null,
  )
  const outlinePositionRef = useRef(outlinePosition)
  const [outlineBounds, setOutlineBounds] = useState<Size>({ width: 0, height: 0 })
  outlinePositionRef.current = outlinePosition

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return

    frameRef.current = requestMeasureFrame(() => {
      frameRef.current = null
      const root = canvasRootRef.current
      if (!root) return

      const viewport = getSourceCanvasViewport(root)
      const nextBounds = getElementSize(viewport ?? root)
      setOutlineBounds((currentBounds) => (
        sameSize(currentBounds, nextBounds) ? currentBounds : nextBounds
      ))

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
  }, [])

  useEffect(() => {
    const root = canvasRootRef.current
    if (!root) return

    const viewport = getSourceCanvasViewport(root)
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

  return (
    <div
      ref={canvasRootRef}
      className="td-source-resume-canvas relative min-h-0"
    >
      <ResumeRichTextEditor
        ref={editorRef}
        ariaLabel="原始简历编辑区"
        cssText={SOURCE_CANVAS_CLASSIC_CSS}
        docJson={canvas.doc_json as ResumeDocJson}
        moduleOutlineVisible={outlineVisible}
        onChange={handleEditorChange}
        onModuleOutlineVisibleChange={setOutlineVisible}
        onSourceCanvasModuleChange={setActiveModuleId}
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
