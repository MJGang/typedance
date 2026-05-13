import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { listResumeVersions, deleteResumeVersion, getTemplateStyle } from "@/api"
import type { ResumeVersion, TemplateStyleConfig } from "@typedance/contracts"
import { ResumeCard } from "./ResumeCard"
import { NewResumeModal } from "./NewResumeModal"
import { defaultClassicA4Style } from "../templates/data"

export function HomePage() {
  const navigate = useNavigate()
  const [resumes, setResumes] = useState<ResumeVersion[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [styleMap, setStyleMap] = useState<Record<string, TemplateStyleConfig>>({})

  const loadResumes = useCallback(async () => {
    try {
      const list = await listResumeVersions()
      setResumes(list)
    } catch {
      // first visit: no resumes yet, that's OK
    }
  }, [])

  useEffect(() => { loadResumes() }, [loadResumes])

  // Load template styles for all unique template IDs
  const uniqueTemplateIds = useMemo(
    () => [...new Set(resumes.map((r) => r.template_id))],
    [resumes],
  )

  useEffect(() => {
    if (uniqueTemplateIds.length === 0) return

    let cancelled = false
    Promise.allSettled(
      uniqueTemplateIds.map(async (id) => {
        const style = await getTemplateStyle(id)
        return { templateId: id, style }
      }),
    ).then((results) => {
      if (cancelled) return
      const map: Record<string, TemplateStyleConfig> = {}
      for (const result of results) {
        if (result.status === "fulfilled") {
          map[result.value.templateId] = result.value.style
        }
      }
      setStyleMap(map)
    })
    return () => { cancelled = true }
  }, [uniqueTemplateIds])

  const handleDelete = useCallback(async (resumeId: string) => {
    await deleteResumeVersion(resumeId)
    setResumes((prev) => prev.filter((r) => r.id !== resumeId))
  }, [])

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">我的简历</h1>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          新建简历
        </Button>
      </div>

      {resumes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="mb-2 text-lg text-muted-foreground">还没有简历</p>
          <p className="mb-6 text-sm text-muted-foreground">创建你的第一份简历，从选择模板开始</p>
          <Button onClick={() => setModalOpen(true)}>创建第一份简历</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {resumes.map((resume) => (
            <ResumeCard
              key={resume.id}
              resume={resume}
              styleConfig={styleMap[resume.template_id] ?? defaultClassicA4Style}
              onClick={() => navigate(`/workspace/${resume.id}`)}
              onDelete={() => handleDelete(resume.id)}
            />
          ))}
        </div>
      )}

      <NewResumeModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  )
}
