import { Eye, Globe2, PanelLeftClose, PanelLeftOpen, Sparkles } from "lucide-react"
import type { ReviewGateResult, TargetLanguage, WorkspaceCopy } from "../types"
import type { ResumeDocJson, ResumeEditorChange } from "../editor"
import { resumeActions } from "../data"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ResumeRichTextEditor } from "./ResumeRichTextEditor"

type ResumeCanvasProps = {
  copy: WorkspaceCopy
  docJson: ResumeDocJson
  preview: string
  title: string
  targetLanguage: TargetLanguage
  reviewGate: ReviewGateResult
  isJobPanelOpen: boolean
  onEditorChange: (change: ResumeEditorChange) => void
  onTargetLanguageChange: (language: TargetLanguage) => void
  onRunAction: () => void
  onToggleJobPanel: () => void
}

export function ResumeCanvas({
  copy,
  docJson,
  preview,
  title,
  targetLanguage,
  reviewGate,
  isJobPanelOpen,
  onEditorChange,
  onTargetLanguageChange,
  onRunAction,
  onToggleJobPanel,
}: ResumeCanvasProps) {
  const ToggleIcon = isJobPanelOpen ? PanelLeftClose : PanelLeftOpen

  return (
    <section className="td-canvas">
      <div className="td-canvas-toolbar">
        <div className="td-canvas-heading">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="td-panel-toggle"
            aria-label={isJobPanelOpen ? "Hide job target panel" : "Show job target panel"}
            aria-controls="job-target-panel"
            aria-expanded={isJobPanelOpen}
            onClick={onToggleJobPanel}
          >
            <ToggleIcon />
          </Button>
          <div>
            <p className="td-eyebrow">{copy.resumeCanvas}</p>
            <h1>{title}</h1>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Globe2 />
          <span>{copy.targetLanguage}</span>
          <Select value={targetLanguage} onValueChange={(value) => onTargetLanguageChange(value as TargetLanguage)}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="zh-CN">zh-CN</SelectItem>
                <SelectItem value="en-US">en-US</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </label>
      </div>

      <div className="td-document-grid">
        <section className="td-editor-shell" aria-labelledby="resume-editor-title">
          <div className="td-subhead">
            <h2 id="resume-editor-title">{copy.resumeText}</h2>
            <Dialog>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <Eye data-icon="inline-start" />
                  {copy.previewTitle}
                </Button>
              </DialogTrigger>
              <DialogContent className="td-preview-dialog">
                <DialogHeader>
                  <DialogTitle>{copy.previewTitle}</DialogTitle>
                  <DialogDescription>{reviewGate.status === "ready" ? "Ready" : "Needs review"}</DialogDescription>
                </DialogHeader>
                <div className="td-preview-modal-body">
                  <iframe title="A4 resume preview" aria-label="A4 resume preview" srcDoc={preview} />
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <ResumeRichTextEditor ariaLabel="Resume text" docJson={docJson} onChange={onEditorChange} />
          <div className="td-action-menu" aria-label={copy.actionMenu}>
            {resumeActions.map((action) => (
              <Button key={action.command} type="button" variant="outline" onClick={onRunAction}>
                <Sparkles data-icon="inline-start" />
                <span>{action.command}</span>
                <small>{action.label}</small>
              </Button>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}
