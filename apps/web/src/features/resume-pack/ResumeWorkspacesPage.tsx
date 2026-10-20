import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FileUp, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import type { DocumentListItem } from "@typedance/contracts"
import { deleteRevisionDocument, listRevisionDocuments } from "@/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { BlankGuidedResumeModal } from "../home/BlankGuidedResumeModal"
import { ImportOldResumeModal } from "../home/ImportOldResumeModal"
import { resumePackPaths } from "./routes"
import { RevisionWorkspaceCard } from "./RevisionWorkspaceCard"
import { useResumePackNavigation } from "./ResumePackNavigation"

export function ResumeWorkspacesPage() {
  const navigate = useNavigate()
  const { documentsVersion, documentsChanged } = useResumePackNavigation()
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [guidedOpen, setGuidedOpen] = useState(false)
  const [documentPendingDelete, setDocumentPendingDelete] = useState<DocumentListItem | null>(null)
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null)

  const openImportModal = () => {
    setGuidedOpen(false)
    setImportOpen(true)
  }

  const openGuidedModal = () => {
    setImportOpen(false)
    setGuidedOpen(true)
  }

  const loadDocuments = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const list = await listRevisionDocuments()
      setDocuments(list.filter((document) => document.pack_id === "resume"))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDocuments()
  }, [loadDocuments, documentsVersion])

  const handleDeleteDialogOpenChange = (open: boolean) => {
    if (open || deletingDocumentId) return
    setDocumentPendingDelete(null)
  }

  const confirmDeleteDocument = async () => {
    if (!documentPendingDelete) return

    const target = documentPendingDelete
    setDeletingDocumentId(target.id)
    try {
      await deleteRevisionDocument(target.id)
      documentsChanged(target.id)
      setDocuments((currentDocuments) => currentDocuments.filter((document) => document.id !== target.id))
      setDocumentPendingDelete(null)
      toast.success("工作台已删除", {
        description: target.title,
      })
    } catch {
      toast.error("删除工作台失败", {
        description: "请稍后重试。",
      })
    } finally {
      setDeletingDocumentId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">工作台</h1>
          <p className="mt-1 text-sm text-muted-foreground">继续处理导入重构、质量检查和修改建议。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openImportModal}>
            <FileUp className="mr-2 size-4" />
            导入旧简历
          </Button>
          <Button onClick={openGuidedModal}>
            <Plus className="mr-2 size-4" />
            新建简历
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          加载工作台
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="mb-2 text-lg text-muted-foreground">工作台加载失败</p>
          <Button variant="outline" onClick={() => void loadDocuments()}>
            重试
          </Button>
        </div>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="mb-2 text-lg text-muted-foreground">还没有工作台</p>
          <p className="mb-6 text-sm text-muted-foreground">导入旧简历或新建简历来开始改稿。</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={openImportModal}>
              <FileUp className="mr-2 size-4" />
              导入旧简历
            </Button>
            <Button variant="outline" onClick={openGuidedModal}>
              新建简历
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-6 gap-y-8">
          {documents.map((document) => (
            <RevisionWorkspaceCard
              key={document.id}
              document={document}
              onOpen={() => navigate(resumePackPaths.workspace(document.id))}
              onDeleteRequest={() => setDocumentPendingDelete(document)}
              deleting={deletingDocumentId === document.id}
            />
          ))}
        </div>
      )}

      <ImportOldResumeModal open={importOpen} onOpenChange={setImportOpen} />
      <BlankGuidedResumeModal open={guidedOpen} onOpenChange={setGuidedOpen} />
      <Dialog open={documentPendingDelete !== null} onOpenChange={handleDeleteDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除「{documentPendingDelete?.title}」？</DialogTitle>
            <DialogDescription>
              删除后无法恢复。该工作台的来源、画布、改稿记录、建议和导出记录都会从本机移除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deletingDocumentId !== null}
              onClick={() => setDocumentPendingDelete(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingDocumentId !== null}
              onClick={() => void confirmDeleteDocument()}
            >
              {deletingDocumentId ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              删除工作台
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
