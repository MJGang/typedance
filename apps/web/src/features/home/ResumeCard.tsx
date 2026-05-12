import type { ResumeVersion } from "@typedance/contracts"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, FileText } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type ResumeCardProps = {
  resume: ResumeVersion
  onClick: () => void
  onRename?: () => void
  onDuplicate?: () => void
  onDelete: () => void
}

export function ResumeCard({ resume, onClick, onRename, onDuplicate, onDelete }: ResumeCardProps) {
  const timeAgo = getRelativeTime(resume.updated_at)

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm transition-colors hover:border-border-hover cursor-pointer"
      onClick={onClick}
    >
      {/* A4 ratio thumbnail (210:297 ≈ 3:4) */}
      <div className="aspect-[210/297] w-full bg-muted flex items-center justify-center overflow-hidden p-4">
        {resume.preview_pdf_url ? (
          <iframe
            src={resume.preview_pdf_url}
            className="pointer-events-none h-full w-full"
            title={resume.title}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <FileText className="h-8 w-8" />
            <span className="text-xs">{resume.template_id}</span>
          </div>
        )}
      </div>
      {/* Footer */}
      <div className="flex items-center justify-between border-t px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{resume.title}</p>
          <p className="text-xs text-muted-foreground">
            {resume.target_language} · {timeAgo}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onRename && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRename(); }}>重命名</DropdownMenuItem>}
            {onDuplicate && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>复制</DropdownMenuItem>}
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-destructive">删除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
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
