import { Outlet } from "react-router-dom"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { GlobalTitleBar } from "./GlobalTitleBar"
import { useState, type CSSProperties, type Dispatch, type SetStateAction } from "react"
import { ResumePackNavigationProvider } from "@/features/resume-pack/ResumePackNavigation"
import { useResumePackPanels } from "@/features/resume-pack/useResumePackPanels"

export type RevisionWorkspaceChromeContext = {
  assistantPanelVisible: boolean
  setAssistantPanelVisible: Dispatch<SetStateAction<boolean>>
  workbenchSidebarVisible: boolean
  setWorkbenchSidebarVisible: Dispatch<SetStateAction<boolean>>
  panels: ReturnType<typeof useResumePackPanels>
}

export function SiteLayout() {
  const [assistantPanelVisible, setAssistantPanelVisible] = useState(true)
  const [workbenchSidebarVisible, setWorkbenchSidebarVisible] = useState(true)
  const panels = useResumePackPanels(workbenchSidebarVisible, assistantPanelVisible)

  return (
    <ResumePackNavigationProvider>
    <TooltipProvider>
      <SidebarProvider ref={panels.containerRef} className="bg-sidebar"
        style={{ "--sidebar-width": `${panels.panelLayout.left}px` } as CSSProperties}>
        <GlobalTitleBar
          workbenchSidebarVisible={workbenchSidebarVisible}
          setWorkbenchSidebarVisible={setWorkbenchSidebarVisible}
        />
        <SidebarInset
          className="h-svh min-h-0 min-w-0 overflow-hidden pt-9"
        >
          <main className="min-h-0 flex-1 overflow-auto">
            <Outlet
              context={{
                assistantPanelVisible,
                setAssistantPanelVisible,
                workbenchSidebarVisible,
                setWorkbenchSidebarVisible,
                panels,
              } satisfies RevisionWorkspaceChromeContext}
            />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
    </ResumePackNavigationProvider>
  )
}
