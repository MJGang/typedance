import type { ReactNode } from "react"
import { FileDown, PanelLeft } from "lucide-react"
import type { ReviewGateResult, WorkspaceCopy, WorkspaceSection } from "../types"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkspaceSidebar } from "./WorkspaceSidebar"
import type { SettingsDialog } from "./SettingsDialog"

type WorkspaceLayoutProps = {
  children: ReactNode
  copy: WorkspaceCopy
  activeSection: WorkspaceSection
  status: string
  reviewGate: ReviewGateResult
  onSectionChange: (section: WorkspaceSection) => void
  onSave: () => void
  onExport: () => void
  settings: Omit<React.ComponentProps<typeof SettingsDialog>, "children">
}

export function WorkspaceLayout({
  children,
  copy,
  activeSection,
  status,
  reviewGate,
  onSectionChange,
  onSave,
  onExport,
  settings,
}: WorkspaceLayoutProps) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <WorkspaceSidebar activeSection={activeSection} copy={copy} onSectionChange={onSectionChange} settings={settings} />
        <SidebarInset>
          <header className="td-topbar">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger>
                <PanelLeft />
              </SidebarTrigger>
              <Separator orientation="vertical" className="h-5" />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <strong className="block text-sm">TypeDance</strong>
                  <span className="truncate text-sm text-muted-foreground">/ {copy[activeSection]}</span>
                </div>
                <span className="block truncate text-xs text-muted-foreground" aria-live="polite">
                  {status}
                </span>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" onClick={onSave}>
                {copy.save}
              </Button>
              <Button variant={reviewGate.status === "ready" ? "default" : "secondary"} onClick={onExport}>
                <FileDown data-icon="inline-start" />
                {copy.export}
              </Button>
            </div>
          </header>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
