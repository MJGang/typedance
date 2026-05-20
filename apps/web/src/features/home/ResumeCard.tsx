import type { ResumeVersion, TemplateStyleConfig } from "@typedance/contracts"
import { Button } from "@/components/ui/button"
import { PreviewShowcaseCard } from "@/components/preview-showcase-card"
import { MoreHorizontal, FileText } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ResumePreview } from "./ResumePreview"

type ResumeCardProps = {
  resume: ResumeVersion
  styleConfig?: TemplateStyleConfig
  onClick: () => void
  onRename?: () => void
  onDuplicate?: () => void
  onDelete: () => void
}

export function ResumeCard({ resume, styleConfig, onClick, onRename, onDuplicate, onDelete }: ResumeCardProps) {
  const timeAgo = getRelativeTime(resume.updated_at)
  const hasPreview = styleConfig && resume.doc_json && typeof resume.doc_json === "object"

  return (
    <PreviewShowcaseCard
      title={resume.title}
      subtitle={`${resume.target_language} · ${timeAgo}`}
      onClick={onClick}
      preview={
        <div className="aspect-[210/297] w-full overflow-hidden bg-white">
          {hasPreview ? (
            <ResumePreview docJson={resume.doc_json} styleConfig={styleConfig} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
              <FileText className="h-8 w-8" />
              <span className="text-xs">{resume.template_id}</span>
            </div>
          )}
        </div>
      }
      menu={
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
            <Button variant="secondary" size="icon" className="h-8 w-8 bg-card/90 shadow-sm backdrop-blur-sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onRename && (
              <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onRename() }}>
                重命名
              </DropdownMenuItem>
            )}
            {onDuplicate && (
              <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onDuplicate() }}>
                复制
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={(event) => { event.stopPropagation(); onDelete() }}
              className="text-destructive"
            >
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  )
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
