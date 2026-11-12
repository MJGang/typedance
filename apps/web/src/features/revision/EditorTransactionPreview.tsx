import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { Editor } from "@tiptap/core"
import type { EditorTransaction, TemplateStyleConfig } from "@typedance/contracts"
import { generateWorkspaceTemplateCSS } from "@typedance/resume-renderer"
import { Button } from "@/components/ui/button"
import { ResumeRichTextEditor } from "../workspace/components/ResumeRichTextEditor"
import type { ResumeDocJson } from "../workspace/editor"
import { documentMargins, documentTemplateStyle } from "./documentLayout"
import { getEditorPreviewChanges } from "./editorPreviewChanges"
import { measureEditorPreview, type PreviewInk } from "./editorPreviewGeometry"
import "./EditorTransactionPreview.css"

const ignorePreviewChanges = () => {}

function TextParticles({ left, top, width, height, original, font, color }: Omit<PreviewInk, "key">) {
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
      if (progress < 1) frame = requestAnimationFrame(render)
    }
    render(started)
    return () => cancelAnimationFrame(frame)
  }, [width, height, original, font, color])

  return <canvas ref={ref} className="td-preview-ink pointer-events-none absolute motion-reduce:hidden" style={{ left, top, width, height }} />
}

function PreviewOverlay({ editor, transaction, onReady }: { editor: Editor; transaction: EditorTransaction; onReady: () => void }) {
  const layerRef = useRef<HTMLDivElement>(null)
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
          const first = geometry.cards[0]
          const scroller = layer.closest<HTMLElement>(".td-editor-print-wrapper")
          if (first && scroller) {
            const layerRect = layer.getBoundingClientRect()
            const scale = layerRect.height / layer.offsetHeight || 1
            scroller.scrollTop += layerRect.top - scroller.getBoundingClientRect().top + first.top * scale - scroller.clientHeight * 0.28
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

  return <div ref={layerRef} aria-hidden="true" className="pointer-events-none absolute inset-0" data-td-preview-overlay="">
    {layout?.cards.map(({ key, ...style }) => <div key={key} data-td-preview-region={key} className="td-preview-region absolute" style={style} />)}
    {layout?.ink.map(({ key, ...ink }) => <TextParticles key={key} {...ink} />)}
  </div>
}

export default function EditorTransactionPreview({ transaction, templateStyle, onClose }: {
  transaction: EditorTransaction
  templateStyle: TemplateStyleConfig
  onClose: () => void
}) {
  const id = `editor-preview-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const doc = transaction.doc_json as ResumeDocJson
  const style = useMemo(() => documentTemplateStyle(doc, transaction.before_template_style ?? templateStyle), [doc, transaction.before_template_style, templateStyle])
  const margins = useMemo(() => documentMargins(doc), [doc])
  const css = useMemo(() => generateWorkspaceTemplateCSS(style, `#${id} .rm-with-pagination`), [style, id])
  const [ready, setReady] = useState(false)
  const onReady = useCallback(() => setReady(true), [])
  const renderOverlay = useCallback((editor: Editor) => <PreviewOverlay editor={editor} transaction={transaction} onReady={onReady} />, [transaction, onReady])

  return <section id={id} className="td-source-resume-canvas absolute inset-0 z-30 flex min-h-0 flex-col overflow-hidden bg-background" aria-label="简历修改预览" data-td-canvas-preview="">
    <div className="border-border flex min-h-10 items-center justify-between gap-2 border-b px-3">
      <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs" role="status">预览中 · 只读</span>
      <Button variant="ghost" size="sm" onClick={onClose}>取消预览</Button>
    </div>
    {!ready ? <p className="absolute inset-x-0 top-14 text-center text-sm text-muted-foreground" role="status">正在准备修改预览…</p> : null}
    <div className={ready ? "min-h-0 flex-1" : "invisible min-h-0 flex-1"}>
      <ResumeRichTextEditor ariaLabel="修改后的简历预览" docJson={doc} templateStyle={style} cssText={css} marginConfig={margins}
        editable={false} toolbarVisible={false} onChange={ignorePreviewChanges} renderDocumentOverlay={renderOverlay} />
    </div>
  </section>
}
