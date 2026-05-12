import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { templateRegistry, builtInSamples, defaultClassicA4Style } from "../templates/data"
import { TemplatePreview } from "../templates/components/TemplatePreview"
import { createResumeVersion } from "@/api"

type NewResumeModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NewResumeModal({ open, onOpenChange }: NewResumeModalProps) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState<string | null>(null)

  const handleApply = async (templateId: string) => {
    setLoading(templateId)
    try {
      const template = templateRegistry.find(t => t.id === templateId)
      const sampleId = template?.sampleContentIds["zh-CN"] ?? "sample-tech-zh"
      const sample = builtInSamples[sampleId] ?? builtInSamples["sample-tech-zh"]
      const resume = await createResumeVersion({
        title: "未命名简历",
        target_language: "zh-CN",
        template_id: templateId,
        doc_json: sample.doc_json,
        plain_text_snapshot: sample.plain_text_snapshot,
      })
      onOpenChange(false)
      navigate(`/workspace/${resume.id}`)
    } catch {
      // handle error
    } finally {
      setLoading(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>选择模板</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-4 py-4">
          {templateRegistry.map((template) => (
            <div key={template.id} className="flex flex-col items-center gap-2">
              <div className="aspect-[210/297] w-full overflow-hidden rounded-lg border">
                <TemplatePreview
                  sample={builtInSamples[template.sampleContentIds["zh-CN"] ?? "sample-tech-zh"]}
                  styleConfig={defaultClassicA4Style}
                />
              </div>
              <p className="text-sm font-medium">{template.localizedName["zh-CN"]}</p>
              <Button
                size="sm"
                onClick={() => handleApply(template.id)}
                disabled={loading === template.id}
              >
                {loading === template.id ? "创建中..." : "应用"}
              </Button>
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-muted-foreground">
          也可以去 <Button variant="link" className="h-auto p-0" onClick={() => { onOpenChange(false); navigate("/templates"); }}>模板库</Button> 浏览更多
        </p>
      </DialogContent>
    </Dialog>
  )
}
