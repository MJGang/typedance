import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { Editor } from "@tiptap/core"
import type { EditorTransaction, TemplateStyleConfig } from "@typedance/contracts"
import { generateWorkspaceTemplateCSS } from "@typedance/resume-renderer"
import { ResumeRichTextEditor } from "../workspace/components/ResumeRichTextEditor"
import type { ResumeDocJson } from "../workspace/editor"
import { documentMargins, documentTemplateStyle } from "./documentLayout"
import { getEditorPreviewChanges } from "./editorPreviewChanges"
import { measureEditorPreview, type PreviewInk } from "./editorPreviewGeometry"
import "./EditorTransactionPreview.css"

const ignorePreviewChanges = () => {}

function TextParticles({ left, top, width, height, original, font, color, playing }: Omit<PreviewInk, "key"> & { playing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const scale = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.ceil(width * scale)
    canvas.height = Math.ceil(height * scale)
    canvas.style.opacity = "1"
    const bitmap = document.createElement("canvas")
    bitmap.width = canvas.width
    bitmap.height = canvas.height
    const painter = bitmap.getContext("2d", { willReadFrequently: true })
    if (!painter) return
    painter.scale(scale, scale)
    painter.font = font
    painter.fillStyle = color
    const metrics = painter.measureText(original)
    const baseline = (height + metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2
    painter.fillText(original, 0, baseline, width)

    const pixels = painter.getImageData(0, 0, bitmap.width, bitmap.height).data
    const fragments: { x: number; y: number; w: number; h: number; delay: number; dx: number; dy: number }[] = []
    const tile = Math.max(2, Math.round(2 * scale))
    for (let y = 0; y < bitmap.height; y += tile) {
      for (let x = 0; x < bitmap.width; x += tile) {
        const w = Math.min(tile, bitmap.width - x)
        const h = Math.min(tile, bitmap.height - y)
        let alpha = 0
        for (let row = 0; row < h; row++) {
          for (let col = 0; col < w; col++) alpha += pixels[((y + row) * bitmap.width + x + col) * 4 + 3]
        }
        if (alpha > 70) fragments.push({ x, y, w, h, delay: Math.random() * 0.3, dx: (Math.random() - 0.5) * 14 * scale, dy: (-3 - Math.random() * 7) * scale })
      }
    }

    let frame = 0
    const started = performance.now()
    const render = (now: number) => {
      const progress = Math.min(1, (now - started) / 1450)
      context.globalAlpha = 1
      context.fillStyle = "#f7f2e9"
      context.fillRect(0, 0, canvas.width, canvas.height)
      for (const piece of fragments) {
        const age = Math.max(0, (progress - piece.delay) / 0.37)
        if (age >= 1) continue
        context.globalAlpha = 1 - age
        context.drawImage(bitmap, piece.x, piece.y, piece.w, piece.h, piece.x + piece.dx * age, piece.y + piece.dy * age, piece.w, piece.h)
      }
      canvas.style.opacity = String(1 - Math.max(0, (progress - 0.46) / 0.54))
      if (playing && progress < 1) frame = requestAnimationFrame(render)
    }
    render(started)
    return () => cancelAnimationFrame(frame)
  }, [width, height, original, font, color, playing])

  return <canvas ref={ref} className="td-preview-ink pointer-events-none absolute motion-reduce:hidden" style={{ left, top, width, height }} />
}

function PreviewOverlay({ editor, transaction, onReady, ready }: { editor: Editor; transaction: EditorTransaction; onReady: () => void; ready: boolean }) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [layout, setLayout] = useState<ReturnType<typeof measureEditorPreview> | null>(null)
  useLayoutEffect(() => {
    if (editor.isDestroyed) return
    const view = editor.view
    const layer = layerRef.current
    if (!layer) return
    const before = editor.schema.nodeFromJSON(transaction.before_doc_json)
    const changes = getEditorPreviewChanges(before, view.state.doc, transaction.node_origins)
    let frame: number | null = null
    let closed = false
    let fontsReady = !document.fonts
    let positioned = false
    let lastLayout = ""
    const schedule = () => {
      if (closed || !fontsReady || frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        if (closed || editor.isDestroyed || !view.dom.isConnected) return
        const geometry = measureEditorPreview(view, layer, changes)
        if (!positioned) {
          const signature = JSON.stringify(geometry.cards)
          if (signature !== lastLayout) {
            lastLayout = signature
            schedule()
            return
          }
          positioned = true
          onReady()
        }
        setLayout(geometry)
      })
    }
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule)
    observer?.observe(view.dom)
    observer?.observe(layer)
    const mutations = new MutationObserver(schedule)
    mutations.observe(view.dom, { childList: true, subtree: true })
    void document.fonts?.ready.then(() => { fontsReady = true; schedule() })
    schedule()
    return () => {
      closed = true
      observer?.disconnect()
      mutations.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [editor, transaction, onReady])

  const hasLayout = layout !== null
  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!ready || !hasLayout || !layer) return
    const scroller = layer.closest<HTMLElement>(".td-editor-print-wrapper")
    if (!scroller) return
    const viewportTop = scroller.getBoundingClientRect().top + scroller.clientTop
    const viewportBottom = viewportTop + scroller.clientHeight
    const regions = Array.from(layer.querySelectorAll("[data-td-preview-region]"), card => card.getBoundingClientRect())
    if (!regions.length || regions.some(region => region.bottom > viewportTop && region.top < viewportBottom)) {
      setPlaying(true)
      return
    }
    const firstTop = Math.min(...regions.map(region => region.top))
    const top = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight,
      scroller.scrollTop + firstTop - viewportTop - scroller.clientHeight * 0.2))
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reducedMotion || Math.abs(top - scroller.scrollTop) < 1) {
      scroller.scrollTop = top
      setPlaying(true)
      return
    }

    let timer: number | undefined
    let frame: number
    let previous = scroller.scrollTop
    let lastMovement = performance.now()
    const waitUntilStill = (now: number) => {
      const current = scroller.scrollTop
      if (current !== previous) {
        previous = current
        lastMovement = now
      }
      if (Math.abs(current - top) < 1 || now - lastMovement >= 150) {
        timer = window.setTimeout(() => setPlaying(true), 180)
      } else frame = requestAnimationFrame(waitUntilStill)
    }
    scroller.scrollTo({ top, behavior: "smooth" })
    frame = requestAnimationFrame(waitUntilStill)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      if (timer === undefined) scroller.scrollTo({ top: scroller.scrollTop, behavior: "auto" })
    }
  }, [hasLayout, ready])

  return <div ref={layerRef} aria-hidden="true" className="pointer-events-none absolute inset-0" data-td-preview-overlay="" data-preview-playing={playing}>
    {layout?.cards.map(({ key, ...style }) => <div key={key} data-td-preview-region={key} className="td-preview-region absolute" style={style} />)}
    {layout?.ink.map(({ key, ...ink }) => <TextParticles key={key} {...ink} playing={playing} />)}
  </div>
}

export default function EditorTransactionPreview({ transaction, templateStyle, onReady, ready }: {
  transaction: EditorTransaction
  templateStyle: TemplateStyleConfig
  onReady: () => void
  ready: boolean
}) {
  const id = `editor-preview-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const doc = transaction.doc_json as ResumeDocJson
  const style = useMemo(() => documentTemplateStyle(doc, transaction.before_template_style ?? templateStyle), [doc, transaction.before_template_style, templateStyle])
  const margins = useMemo(() => documentMargins(doc), [doc])
  const css = useMemo(() => generateWorkspaceTemplateCSS(style, `#${id} .rm-with-pagination`), [style, id])
  const renderOverlay = useCallback((editor: Editor) => <PreviewOverlay editor={editor} transaction={transaction} onReady={onReady} ready={ready} />, [transaction, onReady, ready])

  return <section id={id} className={ready ? "relative" : "invisible h-0 overflow-clip"} aria-label="简历修改预览" data-td-canvas-preview="" data-preview-ready={ready}>
    <ResumeRichTextEditor ariaLabel="修改后的简历预览" docJson={doc} templateStyle={style} cssText={css} marginConfig={margins}
      editable={false} embedded onChange={ignorePreviewChanges} renderDocumentOverlay={renderOverlay} />
  </section>
}
