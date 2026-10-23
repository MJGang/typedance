import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { Copy, FilePlus2, FileText, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import type { Document as ResumeDocument, DocumentListItem } from "@typedance/contracts"
import { deleteRevisionDocument, duplicateRevisionDocument, listRevisionDocuments, updateRevisionDocument } from "@/api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { CreateResumeDialog } from "./CreateResumeDialog"
import { cn } from "@/lib/utils"
import { resumePackPaths } from "./routes"
import { useResumePackNavigation } from "./ResumePackNavigation"
import { flushSourceCanvasSaves } from "../revision/useSourceCanvasAutosave"
import { migrateDocumentPageMargins } from "../revision/migratePageMargins"

export function ResumeDocumentList({ activeDocumentId, activeDocument, onDocumentRenamed, openFirstDocument = false }: {
  activeDocumentId?: string
  activeDocument?: { id: string; title: string }
  onDocumentRenamed?: (document: ResumeDocument) => void
  openFirstDocument?: boolean
}) {
  const navigate = useNavigate()
  const { key: locationKey, pathname } = useLocation()
  const currentLocationKey = useRef<string | null>(locationKey)
  const { documentsVersion, documentsChanged } = useResumePackNavigation()
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [action, setAction] = useState<{ kind: "rename" | "delete"; document: DocumentListItem } | null>(null)
  const [nameDraft, setNameDraft] = useState("")
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const actionInFlight = useRef(false)
  const activeId = activeDocumentId ?? activeDocument?.id
  const initialSelectionPending = useRef(openFirstDocument)
  useEffect(() => {
    currentLocationKey.current = locationKey
    return () => { currentLocationKey.current = null }
  }, [locationKey])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    void listRevisionDocuments().then((items) => {
      if (cancelled) return
      const resumes = items.filter((item) => item.pack_id === "resume")
      setDocuments(resumes)
      if (initialSelectionPending.current && !activeId) {
        initialSelectionPending.current = false
        if (resumes[0]) navigate(resumePackPaths.workspace(resumes[0].id), { replace: true })
      }
    }).catch(() => {
      if (!cancelled) setError(true)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [activeId, refresh, documentsVersion, navigate])

  const handleDuplicate = async (item: DocumentListItem) => {
    if (actionInFlight.current) return
    actionInFlight.current = true
    setBusy(true)
    setActionError(null)
    const requestedAtLocation = locationKey
    try {
      if (!await flushSourceCanvasSaves(item.id)) throw new Error("unsaved")
      await migrateDocumentPageMargins(item.id)
      const copy = await duplicateRevisionDocument(item.id)
      documentsChanged()
      if (currentLocationKey.current === requestedAtLocation) navigate(resumePackPaths.workspace(copy.id))
    } catch (error) {
      setActionError(error instanceof Error && error.message === "unsaved" ? "简历尚未保存成功，请先重试保存。" : "简历复制失败，请稍后重试。")
    } finally { actionInFlight.current = false; setBusy(false) }
  }

  const handleConfirm = async () => {
    if (!action || actionInFlight.current || (action.kind === "rename" && !nameDraft.trim())) return
    actionInFlight.current = true
    setBusy(true)
    setActionError(null)
    const requestedAtLocation = locationKey
    try {
      if (action.kind === "rename") {
        const updated = await updateRevisionDocument(action.document.id, { title: nameDraft.trim() })
        setDocuments((items) => items.map((item) => item.id === updated.id ? { ...item, title: updated.title } : item))
        onDocumentRenamed?.(updated)
        documentsChanged()
      } else {
        if (!await flushSourceCanvasSaves(action.document.id)) throw new Error("unsaved")
        await deleteRevisionDocument(action.document.id)
        setDocuments((items) => items.filter((item) => item.id !== action.document.id))
        documentsChanged(action.document.id)
        if (pathname === resumePackPaths.workspace(action.document.id) && currentLocationKey.current === requestedAtLocation) {
          const next = documents.find((item) => item.id !== action.document.id)
          navigate(next ? resumePackPaths.workspace(next.id) : resumePackPaths.workspaces, { replace: true })
        }
      }
      setAction(null)
    } catch (error) {
      setActionError(error instanceof Error && error.message === "unsaved" ? "简历尚未保存成功，请先重试保存。" : action.kind === "rename" ? "重命名失败，请稍后重试。" : "删除失败，请稍后重试。")
    } finally { actionInFlight.current = false; setBusy(false) }
  }
  return (
    <section aria-label="我的简历" className="flex min-h-0 flex-col gap-3 px-3 pb-4">
      <h2 className="px-1 text-sm font-semibold">我的简历</h2>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="min-w-0 flex-1" onClick={() => { initialSelectionPending.current = false; setCreateOpen(true) }}>
          <FilePlus2 data-icon="inline-start" />新建简历
        </Button>
      </div>
      <div className="flex max-h-64 min-h-0 flex-col gap-1 overflow-y-auto">
        {loading ? <Skeleton className="h-9 w-full" /> : error ? (
          <div className="px-1 text-xs text-muted-foreground">
            <p role="alert">简历列表加载失败</p>
            <Button variant="ghost" size="sm" onClick={() => setRefresh((value) => value + 1)}>重试</Button>
          </div>
        ) : documents.length === 0 ? <p className="px-1 py-2 text-xs text-muted-foreground">还没有简历。</p> : documents.map((document) => {
          const item = activeDocument && document.id === activeDocument.id ? { ...document, title: activeDocument.title } : document
          return (
          <div key={item.id} className={cn("group flex items-center rounded-xl", item.id === activeId && "bg-sidebar-accent")}>
          <Button asChild variant="ghost" className="min-w-0 flex-1 justify-start">
            <Link to={resumePackPaths.workspace(item.id)} aria-current={item.id === activeId ? "page" : undefined}
              aria-label={`打开简历 ${activeDocument && item.id === activeDocument.id ? activeDocument.title : item.title}`}>
              <FileText data-icon="inline-start" /><span className="truncate">{activeDocument && item.id === activeDocument.id ? activeDocument.title : item.title}</span>
            </Link>
          </Button>
          <DropdownMenu><DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" className="mr-1 shrink-0" aria-label={`管理简历 ${item.title}`} disabled={busy}><MoreHorizontal /></Button>
          </DropdownMenuTrigger><DropdownMenuContent side="right" align="start"><DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => void handleDuplicate(item)}><Copy />复制</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { setAction({ kind: "rename", document: item }); setNameDraft(item.title); setActionError(null) }}><Pencil />重命名</DropdownMenuItem>
          </DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onSelect={() => { setAction({ kind: "delete", document: item }); setActionError(null) }}><Trash2 />删除</DropdownMenuItem>
          </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
          </div>
        )})}
      </div>
      {!action && actionError ? <p role="alert" className="px-1 text-xs text-destructive">{actionError}</p> : null}
      {busy && !action ? <p role="status" className="px-1 text-xs text-muted-foreground">正在复制简历…</p> : null}
      <Dialog open={action !== null} onOpenChange={(open) => { if (!open && !busy) { setAction(null); setActionError(null) } }}>
        <DialogContent onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }} onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}>
          <DialogHeader><DialogTitle>{action?.kind === "rename" ? "重命名简历" : `删除简历「${action?.document.title}」？`}</DialogTitle>
            <DialogDescription>{action?.kind === "rename" ? "修改简历在列表中显示的名称。" : "删除后无法恢复，关联的本地原始文件不会被删除。"}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => { event.preventDefault(); void handleConfirm() }}>
            {action?.kind === "rename" ? <FieldGroup><Field><FieldLabel htmlFor="resume-list-name">简历名称</FieldLabel><Input id="resume-list-name" maxLength={10} value={nameDraft} disabled={busy} onChange={(event) => setNameDraft(Array.from(event.target.value).slice(0, 10).join(""))} autoFocus /></Field></FieldGroup> : null}
            {actionError ? <p role="alert" className="mt-2 text-sm text-destructive">{actionError}</p> : null}
            <DialogFooter className="mt-4"><Button type="button" variant="outline" disabled={busy} onClick={() => { setAction(null); setActionError(null) }}>取消</Button>
              <Button type="submit" variant={action?.kind === "delete" ? "destructive" : "default"} disabled={busy || (action?.kind === "rename" && !nameDraft.trim())}>{action?.kind === "rename" ? "保存名称" : "删除简历"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {createOpen ? <CreateResumeDialog onClose={() => setCreateOpen(false)} onCreated={() => documentsChanged()} /> : null}
    </section>
  )
}
