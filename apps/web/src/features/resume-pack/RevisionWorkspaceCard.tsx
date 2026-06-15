import type { DocumentListItem } from "@typedance/contracts"
import { PreviewShowcaseCard } from "@/components/preview-showcase-card"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ClipboardCheck, Loader2, Trash2 } from "lucide-react"

type RevisionWorkspaceCardProps = {
  document: DocumentListItem
  onOpen: () => void
  onDeleteRequest?: () => void
  deleting?: boolean
}

export function RevisionWorkspaceCard({
  document,
  onOpen,
  onDeleteRequest,
  deleting = false,
}: RevisionWorkspaceCardProps) {
  const statusLabel = getQualityStateLabel(document.quality_state)
  const timeLabel = getRelativeTime(document.updated_at)

  return (
    <PreviewShowcaseCard
      title={document.title}
      subtitle={`${statusLabel} · ${timeLabel}`}
      onClick={onOpen}
      interactiveLabel={`打开${document.title}`}
      menu={
        onDeleteRequest ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="cursor-pointer text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:border-destructive/40 focus-visible:ring-destructive/20"
                aria-label={`删除${document.title}`}
                disabled={deleting}
                onClick={(event) => {
                  event.stopPropagation()
                  onDeleteRequest()
                }}
              >
                {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>删除工作台</TooltipContent>
          </Tooltip>
        ) : undefined
      }
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
    />
  )
}

function getQualityStateLabel(state: DocumentListItem["quality_state"]): string {
  switch (state) {
    case "ready":
      return "已检查"
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
