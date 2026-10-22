import { useId, useRef, useState, type DragEvent, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, FilePlus2, FileText, Loader2, Upload, UploadCloud, X } from "lucide-react"
import { createBlankResume, importOldResume, type ImportOldResumeProgressStep } from "@/api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { resumePackPaths } from "./routes"

const ACCEPTED_FILE_TYPES = ".pdf,.doc,.docx,.md,.markdown,.txt"
const SUPPORTED_EXTENSIONS = new Set(["pdf", "doc", "docx", "md", "markdown", "txt"])
const IMPORT_PROGRESS_LABELS: Record<ImportOldResumeProgressStep, string> = {
  create_document: "正在创建简历…",
  save_source: "正在提取内容并准备画布…",
  load_workspace: "正在打开简历…",
}

export function CreateResumeDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const navigate = useNavigate()
  const id = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const submissionPending = useRef(false)
  const [mode, setMode] = useState("blank")
  const [source, setSource] = useState("file")
  const [blankTitle, setBlankTitle] = useState("未命名简历")
  const [importTitle, setImportTitle] = useState<string | null>(null)
  const [rawText, setRawText] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [progressStep, setProgressStep] = useState<ImportOldResumeProgressStep | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isImport = mode === "import"
  const fileTitle = file?.name.replace(/\.[^.]+$/, "") ?? ""
  const title = isImport ? importTitle ?? (source === "file" ? fileTitle : "") : blankTitle
  const canSubmit = !isImport || (source === "file" ? file !== null : rawText.trim().length > 0)

  function selectFile(nextFile: File) {
    if (submissionPending.current) return
    const extension = nextFile.name.split(".").pop()?.toLowerCase() ?? ""
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      setError("支持 PDF、Word、Markdown 或 TXT 文件。")
      return
    }
    if (nextFile.size === 0) {
      setError("文件内容为空，请选择其他文件。")
      return
    }
    setFile(nextFile)
    setError(null)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const droppedFile = event.dataTransfer.files[0]
    if (droppedFile) selectFile(droppedFile)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionPending.current || !canSubmit) return
    submissionPending.current = true
    setSubmitting(true)
    setError(null)
    setProgressStep(null)
    try {
      const workspace = isImport
        ? await importOldResume({
          title: title.trim() || "未命名简历",
          ...(source === "file" && file ? { file } : { raw_text: rawText }),
        }, setProgressStep)
        : await createBlankResume({ title: title.trim() || "未命名简历" })
      onCreated()
      onClose()
      navigate(resumePackPaths.workspace(workspace.document.id))
    } catch {
      setError(isImport ? "导入失败，请检查内容后重试。" : "创建失败，请稍后重试。")
    } finally {
      submissionPending.current = false
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submissionPending.current) onClose() }}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[620px]"
        showCloseButton={!submitting}
        onEscapeKeyDown={(event) => { if (submissionPending.current) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (submissionPending.current) event.preventDefault() }}
      >
        <DialogHeader>
          <DialogTitle>新建简历</DialogTitle>
          <DialogDescription>从空白开始，或导入已有内容。</DialogDescription>
        </DialogHeader>
        <form className="flex min-w-0 flex-col gap-6" onSubmit={handleSubmit} aria-busy={submitting}>
          <ToggleGroup
            type="single" variant="outline" spacing={0} value={mode} disabled={submitting}
            aria-label="创建方式"
            className="h-12 w-full overflow-hidden rounded-xl border border-border [&>[data-slot=toggle-group-item]]:h-full [&>[data-slot=toggle-group-item]]:flex-1 [&>[data-slot=toggle-group-item]]:border-0"
            onValueChange={(value) => {
              if (value === "blank" || value === "import") { setMode(value); setError(null) }
            }}
          >
            <ToggleGroupItem value="blank"><FilePlus2 data-icon="inline-start" />空白简历</ToggleGroupItem>
            <ToggleGroupItem value="import"><Upload data-icon="inline-start" />导入已有简历</ToggleGroupItem>
          </ToggleGroup>
          <FieldGroup className="gap-4">
            <Field data-disabled={submitting}>
              <FieldLabel htmlFor={`${id}-title`}>简历名称</FieldLabel>
              <Input
                id={`${id}-title`} value={title} disabled={submitting}
                placeholder={isImport && source === "file" ? "默认使用文件名，可修改" : "未命名简历"}
                onChange={(event) => isImport ? setImportTitle(event.target.value) : setBlankTitle(event.target.value)}
              />
              {!isImport ? <FieldDescription>创建后即可在画布中自由编辑。</FieldDescription> : null}
            </Field>
            {isImport ? (
              <Field data-disabled={submitting} data-invalid={!!error}>
                <Tabs value={source} onValueChange={(value) => { setSource(value); setError(null) }} className="gap-4">
                  <TabsList variant="line" aria-label="导入方式">
                    <TabsTrigger value="file" disabled={submitting}><UploadCloud />上传文件</TabsTrigger>
                    <TabsTrigger value="text" disabled={submitting}><FileText />粘贴文本</TabsTrigger>
                  </TabsList>
                  <TabsContent value="file">
                    <input
                      ref={fileInputRef} type="file" className="sr-only" tabIndex={-1}
                      aria-label="选择简历文件" accept={ACCEPTED_FILE_TYPES} disabled={submitting}
                      onChange={(event) => {
                        const nextFile = event.target.files?.[0]
                        if (nextFile) selectFile(nextFile)
                        event.target.value = ""
                      }}
                    />
                    <div
                      className="flex h-44 min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 text-center"
                      data-testid="resume-file-dropzone" aria-disabled={submitting}
                      onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}
                    >
                      {file ? (
                        <>
                          <FileText className="size-6 text-muted-foreground" />
                          <p className="max-w-full truncate text-sm font-medium" title={file.name}>{file.name}</p>
                          <div className="flex items-center gap-2">
                            <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={() => fileInputRef.current?.click()}>更换文件</Button>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label="移除文件" disabled={submitting} onClick={() => { setFile(null); setError(null) }}><X /></Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <UploadCloud className="size-6 text-muted-foreground" />
                          <p className="text-sm font-medium">拖拽简历文件到这里</p>
                          <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={() => fileInputRef.current?.click()}>选择文件</Button>
                          <p className="text-xs text-muted-foreground">支持 PDF、Word、Markdown、TXT</p>
                        </>
                      )}
                    </div>
                  </TabsContent>
                  <TabsContent value="text">
                    <FieldLabel className="sr-only" htmlFor={`${id}-text`}>简历内容</FieldLabel>
                    <Textarea
                      id={`${id}-text`} className="h-44 field-sizing-fixed resize-none overflow-y-auto"
                      placeholder={"在这里粘贴已有简历内容…\n支持纯文本或 Markdown"}
                      value={rawText} disabled={submitting} aria-invalid={!!error}
                      onChange={(event) => { setRawText(event.target.value); setError(null) }}
                    />
                  </TabsContent>
                </Tabs>
                <FieldDescription>{source === "file" ? "导入后可直接编辑，原有排版可能有所变化。" : "导入后可直接编辑，也可继续补充内容。"}</FieldDescription>
              </Field>
            ) : null}
          </FieldGroup>
          {error ? <FieldError role="alert">{error}</FieldError> : null}
          {submitting ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {isImport && progressStep ? IMPORT_PROGRESS_LABELS[progressStep] : "正在创建简历…"}
            </p>
          ) : null}
          <Separator />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>取消</Button>
            <Button type="submit" disabled={submitting || !canSubmit}>
              {isImport ? "导入并打开" : "创建并打开"}
              {!isImport ? <ArrowRight data-icon="inline-end" /> : null}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
