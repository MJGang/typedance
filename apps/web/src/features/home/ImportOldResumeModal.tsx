import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FileText, Loader2, UploadCloud, Wand2, X } from "lucide-react"
import { importOldResume, type ImportOldResumeProgressStep } from "@/api"
import { Button } from "@/components/ui/button"
import { resumePackPaths } from "../resume-pack/routes"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

const ACCEPTED_RESUME_FILE_TYPES = ".pdf,.doc,.docx,.md,.markdown,.txt"
const SUPPORTED_RESUME_FILE_EXTENSIONS = new Set(["pdf", "doc", "docx", "md", "markdown", "txt"])
const IMPORT_PROGRESS_LABELS: Record<ImportOldResumeProgressStep, string> = {
  create_document: "创建工作台",
  save_source: "保存旧简历",
  run_import: "解析原文、生成画布并识别模块",
  load_workspace: "打开可编辑画布",
}

type ImportOldResumeModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportOldResumeModal({ open, onOpenChange }: ImportOldResumeModalProps) {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState("旧简历重构")
  const [rawText, setRawText] = useState("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [progressSteps, setProgressSteps] = useState<ImportOldResumeProgressStep[]>([])
  const [error, setError] = useState<string | null>(null)
  const hasPastedText = rawText.trim().length > 0
  const disabled = submitting

  useEffect(() => {
    if (!open) return
    setTitle("旧简历重构")
    setRawText("")
    setSelectedFile(null)
    setSubmitting(false)
    setProgressSteps([])
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [open])

  function handleRawTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    if (selectedFile) {
      setError("已选择文件，不能同时粘贴内容。")
      return
    }
    setRawText(event.target.value)
    setError(null)
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    selectFile(file)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (!file) return
    selectFile(file)
  }

  function selectFile(file: File) {
    if (hasPastedText) {
      setError("已粘贴内容，不能同时选择文件。")
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }

    const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
    if (!SUPPORTED_RESUME_FILE_EXTENSIONS.has(extension)) {
      setError("支持 PDF、Word、Markdown 或 TXT 文件。")
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }

    setRawText("")
    setSelectedFile(file)
    setError(null)
  }

  function clearSelectedFile() {
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!rawText.trim() && !selectedFile) {
      setError("请粘贴简历内容或选择一个文件。")
      return
    }

    setSubmitting(true)
    setProgressSteps([])
    setError(null)
    try {
      const workspace = await importOldResume({
        title: title.trim() || "旧简历重构",
        ...(selectedFile ? { file: selectedFile } : { raw_text: rawText }),
      }, (step) => {
        setProgressSteps((steps) => steps.includes(step) ? steps : [...steps, step])
      })
      onOpenChange(false)
      navigate(resumePackPaths.workspace(workspace.document.id))
    } catch {
      setError("导入失败，请稍后重试。")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入旧简历</DialogTitle>
          <DialogDescription>系统会保留原始简历内容，并生成可直接编辑的工作台。</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="revision-import-title">项目名称</Label>
            <Input
              id="revision-import-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={submitting}
            />
          </div>
          {!hasPastedText && (
            <div className="grid gap-2">
              <Label htmlFor="revision-import-file">选择旧简历文件</Label>
              <div
                data-testid="resume-file-dropzone"
                aria-disabled={disabled}
                className={[
                  "grid gap-3 rounded-xl border border-dashed border-border bg-input/20 p-4 transition-colors",
                  disabled ? "opacity-60" : "hover:border-ring hover:bg-input/30",
                ].join(" ")}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                <div className="flex items-center gap-3">
                  <UploadCloud className="size-5 text-muted-foreground" />
                  <div className="grid gap-1">
                    <Label
                      htmlFor="revision-import-file"
                      className={disabled ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer"}
                    >
                      选择旧简历文件
                    </Label>
                    <p className="text-xs text-muted-foreground">PDF、Word、Markdown、TXT</p>
                  </div>
                </div>
                <Input
                  ref={fileInputRef}
                  id="revision-import-file"
                  type="file"
                  accept={ACCEPTED_RESUME_FILE_TYPES}
                  disabled={disabled}
                  onChange={handleFileInputChange}
                  className="h-auto rounded-xl py-2"
                />
                {selectedFile && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <FileText className="size-4 text-muted-foreground" />
                      <span className="truncate">{selectedFile.name}</span>
                    </span>
                    <Button type="button" variant="ghost" size="icon-xs" onClick={clearSelectedFile} disabled={submitting}>
                      <X className="size-3" />
                      <span className="sr-only">移除文件</span>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
          {!selectedFile && (
            <div className="grid gap-2">
              <Label htmlFor="revision-import-content">旧简历内容</Label>
              <Textarea
                id="revision-import-content"
                className="h-80 max-h-[45svh] field-sizing-fixed resize-y overflow-y-auto"
                value={rawText}
                onChange={handleRawTextChange}
                disabled={disabled}
                placeholder="粘贴已有简历文本"
              />
            </div>
          )}
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {submitting && progressSteps.length > 0 && (
            <div
              aria-live="polite"
              className="rounded-md border border-border bg-muted/30 p-3"
              role="status"
            >
              <p className="mb-2 text-sm font-medium">正在准备可编辑工作台</p>
              <ol className="space-y-1.5 text-sm text-muted-foreground">
                {progressSteps.map((step) => (
                  <li key={step} className="flex items-center gap-2">
                    <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{IMPORT_PROGRESS_LABELS[step]}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Wand2 className="mr-2 size-4" />}
              生成改稿工作台
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
