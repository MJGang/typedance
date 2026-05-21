import { FormEvent, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, Wand2 } from "lucide-react"
import { importOldResume } from "@/api"
import { Button } from "@/components/ui/button"
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

type ImportOldResumeModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportOldResumeModal({ open, onOpenChange }: ImportOldResumeModalProps) {
  const navigate = useNavigate()
  const [title, setTitle] = useState("旧简历重构")
  const [rawText, setRawText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle("旧简历重构")
    setRawText("")
    setSubmitting(false)
    setError(null)
  }, [open])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!rawText.trim()) {
      setError("请先粘贴旧简历内容。")
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const workspace = await importOldResume({
        title: title.trim() || "旧简历重构",
        raw_text: rawText,
      })
      onOpenChange(false)
      navigate(`/revision/${workspace.document.id}`)
    } catch {
      setError("导入失败，请稍后重试。")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入旧简历</DialogTitle>
          <DialogDescription>系统会生成新版草稿、问题卡和可接受的修改建议。</DialogDescription>
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
          <div className="grid gap-2">
            <Label htmlFor="revision-import-content">旧简历内容</Label>
            <Textarea
              id="revision-import-content"
              className="min-h-64 resize-y"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              disabled={submitting}
              placeholder="粘贴已有简历文本"
            />
          </div>
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
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
