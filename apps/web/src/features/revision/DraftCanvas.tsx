import { useMemo, useRef, useState } from "react"
import { ChevronDown, ListTree } from "lucide-react"
import type { ModuleAnchor, SourceResumeCanvas } from "@typedance/contracts"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ResumeDocJson, ResumeEditorChange } from "../workspace/editor"
import {
  ResumeRichTextEditor,
  type ResumeRichTextEditorHandle,
} from "../workspace/components/ResumeRichTextEditor"

export type DraftCanvasSaveStatus = "idle" | "saving" | "saved" | "error"

type DraftCanvasProps = {
  canvas: SourceResumeCanvas
  onChange: (change: ResumeEditorChange) => void
  saveStatus: DraftCanvasSaveStatus
}

const outlineIndentClasses = ["pl-2", "pl-4", "pl-6", "pl-8"]

function saveStatusLabel(status: DraftCanvasSaveStatus) {
  if (status === "saving") return "正在保存"
  if (status === "saved") return "已保存"
  if (status === "error") return "保存失败"
  return ""
}

export function DraftCanvas({ canvas, onChange, saveStatus }: DraftCanvasProps) {
  const editorRef = useRef<ResumeRichTextEditorHandle>(null)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const anchors = useMemo(
    () => [...canvas.module_anchors].sort((left, right) => left.order - right.order),
    [canvas.module_anchors],
  )

  const scrollToAnchor = (anchor: ModuleAnchor) => {
    const firstNodeId = anchor.canvas_node_ids[0]
    if (firstNodeId) editorRef.current?.scrollToCanvasNode(firstNodeId)
  }

  return (
    <div className="relative min-h-0">
      <aside
        aria-label="简历模块大纲"
        className="absolute right-3 top-12 z-20 w-52 border border-border bg-background/95 shadow-sm backdrop-blur"
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-between rounded-none"
          aria-expanded={outlineOpen}
          aria-label={outlineOpen ? "折叠模块大纲" : "展开模块大纲"}
          onClick={() => setOutlineOpen((value) => !value)}
        >
          <span className="inline-flex items-center gap-2">
            <ListTree className="size-4" />
            模块大纲
          </span>
          <ChevronDown className={cn("size-4 transition-transform duration-150", outlineOpen && "rotate-180")} />
        </Button>
        <span
          aria-live="polite"
          className={cn(
            "block min-h-5 border-t border-border px-2 py-1 text-xs text-muted-foreground",
            saveStatus === "error" && "text-destructive",
          )}
        >
          {saveStatusLabel(saveStatus)}
        </span>
        {outlineOpen ? (
          <div className="max-h-80 overflow-y-auto border-t border-border p-1">
            {anchors.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">暂无可用模块大纲。</p>
            ) : (
              anchors.map((anchor, index) => (
                <Button
                  key={anchor.module_id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-auto w-full justify-start whitespace-normal py-1.5 text-left text-xs",
                    outlineIndentClasses[Math.min(index, 3)],
                  )}
                  onClick={() => scrollToAnchor(anchor)}
                >
                  {anchor.title}
                </Button>
              ))
            )}
          </div>
        ) : null}
      </aside>
      <div className="td-source-resume-canvas">
        <ResumeRichTextEditor
          ref={editorRef}
          ariaLabel="原始简历编辑区"
          docJson={canvas.doc_json as ResumeDocJson}
          onChange={onChange}
        />
      </div>
    </div>
  )
}
