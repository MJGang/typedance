import type { KeyboardEvent, ReactNode } from "react"
import { cn } from "@/lib/utils"

type PreviewShowcaseCardProps = {
  title: ReactNode
  subtitle?: ReactNode
  preview: ReactNode
  actions?: ReactNode
  floatingActions?: ReactNode
  menu?: ReactNode
  selected?: boolean
  className?: string
  previewClassName?: string
  onClick?: () => void
}

export function PreviewShowcaseCard({
  title,
  subtitle,
  preview,
  actions,
  floatingActions,
  menu,
  selected = false,
  className,
  previewClassName,
  onClick,
}: PreviewShowcaseCardProps) {
  const interactive = typeof onClick === "function"
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <article
      className={cn(
        "group relative grid min-w-0 gap-3 rounded-lg p-2 text-center transition-colors duration-200",
        selected ? "bg-muted" : "bg-transparent hover:bg-muted/80",
        className,
      )}
    >
      {menu && (
        <div className="absolute right-3 top-3 z-20 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          {menu}
        </div>
      )}
      <div
        className={cn(
          "relative block w-full overflow-hidden rounded-md border border-border/80 bg-card p-0 shadow-sm transition-all duration-200",
          "group-hover:-translate-y-0.5 group-hover:border-primary/35 group-hover:shadow-md",
          "focus-within:ring-3 focus-within:ring-ring/50",
          previewClassName,
        )}
      >
        <div
          role={interactive ? "button" : undefined}
          tabIndex={interactive ? 0 : undefined}
          className={cn(
            "overflow-hidden rounded-sm bg-white shadow-[0_10px_24px_rgb(15_23_42_/_10%)] outline-none",
            interactive && "cursor-pointer",
          )}
          onClick={onClick}
          onKeyDown={handleKeyDown}
        >
          {preview}
        </div>
        {floatingActions && (
          <div className="absolute inset-x-3 bottom-3 z-10 flex items-center justify-center gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
            {floatingActions}
          </div>
        )}
      </div>
      <div className="min-w-0 px-1">
        <h2 className="m-0 truncate text-base font-medium tracking-normal text-foreground">{title}</h2>
        {subtitle && <p className="m-0 mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center justify-center gap-2 px-1">{actions}</div>}
    </article>
  )
}
