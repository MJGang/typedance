import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { FileUp, Plus } from "lucide-react"
import { listResumeVersions, deleteResumeVersion, getTemplateStyle, projectLegacyResumeToRevisionWorkspace } from "@/api"
import type { ResumeVersion, TemplateStyleConfig } from "@typedance/contracts"
import { ResumeCard } from "./ResumeCard"
import { NewResumeModal } from "./NewResumeModal"
import { ImportOldResumeModal } from "./ImportOldResumeModal"
import { BlankGuidedResumeModal } from "./BlankGuidedResumeModal"
import { defaultClassicA4Style } from "../templates/data"

export function HomePage() {
  const navigate = useNavigate()
  const [resumes, setResumes] = useState<ResumeVersion[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [guidedOpen, setGuidedOpen] = useState(false)
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

  const handleOpenRevisionWorkspace = useCallback(async (resumeId: string) => {
    const workspace = await projectLegacyResumeToRevisionWorkspace(resumeId)
    navigate(`/revision/${workspace.document.id}`)
  }, [navigate])

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">我的简历</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileUp className="mr-2 h-4 w-4" />
            导入旧简历
          </Button>
          <Button onClick={() => setGuidedOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            新建简历
          </Button>
        </div>
      </div>

      {resumes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="mb-2 text-lg text-muted-foreground">还没有简历</p>
          <p className="mb-6 text-sm text-muted-foreground">从旧简历重构，或创建一份新的简历。</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => setImportOpen(true)}>
              <FileUp className="mr-2 h-4 w-4" />
              导入旧简历
            </Button>
            <Button variant="outline" onClick={() => setGuidedOpen(true)}>创建第一份简历</Button>
            <Button variant="ghost" onClick={() => setModalOpen(true)}>从模板开始</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-6 gap-y-8">
          {resumes.map((resume) => (
            <ResumeCard
              key={resume.id}
              resume={resume}
              styleConfig={styleMap[resume.template_id] ?? defaultClassicA4Style}
              onClick={() => navigate(`/workspace/${resume.id}`)}
              onOpenRevision={() => handleOpenRevisionWorkspace(resume.id)}
              onDelete={() => handleDelete(resume.id)}
            />
          ))}
        </div>
      )}

      <ImportOldResumeModal open={importOpen} onOpenChange={setImportOpen} />
      <BlankGuidedResumeModal open={guidedOpen} onOpenChange={setGuidedOpen} />
      <NewResumeModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  )
}
