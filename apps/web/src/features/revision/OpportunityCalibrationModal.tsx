import { FormEvent, useEffect, useState } from "react"
import { BriefcaseBusiness, Loader2 } from "lucide-react"
import { calibrateRevisionOpportunity } from "@/api"
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

type OpportunityCalibrationModalProps = {
  documentId: string
  baseDraftId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted: () => Promise<void> | void
}

export function OpportunityCalibrationModal({
  documentId,
  baseDraftId,
  open,
  onOpenChange,
  onCompleted,
}: OpportunityCalibrationModalProps) {
  const [title, setTitle] = useState("岗位信息")
  const [rawText, setRawText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle("岗位信息")
    setRawText("")
    setSubmitting(false)
    setError(null)
  }, [open])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!rawText.trim()) {
      setError("请先粘贴岗位信息。")
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await calibrateRevisionOpportunity(documentId, baseDraftId, {
        title: title.trim() || "岗位信息",
        raw_text: rawText,
      })
      onOpenChange(false)
      await onCompleted()
    } catch {
      setError("岗位校准失败，请稍后重试。")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>岗位校准</DialogTitle>
          <DialogDescription>基于当前基础简历生成岗位版本，并标记缺口和风险。</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="opportunity-title">岗位名称</Label>
            <Input
              id="opportunity-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="opportunity-content">岗位信息</Label>
            <Textarea
              id="opportunity-content"
              className="min-h-60 resize-y"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              disabled={submitting}
              placeholder="粘贴岗位描述或招聘要求"
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
              {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <BriefcaseBusiness className="mr-2 size-4" />}
              生成岗位版本
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
