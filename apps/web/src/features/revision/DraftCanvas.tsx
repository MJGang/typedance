import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import type { ModuleAnchor, SourceResumeCanvas } from "@typedance/contracts"
import { generateWorkspaceTemplateCSS } from "@typedance/resume-renderer"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { TemplateStyleConfig } from "../templates/types"
import type { ResumeDocJson, ResumeEditorChange } from "../workspace/editor"
import { defaultClassicA4Style } from "../templates/data"
import {
  ResumeRichTextEditor,
  type ResumeRichTextEditorHandle,
} from "../workspace/components/ResumeRichTextEditor"
import {
  DraggableModuleOutline,
  type DraftCanvasSaveStatus,
} from "./DraggableModuleOutline"
import {
  getModuleOutlineLayout,
} from "./moduleInteractions"
import { PageMarginGuides, type PageBounds } from "./PageMarginGuides"
import {
  DEFAULT_SOURCE_CANVAS_PAGE_MARGINS,
  SOURCE_CANVAS_PAGE_SIZE,
  clampPageMargins,
  loadPageMarginPreferences,
  savePageMarginPreferences,
  type PageMargins,
} from "./pageMargins"

export type { DraftCanvasSaveStatus } from "./DraggableModuleOutline"

type DraftCanvasProps = {
  canvas: SourceResumeCanvas
  patchFlash?: CanvasPatchFlash | null
  onChange: (change: ResumeEditorChange) => void
  onPageCountChange?: (pageCount: number) => void
  onPageMarginsChange?: (margins: PageMargins) => void
  onRetrySave?: () => void
  saveError?: string | null
  saveStatus: DraftCanvasSaveStatus
  templateStyle?: TemplateStyleConfig
  toolbarVisible?: boolean
  toolbarEnd?: ReactNode
}

type Size = { width: number; height: number }

type PageNavigationState = {
  currentPageIndex: number
  pageTops: number[]
}

export type CanvasPatchFlash = {
  sequence: number
  canvasNodeIds?: string[]
  sourceBlockIds?: string[]
  moduleIds?: string[]
}

type OutlineAnchorWithLevel = ModuleAnchor & {
  outline_level?: number | null
  heading_index?: number
}

function collectHeadingAnchors(docJson: ResumeDocJson): OutlineAnchorWithLevel[] {
  const anchors: OutlineAnchorWithLevel[] = []
  let headingIndex = 0

  const getNodeText = (node: unknown): string => {
    if (!node || typeof node !== "object") return ""
    const n = node as { text?: unknown; content?: unknown[] }
    if (typeof n.text === "string") return n.text
    let text = ""
    for (const child of n.content ?? []) {
      text += getNodeText(child)
    }
    return text
  }

  const visitNode = (node: unknown) => {
    if (!node || typeof node !== "object") return
    const currentNode = node as {
      attrs?: Record<string, unknown>
      content?: unknown[]
      type?: unknown
    }
    if (currentNode.type !== "heading") {
      for (const child of currentNode.content ?? []) {
        visitNode(child)
      }
      return
    }

    const attrs = currentNode.attrs
    const currentHeadingIndex = headingIndex
    headingIndex += 1
    const title = getNodeText(currentNode).trim()
    if (!title) return

    const level = typeof attrs?.level === "number" && Number.isFinite(attrs.level) && attrs.level > 0
      ? attrs.level
      : null
    const canvasNodeId = typeof attrs?.canvasNodeId === "string" && attrs.canvasNodeId
      ? attrs.canvasNodeId
      : null
    const moduleId = typeof attrs?.moduleId === "string" && attrs.moduleId
      ? attrs.moduleId
      : `heading_${currentHeadingIndex}`

    anchors.push({
      module_id: moduleId,
      canvas_node_ids: canvasNodeId ? [canvasNodeId] : [],
      title,
      order: anchors.length,
      outline_level: level,
      heading_index: currentHeadingIndex,
    })
  }

  visitNode(docJson)
  return anchors
}

function sameSize(left: Size, right: Size) {
  return left.width === right.width && left.height === right.height
}

function samePageBounds(left: PageBounds | null, right: PageBounds | null) {
  if (left === null || right === null) return left === right
  return (
    left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height
  )
}

function samePageNavigationState(left: PageNavigationState, right: PageNavigationState) {
  return (
    left.currentPageIndex === right.currentPageIndex
    && left.pageTops.length === right.pageTops.length
    && left.pageTops.every((top, index) => top === right.pageTops[index])
  )
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

function getEditorPrintWrapper(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(".td-editor-print-wrapper")
}

function getCanvasPatchFlashTargets(root: HTMLElement, flash: CanvasPatchFlash): HTMLElement[] {
  const canvasNodeIds = new Set(flash.canvasNodeIds ?? [])
  const sourceBlockIds = new Set(flash.sourceBlockIds ?? [])
  const moduleIds = new Set(flash.moduleIds ?? [])
  if (canvasNodeIds.size === 0 && sourceBlockIds.size === 0 && moduleIds.size === 0) {
    return []
  }
  return Array.from(root.querySelectorAll<HTMLElement>("[data-canvas-node-id], [data-source-block-id], [data-module-id]"))
    .filter((element) => (
      canvasNodeIds.has(element.getAttribute("data-canvas-node-id") ?? "")
      || sourceBlockIds.has(element.getAttribute("data-source-block-id") ?? "")
      || moduleIds.has(element.getAttribute("data-module-id") ?? "")
    ))
}

function readPositivePixelVariable(element: HTMLElement, name: string): number | null {
  const value = window.getComputedStyle(element).getPropertyValue(name)
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}


function getFirstPageBounds(root: HTMLElement): PageBounds | null {
  const paginatedEditor = root.querySelector<HTMLElement>(".rm-with-pagination")
  if (!paginatedEditor) return null

  const rootRect = root.getBoundingClientRect()
  const editorRect = paginatedEditor.getBoundingClientRect()
  const pageWidth = readPositivePixelVariable(paginatedEditor, "--rm-page-width")
    ?? editorRect.width
  const pageHeight = readPositivePixelVariable(paginatedEditor, "--rm-page-height")
    ?? SOURCE_CANVAS_PAGE_SIZE.height
  if (pageWidth <= 0 || pageHeight <= 0 || editorRect.width <= 0) return null

  return {
    x: editorRect.left - rootRect.left,
    y: editorRect.top - rootRect.top,
    width: pageWidth,
    height: pageHeight,
  }
}

function getPageNavigationState(root: HTMLElement): PageNavigationState {
  const printWrapper = getEditorPrintWrapper(root)
  const paginatedEditor = root.querySelector<HTMLElement>(".rm-with-pagination")
  const pageBreakElements = Array.from(root.querySelectorAll<HTMLElement>(".rm-with-pagination .page"))
  if (!printWrapper || !paginatedEditor || pageBreakElements.length === 0) {
    return { currentPageIndex: 0, pageTops: [] }
  }

  const wrapperRect = printWrapper.getBoundingClientRect()
  const toWrapperScrollTop = (element: HTMLElement) => (
    printWrapper.scrollTop
    + element.getBoundingClientRect().top
    - wrapperRect.top
  )
  const pageTops = [
    toWrapperScrollTop(paginatedEditor),
    ...pageBreakElements.slice(0, -1).map(toWrapperScrollTop),
  ].filter((top) => Number.isFinite(top))

  if (pageTops.length === 0) return { currentPageIndex: 0, pageTops: [] }

  const activationLine = printWrapper.scrollTop + Math.min(
    Math.max(printWrapper.clientHeight * 0.2, 48),
    160,
  )
  let currentPageIndex = 0
  for (let index = 0; index < pageTops.length; index += 1) {
    if (pageTops[index] <= activationLine) currentPageIndex = index
  }

  return { currentPageIndex, pageTops }
}

function getOutlineFrame(root: HTMLElement): { maxHeight: number; top: number } {
  const printWrapper = root.querySelector<HTMLElement>(".td-editor-print-wrapper")
  if (!printWrapper) return { maxHeight: 640, top: 0 }

  const rootRect = root.getBoundingClientRect()
  const wrapperRect = printWrapper.getBoundingClientRect()
  const toolbar = root.querySelector<HTMLElement>(".td-rich-editor-toolbar")
  const toolbarRect = toolbar?.getBoundingClientRect()
  const edgeGap = toolbarRect ? Math.max(0, wrapperRect.top - toolbarRect.bottom) : 0

  return {
    maxHeight: Math.max(32, rootRect.bottom - wrapperRect.top - edgeGap),
    top: Math.max(0, wrapperRect.top - rootRect.top),
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

function SourceCanvasPageNavigator({
  currentPageIndex,
  left,
  maxHeight,
  onJumpToPage,
  pageCount,
  top,
}: {
  currentPageIndex: number
  left: number
  maxHeight: number
  onJumpToPage: (pageIndex: number) => void
  pageCount: number
  top: number
}) {
  if (pageCount <= 1) return null

  const canGoPrevious = currentPageIndex > 0
  const canGoNext = currentPageIndex < pageCount - 1

  return (
    <div
      className="td-module-interaction-only absolute z-20"
      data-testid="source-page-navigator-shell"
      style={{
        "--td-source-page-navigator-max-height": `${Math.max(96, maxHeight)}px`,
        left: `${left}px`,
        top: `${Math.max(0, top)}px`,
      } as CSSProperties}
    >
      <nav
        aria-label="页面跳转"
        data-testid="source-page-navigator"
        className="flex w-11 flex-col items-center rounded-md border border-border bg-background/90 p-1.5 shadow-sm backdrop-blur-xl"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="跳转到上一页"
          title="跳转到上一页"
          disabled={!canGoPrevious}
          className="size-7 rounded-sm"
          onClick={() => onJumpToPage(currentPageIndex - 1)}
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <div className="my-1 flex max-h-[calc(var(--td-source-page-navigator-max-height)-4.5rem)] min-h-0 flex-col gap-1 overflow-y-auto">
          {Array.from({ length: pageCount }, (_, pageIndex) => {
            const pageNumber = pageIndex + 1
            const active = pageIndex === currentPageIndex
            return (
              <Button
                key={pageNumber}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-current={active ? "page" : undefined}
                aria-label={`跳转到第 ${pageNumber} 页`}
                title={`跳转到第 ${pageNumber} 页`}
                data-testid={`source-page-navigator-page-${pageNumber}`}
                className={cn(
                  "size-7 rounded-sm text-xs font-semibold tabular-nums transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                    : "text-muted-foreground hover:bg-primary/5 hover:text-primary",
                )}
                onClick={() => onJumpToPage(pageIndex)}
              >
                {pageNumber}
              </Button>
            )
          })}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="跳转到下一页"
          title="跳转到下一页"
          disabled={!canGoNext}
          className="size-7 rounded-sm"
          onClick={() => onJumpToPage(currentPageIndex + 1)}
        >
          <ChevronDown className="size-3.5" />
        </Button>
      </nav>
    </div>
  )
}

function DraftCanvasWorkspace({
  canvas,
  patchFlash,
  onChange,
  onPageCountChange,
  onPageMarginsChange,
  onRetrySave,
  saveError,
  saveStatus,
  templateStyle = defaultClassicA4Style,
  toolbarVisible = true,
  toolbarEnd,
}: DraftCanvasProps) {
  const editorRef = useRef<ResumeRichTextEditorHandle>(null)
  const canvasRootRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const [currentDocJson, setCurrentDocJson] = useState<ResumeDocJson>(
    () => canvas.doc_json as ResumeDocJson,
  )
  const anchors = useMemo<OutlineAnchorWithLevel[]>(
    () => collectHeadingAnchors(currentDocJson),
    [currentDocJson],
  )
  const sourceCanvasCss = useMemo(
    () => generateWorkspaceTemplateCSS(
      templateStyle,
      ".td-source-resume-canvas .rm-with-pagination",
    ),
    [templateStyle],
  )
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null)
  const [outlineVisible, setOutlineVisible] = useState(false)
  const [outlineExpanded, setOutlineExpanded] = useState(true)
  const [pageNavigatorVisible, setPageNavigatorVisible] = useState(false)
  const [viewportSize, setViewportSize] = useState<Size>({ width: 0, height: 0 })
  const [pageBounds, setPageBounds] = useState<PageBounds | null>(null)
  const [pageNavigationState, setPageNavigationState] = useState<PageNavigationState>({
    currentPageIndex: 0,
    pageTops: [],
  })
  const [outlineMaxHeight, setOutlineMaxHeight] = useState(640)
  const [outlineTop, setOutlineTop] = useState(0)
  const [pageMarginGuidesVisible, setPageMarginGuidesVisible] = useState(false)
  const [pageMargins, setPageMargins] = useState<PageMargins>(() => (
    loadPageMarginPreferences(canvas.document_id, SOURCE_CANVAS_PAGE_SIZE)
    ?? DEFAULT_SOURCE_CANVAS_PAGE_MARGINS
  ))
  const outlineLayout = useMemo(
    () => getModuleOutlineLayout(
      viewportSize,
      pageBounds?.width ?? SOURCE_CANVAS_PAGE_SIZE.width,
    ),
    [pageBounds?.width, viewportSize],
  )
  const outlineReservedWidth = outlineVisible && outlineExpanded ? outlineLayout.reservedWidth : 0
  const pageNavigatorLeft = pageBounds
    ? Math.min(
      Math.max(8, pageBounds.x + pageBounds.width + 16),
      Math.max(8, viewportSize.width - 56),
    )
    : 0

  useEffect(() => {
    setCurrentDocJson(canvas.doc_json as ResumeDocJson)
  }, [canvas.doc_json])

  useEffect(() => {
    setActiveModuleId((currentModuleId) => {
      if (!currentModuleId) return currentModuleId
      return anchors.some((anchor) => anchor.module_id === currentModuleId)
        ? currentModuleId
        : null
    })
  }, [anchors])

  const measureCanvas = useCallback(() => {
    const root = canvasRootRef.current
    if (!root) return

    const viewport = getSourceCanvasViewport(root)
    const nextBounds = getElementSize(viewport ?? root)
    setViewportSize((currentBounds) => (
      sameSize(currentBounds, nextBounds) ? currentBounds : nextBounds
    ))
    const nextPageBounds = getFirstPageBounds(root)
    setPageBounds((currentBounds) => (
      samePageBounds(currentBounds, nextPageBounds) ? currentBounds : nextPageBounds
    ))
    const nextPageNavigationState = getPageNavigationState(root)
    setPageNavigationState((currentState) => (
      samePageNavigationState(currentState, nextPageNavigationState)
        ? currentState
        : nextPageNavigationState
    ))
    onPageCountChange?.(Math.max(1, nextPageNavigationState.pageTops.length))
    const nextOutlineFrame = getOutlineFrame(root)
    setOutlineTop((currentTop) => (
      currentTop === nextOutlineFrame.top ? currentTop : nextOutlineFrame.top
    ))
    setOutlineMaxHeight((currentHeight) => (
      currentHeight === nextOutlineFrame.maxHeight ? currentHeight : nextOutlineFrame.maxHeight
    ))
  }, [onPageCountChange])

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return

    frameRef.current = requestMeasureFrame(() => {
      frameRef.current = null
      measureCanvas()
    })
  }, [measureCanvas])

  useLayoutEffect(() => {
    measureCanvas()
  }, [currentDocJson, measureCanvas])

  useEffect(() => {
    const root = canvasRootRef.current
    if (!root) return

    const viewport = getSourceCanvasViewport(root)
    const printWrapper = getEditorPrintWrapper(root)
    const prosemirror = root.querySelector<HTMLElement>(".ProseMirror")
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleMeasure)

    resizeObserver?.observe(root)
    if (viewport) {
      resizeObserver?.observe(viewport)
      viewport.addEventListener("scroll", scheduleMeasure, { passive: true })
    }
    if (printWrapper) {
      resizeObserver?.observe(printWrapper)
      printWrapper.addEventListener("scroll", scheduleMeasure, { passive: true })
    }
    if (prosemirror) resizeObserver?.observe(prosemirror)
    scheduleMeasure()

    return () => {
      resizeObserver?.disconnect()
      viewport?.removeEventListener("scroll", scheduleMeasure)
      printWrapper?.removeEventListener("scroll", scheduleMeasure)
      if (frameRef.current !== null) {
        cancelMeasureFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [scheduleMeasure])

  useEffect(() => {
    scheduleMeasure()
  }, [currentDocJson, outlineExpanded, outlineVisible, scheduleMeasure])

  useEffect(() => {
    savePageMarginPreferences(canvas.document_id, pageMargins, SOURCE_CANVAS_PAGE_SIZE)
    onPageMarginsChange?.(pageMargins)
  }, [
    canvas.document_id,
    onPageMarginsChange,
    pageMargins.bottom,
    pageMargins.left,
    pageMargins.right,
    pageMargins.top,
  ])

  const handleEditorChange = useCallback((change: ResumeEditorChange) => {
    setCurrentDocJson(change.docJson)
    onChange(change)
    scheduleMeasure()
  }, [onChange, scheduleMeasure])

  const handlePageMarginsChange = useCallback((margins: PageMargins) => {
    const nextMargins = clampPageMargins(margins, SOURCE_CANVAS_PAGE_SIZE)
    setPageMargins(nextMargins)
    editorRef.current?.updatePageMargins(nextMargins)
    scheduleMeasure()
  }, [scheduleMeasure])

  const scrollToPage = useCallback((pageIndex: number) => {
    const root = canvasRootRef.current
    if (!root) return
    const printWrapper = getEditorPrintWrapper(root)
    if (!printWrapper) return

    const nextPageNavigationState = getPageNavigationState(root)
    const targetTop = nextPageNavigationState.pageTops[pageIndex]
    if (!Number.isFinite(targetTop)) return

    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    printWrapper.scrollTo({
      top: Math.max(0, targetTop - 16),
      behavior,
    })
    setPageNavigationState({
      currentPageIndex: pageIndex,
      pageTops: nextPageNavigationState.pageTops,
    })
    scheduleMeasure()
  }, [scheduleMeasure])

  const scrollToAnchor = useCallback((anchor: ModuleAnchor) => {
    setActiveModuleId(anchor.module_id)
    const outlineAnchor = anchor as OutlineAnchorWithLevel
    if (outlineAnchor.heading_index !== undefined) {
      editorRef.current?.scrollToHeadingIndex(outlineAnchor.heading_index, { topOffset: 16 })
    } else {
      const firstNodeId = anchor.canvas_node_ids[0]
      if (firstNodeId) {
        editorRef.current?.scrollToCanvasNode(firstNodeId, { topOffset: 16 })
      }
    }
    setOutlineExpanded(false)
    scheduleMeasure()
  }, [scheduleMeasure])

  const handleCanvasPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!outlineExpanded) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (!target.closest(".td-editor-print-wrapper")) return

    setOutlineExpanded(false)
  }, [outlineExpanded])

  useEffect(() => {
    if (!patchFlash) return
    const root = canvasRootRef.current
    if (!root) return

    const targets = getCanvasPatchFlashTargets(root, patchFlash)
    const flashTargets = targets.length > 0
      ? targets
      : [root.querySelector<HTMLElement>(".td-rich-editor-content") ?? root]
    for (const target of flashTargets) {
      target.classList.remove("td-ai-canvas-flash")
      void target.offsetWidth
      target.classList.add("td-ai-canvas-flash")
    }
    const timeout = window.setTimeout(() => {
      for (const target of flashTargets) {
        target.classList.remove("td-ai-canvas-flash")
      }
    }, 1800)
    return () => {
      window.clearTimeout(timeout)
      for (const target of flashTargets) {
        target.classList.remove("td-ai-canvas-flash")
      }
    }
  }, [patchFlash])

  return (
    <div
      ref={canvasRootRef}
      className="td-source-resume-canvas relative flex h-full min-h-0 flex-col overflow-hidden"
      data-outline-layout={outlineLayout.docked ? "docked" : "floating"}
      data-outline-expanded={outlineReservedWidth > 0 ? "true" : undefined}
      data-toolbar-visible={toolbarVisible ? "true" : "false"}
      onPointerDownCapture={handleCanvasPointerDown}
      style={{
        "--td-module-outline-reserved-width": `${outlineReservedWidth}px`,
      } as CSSProperties}
    >
      <ResumeRichTextEditor
        ref={editorRef}
        ariaLabel="原始简历编辑区"
        cssText={sourceCanvasCss}
        docJson={currentDocJson}
        canvasVersion={canvas.version}
        templateStyle={templateStyle}
        marginConfig={pageMargins}
        pageMarginGuidesVisible={pageMarginGuidesVisible}
        moduleOutlineVisible={outlineVisible}
        pageNavigatorVisible={pageNavigatorVisible}
        toolbarVisible={toolbarVisible}
        onChange={handleEditorChange}
        onModuleOutlineVisibleChange={setOutlineVisible}
        onPageNavigatorVisibleChange={setPageNavigatorVisible}
        onPageMarginGuidesVisibleChange={setPageMarginGuidesVisible}
        onSourceCanvasModuleChange={setActiveModuleId}
        toolbarEnd={toolbarEnd}
      />
      {pageMarginGuidesVisible && pageBounds ? (
        <PageMarginGuides
          margins={pageMargins}
          pageBounds={pageBounds}
          pageSize={SOURCE_CANVAS_PAGE_SIZE}
          onMarginsChange={handlePageMarginsChange}
        />
      ) : null}
      {!outlineVisible && saveStatus === "error" ? (
        <div
          className="absolute left-3 z-20 flex items-center gap-2 rounded-md border border-destructive/30 bg-background px-3 py-1 text-xs text-destructive shadow-sm"
          style={{ top: outlineTop }}
          title={saveError ?? undefined}
        >
          <span aria-live="polite">保存失败</span>
          {onRetrySave ? (
            <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onRetrySave}>
              重试保存
            </Button>
          ) : null}
        </div>
      ) : null}
      {outlineVisible ? (
        <DraggableModuleOutline
          anchors={anchors}
          activeModuleId={activeModuleId}
          expanded={outlineExpanded}
          floating={!outlineLayout.docked}
          outlineMaxHeight={outlineMaxHeight}
          outlineTop={outlineTop}
          panelWidth={outlineLayout.panelWidth}
          saveStatus={saveStatus}
          saveError={saveError}
          onRetrySave={onRetrySave}
          onExpandedChange={setOutlineExpanded}
          onActivateModule={setActiveModuleId}
          onScrollToAnchor={scrollToAnchor}
        />
      ) : null}
      {pageNavigatorVisible && pageBounds ? (
        <SourceCanvasPageNavigator
          currentPageIndex={pageNavigationState.currentPageIndex}
          left={pageNavigatorLeft}
          maxHeight={outlineMaxHeight}
          pageCount={pageNavigationState.pageTops.length}
          top={outlineTop}
          onJumpToPage={scrollToPage}
        />
      ) : null}
    </div>
  )
}

export function DraftCanvas(props: DraftCanvasProps) {
  return <DraftCanvasWorkspace key={props.canvas.document_id} {...props} />
}
