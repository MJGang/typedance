import type { DocumentListItem } from "@typedance/contracts"
import { Button } from "@/components/ui/button"
import { PreviewShowcaseCard } from "@/components/preview-showcase-card"
import { ClipboardCheck, FileText } from "lucide-react"

type RevisionWorkspaceCardProps = {
  document: DocumentListItem
  onOpen: () => void
}

export function RevisionWorkspaceCard({ document, onOpen }: RevisionWorkspaceCardProps) {
  const statusLabel = getQualityStateLabel(document.quality_state)
  const timeLabel = getRelativeTime(document.updated_at)

  return (
    <PreviewShowcaseCard
      title={document.title}
      subtitle={`${statusLabel} · ${timeLabel}`}
      onClick={onOpen}
      previewClassName="bg-muted/40"
      preview={
        <div className="flex aspect-[210/297] w-full flex-col items-center justify-center gap-3 bg-card px-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ClipboardCheck className="size-6" />
          </div>
          <div className="grid gap-1">
            <p className="text-sm font-medium text-foreground">{statusLabel}</p>
            <p className="text-xs text-muted-foreground">{document.target_language}</p>
          </div>
        </div>
      }
      floatingActions={
        <Button size="sm" aria-label={`打开${document.title}`} onClick={onOpen}>
          <FileText className="mr-2 size-4" />
          打开
        </Button>
      }
    />
  )
}

function getQualityStateLabel(state: DocumentListItem["quality_state"]): string {
  switch (state) {
    case "ready":
      return "可导出"
    case "blocked":
      return "有阻塞"
    case "needs_review":
      return "需检查"
    default:
      return "待检查"
  }
}

function getRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(isoString).toLocaleDateString()
}
