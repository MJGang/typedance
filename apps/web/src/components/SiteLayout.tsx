import { Outlet, useLocation } from "react-router-dom"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
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
      <SidebarProvider>
        <GlobalTitleBar
          isWorkbenchRoute={isWorkbenchRoute}
          workbenchSidebarVisible={workbenchSidebarVisible}
          setWorkbenchSidebarVisible={setWorkbenchSidebarVisible}
        />
        {!isWorkbenchRoute ? <SiteSidebar /> : null}
        <SidebarInset
          className={cn(
            "min-h-0 overflow-hidden",
            isWorkbenchRoute
              ? "h-svh pt-9"
              : "mt-9 h-[calc(100svh-2.25rem)] rounded-l-xl border border-border",
          )}
        >
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
