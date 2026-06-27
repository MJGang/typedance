import { Outlet, useLocation } from "react-router-dom"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SiteSidebar } from "./SiteSidebar"
import { GlobalTitleBar } from "./GlobalTitleBar"
import { useState, type Dispatch, type SetStateAction } from "react"

export type RevisionWorkspaceChromeContext = {
  assistantPanelVisible: boolean
  setAssistantPanelVisible: Dispatch<SetStateAction<boolean>>
  workbenchSidebarVisible: boolean
  setWorkbenchSidebarVisible: Dispatch<SetStateAction<boolean>>
}

export function SiteLayout() {
  const location = useLocation()
  const isWorkbenchRoute = /^\/packs\/resume\/workspaces\/[^/]+$/.test(location.pathname)
  const [assistantPanelVisible, setAssistantPanelVisible] = useState(true)
  const [workbenchSidebarVisible, setWorkbenchSidebarVisible] = useState(true)

  return (
    <TooltipProvider>
      <SidebarProvider className="bg-sidebar">
        <GlobalTitleBar
          isWorkbenchRoute={isWorkbenchRoute}
          workbenchSidebarVisible={workbenchSidebarVisible}
          setWorkbenchSidebarVisible={setWorkbenchSidebarVisible}
        />
        {!isWorkbenchRoute ? <SiteSidebar /> : null}
        <SidebarInset className="mt-9 mr-0.5 mb-0.5 h-[calc(100svh-2.25rem-2px)] min-h-0 min-w-0 overflow-hidden rounded-xl border border-border">
          <main className="min-h-0 flex-1 overflow-auto">
            <Outlet
              context={{
                assistantPanelVisible,
                setAssistantPanelVisible,
                workbenchSidebarVisible,
                setWorkbenchSidebarVisible,
              } satisfies RevisionWorkspaceChromeContext}
            />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
