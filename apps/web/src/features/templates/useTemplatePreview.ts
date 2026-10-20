import { useEffect, useState } from "react"
import type { DocumentListItem, WorkspaceView } from "@typedance/contracts"
import { getRevisionWorkspaceView, listRevisionDocuments } from "@/api"
import { useResumePackNavigation } from "../resume-pack/ResumePackNavigation"
import { resumePackPaths } from "../resume-pack/routes"
import { flushSourceCanvasSaves } from "../revision/useSourceCanvasAutosave"

export const DEMO_PREVIEW_ID = "demo"

export function useTemplatePreview() {
  const { resume, documentsVersion } = useResumePackNavigation()
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [listStatus, setListStatus] = useState<"loading" | "ready" | "error">("loading")
  const [result, setResult] = useState<{ id: string; workspace?: WorkspaceView; error?: boolean } | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    setListStatus("loading")
    void listRevisionDocuments().then((items) => {
      if (cancelled) return
      const resumes = items.filter((item) => item.pack_id === "resume")
      setDocuments(resumes)
      setPreviewId((current) => current === DEMO_PREVIEW_ID || resumes.some((item) => item.id === current)
        ? current : (resumes.find((item) => resumePackPaths.workspace(item.id) === resume)?.id ?? resumes[0]?.id ?? DEMO_PREVIEW_ID))
      setListStatus("ready")
    }).catch(() => { if (!cancelled) setListStatus("error") })
    return () => { cancelled = true }
  }, [documentsVersion, refresh, resume])

  useEffect(() => {
    if (!previewId || previewId === DEMO_PREVIEW_ID) return
    let cancelled = false
    void (async () => {
      if (!await flushSourceCanvasSaves(previewId)) throw new Error("unsaved")
      if (cancelled) return undefined
      return getRevisionWorkspaceView(previewId)
    })().then((workspace) => {
      if (!cancelled && workspace) setResult({ id: previewId, workspace })
    }).catch(() => { if (!cancelled) setResult({ id: previewId, error: true }) })
    return () => { cancelled = true }
  }, [previewId, refresh])

  const selectedDocument = documents.find((item) => item.id === previewId)
  const isDemo = previewId === DEMO_PREVIEW_ID
  const currentResult = result?.id === previewId ? result : null
  const error = listStatus === "error" ? "简历列表加载失败" : currentResult?.error ? "简历预览加载失败" : null
  const loading = listStatus === "loading" || (!isDemo && !currentResult && !error)
  const workspace = currentResult?.workspace
  const empty = !!workspace && !workspace.source_resume_canvas
  return {
    documents, previewId: previewId ?? DEMO_PREVIEW_ID, setPreviewId, selectedDocument, isDemo,
    docJson: workspace?.source_resume_canvas?.doc_json, loading, error, empty,
    retry: () => { setResult(null); setRefresh((value) => value + 1) },
  }
}
