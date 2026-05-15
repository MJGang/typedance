import { FileDown, ExternalLink, Loader2, CheckCircle2, XCircle } from "lucide-react"
import { useCallback } from "react"

export type ExportStatusType =
  | { type: "idle" }
  | { type: "exporting" }
  | { type: "saved"; fileName: string }
  | { type: "error"; message: string }

interface ExportStatusBarProps {
  status: ExportStatusType
  onOpenPdf: () => void
}

export function ExportStatusBar({ status, onOpenPdf }: ExportStatusBarProps) {
  const handleClick = useCallback(() => {
    if (status.type === "saved") {
      onOpenPdf()
    }
  }, [status, onOpenPdf])

  return (
    <div
      role="status"
      aria-live="polite"
      className="z-10 flex h-7 shrink-0 items-center justify-between border-t border-border bg-muted/40 px-3 py-0.5 text-xs text-muted-foreground/80"
    >
      {/* Left: status indicator */}
      <div className="flex items-center gap-2 min-w-0">
        {status.type === "idle" && <span>就绪</span>}

        {status.type === "exporting" && (
          <>
            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
            <span>正在导出 PDF...</span>
          </>
        )}

        {status.type === "saved" && (
          <>
            <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
            <span className="text-green-600 dark:text-green-400 font-medium">
              PDF 已保存
            </span>
          </>
        )}

        {status.type === "error" && (
          <>
            <XCircle className="h-3 w-3 text-destructive shrink-0" />
            <span className="text-destructive">{status.message}</span>
          </>
        )}
      </div>

      {/* Right: file path (only when saved) */}
      <div className="flex items-center gap-2 shrink-0 ml-4">
        {status.type === "saved" && (
          <button
            onClick={handleClick}
            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 transition-colors duration-150 hover:bg-muted-foreground/10 active:bg-muted-foreground/20 cursor-pointer text-muted-foreground hover:text-foreground group"
          >
            <FileDown className="h-3 w-3 shrink-0" />
            <span className="max-w-[240px] truncate">{status.fileName}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-0 -translate-x-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0" />
          </button>
        )}
      </div>
    </div>
  )
}
