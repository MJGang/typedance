import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { FilePlus2, FileText, Upload } from "lucide-react"
import type { DocumentListItem } from "@typedance/contracts"
import { listRevisionDocuments } from "@/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BlankGuidedResumeModal } from "@/features/home/BlankGuidedResumeModal"
import { ImportOldResumeModal } from "@/features/home/ImportOldResumeModal"
import { cn } from "@/lib/utils"
import { resumePackPaths } from "./routes"

export function ResumeDocumentList({ activeDocument }: { activeDocument?: { id: string; title: string } }) {
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [dialog, setDialog] = useState<"new" | "import" | null>(null)
  const activeId = activeDocument?.id
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    void listRevisionDocuments().then((items) => {
      if (!cancelled) setDocuments(items.filter((item) => item.pack_id === "resume"))
    }).catch(() => {
      if (!cancelled) setError(true)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [activeId, refresh])
  return (
    <section aria-label="我的简历" className="flex min-h-0 flex-col gap-3 px-3 pb-4">
      <h2 className="px-1 text-sm font-semibold">我的简历</h2>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="min-w-0 flex-1" onClick={() => setDialog("new")}>
          <FilePlus2 data-icon="inline-start" />新建简历
        </Button>
        <Button variant="outline" size="sm" className="min-w-0 flex-1" onClick={() => setDialog("import")}>
          <Upload data-icon="inline-start" />导入
        </Button>
      </div>
      <div className="flex max-h-64 min-h-0 flex-col gap-1 overflow-y-auto">
        {loading ? <Skeleton className="h-9 w-full" /> : error ? (
          <div className="px-1 text-xs text-muted-foreground">
            <p role="alert">简历列表加载失败</p>
            <Button variant="ghost" size="sm" onClick={() => setRefresh((value) => value + 1)}>重试</Button>
          </div>
        ) : documents.length === 0 ? <p className="px-1 py-2 text-xs text-muted-foreground">还没有简历。</p> : documents.map((item) => (
          <Button key={item.id} asChild variant="ghost" className={cn("w-full justify-start", item.id === activeId && "bg-sidebar-accent")}>
            <Link to={resumePackPaths.workspace(item.id)} aria-current={item.id === activeId ? "page" : undefined}
              aria-label={`打开简历 ${activeDocument && item.id === activeDocument.id ? activeDocument.title : item.title}`}>
              <FileText data-icon="inline-start" /><span className="truncate">{activeDocument && item.id === activeDocument.id ? activeDocument.title : item.title}</span>
            </Link>
          </Button>
        ))}
      </div>
      <BlankGuidedResumeModal open={dialog === "new"} onOpenChange={(open) => { if (!open) setDialog(null) }} />
      <ImportOldResumeModal open={dialog === "import"} onOpenChange={(open) => { if (!open) setDialog(null) }} />
    </section>
  )
}
