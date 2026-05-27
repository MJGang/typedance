import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { deleteResumeVersion, getTemplateStyle, listResumeVersions, projectLegacyResumeToRevisionWorkspace } from "@/api"
import type { ResumeVersion, TemplateStyleConfig } from "@typedance/contracts"
import { ResumeCard } from "../home/ResumeCard"
import { NewResumeModal } from "../home/NewResumeModal"
import { defaultClassicA4Style } from "../templates/data"
import { resumePackPaths } from "./routes"

export function ResumeProductsPage() {
  const navigate = useNavigate()
  const [resumes, setResumes] = useState<ResumeVersion[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [styleMap, setStyleMap] = useState<Record<string, TemplateStyleConfig>>({})

  const loadResumes = useCallback(async () => {
    try {
      const list = await listResumeVersions()
      setResumes(list)
    } catch {
      setResumes([])
    }
  }, [])

  useEffect(() => { void loadResumes() }, [loadResumes])

  const uniqueTemplateIds = useMemo(
    () => [...new Set(resumes.map((resume) => resume.template_id))],
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
      const nextStyleMap: Record<string, TemplateStyleConfig> = {}
      for (const result of results) {
        if (result.status === "fulfilled") {
          nextStyleMap[result.value.templateId] = result.value.style
        }
      }
      setStyleMap(nextStyleMap)
    })
    return () => { cancelled = true }
  }, [uniqueTemplateIds])

  const handleDelete = useCallback(async (resumeId: string) => {
    await deleteResumeVersion(resumeId)
    setResumes((prev) => prev.filter((resume) => resume.id !== resumeId))
  }, [])

  const handleOpenRevisionWorkspace = useCallback(async (resumeId: string) => {
    const workspace = await projectLegacyResumeToRevisionWorkspace(resumeId)
    navigate(resumePackPaths.workspace(workspace.document.id))
  }, [navigate])

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">简历成品</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理可编辑、可导出和可复用的简历版本。</p>
        </div>
        {resumes.length > 0 && (
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="mr-2 size-4" />
            从模板开始
          </Button>
        )}
      </div>

      {resumes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="mb-2 text-lg text-muted-foreground">还没有简历成品</p>
          <p className="mb-6 text-sm text-muted-foreground">从模板创建一份可编辑和导出的简历。</p>
          <Button onClick={() => setModalOpen(true)}>从模板开始</Button>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-6 gap-y-8">
          {resumes.map((resume) => (
            <ResumeCard
              key={resume.id}
              resume={resume}
              styleConfig={styleMap[resume.template_id] ?? defaultClassicA4Style}
              onClick={() => navigate(resumePackPaths.resume(resume.id))}
              onOpenRevision={() => void handleOpenRevisionWorkspace(resume.id)}
              onDelete={() => void handleDelete(resume.id)}
            />
          ))}
        </div>
      )}

      <NewResumeModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  )
}
