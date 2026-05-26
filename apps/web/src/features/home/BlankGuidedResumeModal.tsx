import { FormEvent, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, Sparkles } from "lucide-react"
import { startBlankGuidedResume } from "@/api"
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

type BlankGuidedResumeModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BlankGuidedResumeModal({ open, onOpenChange }: BlankGuidedResumeModalProps) {
  const navigate = useNavigate()
  const [title, setTitle] = useState("新简历")
  const [identityStatus, setIdentityStatus] = useState("社招")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [targetRole, setTargetRole] = useState("")
  const [skills, setSkills] = useState("")
  const [workExperience, setWorkExperience] = useState("")
  const [projectExperience, setProjectExperience] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle("新简历")
    setIdentityStatus("社招")
    setName("")
    setPhone("")
    setEmail("")
    setTargetRole("")
    setSkills("")
    setWorkExperience("")
    setProjectExperience("")
    setSubmitting(false)
    setError(null)
  }, [open])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const hasSignal = [name, targetRole, skills, workExperience, projectExperience].some((value) => value.trim())
    if (!hasSignal) {
      setError("请至少填写一个基础线索。")
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const workspace = await startBlankGuidedResume({
        title: title.trim() || "新简历",
        identity_status: identityStatus,
        name,
        phone,
        email,
        target_role: targetRole,
        skills,
        work_experience: workExperience,
        project_experience: projectExperience,
      })
      onOpenChange(false)
      navigate(resumePackPaths.workspace(workspace.document.id))
    } catch {
      setError("生成失败，请稍后重试。")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>新建简历</DialogTitle>
          <DialogDescription>先给我一点线索，我会生成可审阅的初稿和后续补充任务。</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="blank-guided-title">项目名称</Label>
              <Input
                id="blank-guided-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="blank-guided-identity">身份状态</Label>
              <Input
                id="blank-guided-identity"
                value={identityStatus}
                onChange={(event) => setIdentityStatus(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="blank-guided-name">姓名</Label>
              <Input
                id="blank-guided-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="blank-guided-target-role">目标方向</Label>
              <Input
                id="blank-guided-target-role"
                value={targetRole}
                onChange={(event) => setTargetRole(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="blank-guided-phone">电话</Label>
              <Input
                id="blank-guided-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="blank-guided-email">邮箱</Label>
              <Input
                id="blank-guided-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitting}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="blank-guided-skills">技能</Label>
            <Textarea
              id="blank-guided-skills"
              className="min-h-20 resize-y"
              value={skills}
              onChange={(event) => setSkills(event.target.value)}
              disabled={submitting}
              placeholder="Vue3、TypeScript、FastAPI"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="blank-guided-work">工作经历线索</Label>
              <Textarea
                id="blank-guided-work"
                className="min-h-28 resize-y"
                value={workExperience}
                onChange={(event) => setWorkExperience(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="blank-guided-project">项目经历线索</Label>
              <Textarea
                id="blank-guided-project"
                className="min-h-28 resize-y"
                value={projectExperience}
                onChange={(event) => setProjectExperience(event.target.value)}
                disabled={submitting}
              />
            </div>
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
              {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
              生成初稿
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
