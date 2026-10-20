import { Link } from "react-router-dom"
import { LayoutTemplate, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ResumePackModeSwitch } from "@/features/resume-pack/ResumePackNavigation"
import { resumePackPaths } from "@/features/resume-pack/routes"
import { cn } from "@/lib/utils"
import type { TemplateTheme } from "../theme-options"

type TemplateSidebarProps = {
  themes: TemplateTheme[]
  selectedThemeId: string
  busy: boolean
  onCreate: () => void
  onRename: (theme: TemplateTheme) => void
  onDelete: (theme: TemplateTheme) => void
}

export function TemplateSidebar({ themes, selectedThemeId, busy, onCreate, onRename, onDelete }: TemplateSidebarProps) {
  return (
    <aside aria-label="模板列表" className="flex h-full w-[272px] shrink-0 flex-col bg-sidebar">
      <ResumePackModeSwitch />
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-4">
        <h2 className="px-1 text-sm font-semibold">模板列表</h2>
        <Button variant="outline" size="sm" disabled={busy} onClick={onCreate}><Plus data-icon="inline-start" />新建模板</Button>
        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {themes.map((theme) => (
            <div key={theme.id} className={cn("group flex items-center rounded-md", theme.id === selectedThemeId && "bg-sidebar-accent")}>
              <Button asChild variant="ghost" className="min-w-0 flex-1 justify-start">
                <Link to={resumePackPaths.template(theme.id)} aria-current={theme.id === selectedThemeId ? "page" : undefined}
                  aria-label={`编辑模板 ${theme.title}`}>
                  <LayoutTemplate data-icon="inline-start" /><span className="truncate">{theme.title}</span>
                  {theme.source === "default" ? <Badge variant="secondary" className="ml-auto">内置</Badge> : null}
                </Link>
              </Button>
              {theme.source === "custom" ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={`管理模板 ${theme.title}`} disabled={busy}
                      className="mr-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"><MoreHorizontal /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="right">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onSelect={() => onRename(theme)}><Pencil />重命名</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => onDelete(theme)}><Trash2 />删除模板</DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
