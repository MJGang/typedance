import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { ResumePackModeSwitch } from "@/features/resume-pack/ResumePackNavigation"
import { ResumeDocumentList } from "@/features/resume-pack/ResumeDocumentList"

export function SiteSidebar() {
  return (
    <Sidebar collapsible="offcanvas" variant="sidebar" className="!bottom-0 !top-9 !h-auto !border-r-0">
      <SidebarHeader className="p-0"><ResumePackModeSwitch /></SidebarHeader>
      <SidebarContent>
        <ResumeDocumentList />
      </SidebarContent>
    </Sidebar>
  )
}
