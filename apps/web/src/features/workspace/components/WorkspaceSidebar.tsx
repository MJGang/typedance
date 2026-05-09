import {
  BriefcaseBusiness,
  ClipboardCheck,
  FileDown,
  FileText,
  HardDrive,
  LibraryBig,
  Settings,
  ShieldCheck,
} from "lucide-react"
import type React from "react"
import type { WorkspaceCopy, WorkspaceSection } from "../types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { SettingsDialog } from "./SettingsDialog"

const navItems: Array<{ id: WorkspaceSection; icon: typeof FileText; badge?: string }> = [
  { id: "workspace", icon: FileText },
  { id: "jobs", icon: BriefcaseBusiness, badge: "82%" },
  { id: "evidence", icon: LibraryBig, badge: "3" },
  { id: "review", icon: ShieldCheck, badge: "1" },
  { id: "exports", icon: FileDown },
]

type WorkspaceSidebarProps = {
  activeSection: WorkspaceSection
  copy: WorkspaceCopy
  onSectionChange: (section: WorkspaceSection) => void
  settings: Omit<React.ComponentProps<typeof SettingsDialog>, "children">
}

export function WorkspaceSidebar({ activeSection, copy, onSectionChange, settings }: WorkspaceSidebarProps) {
  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <ClipboardCheck />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">TypeDance</span>
                <span className="truncate text-xs text-sidebar-foreground/70">{copy.local}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Resume Flow</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = item.icon
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={activeSection === item.id}
                      tooltip={copy[item.id]}
                      onClick={() => onSectionChange(item.id)}
                    >
                      <Icon />
                      <span>{copy[item.id]}</span>
                      {item.badge ? (
                        <Badge variant="secondary" className="ml-auto group-data-[collapsible=icon]:hidden">
                          {item.badge}
                        </Badge>
                      ) : null}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Local</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Local vault">
                  <HardDrive />
                  <span>Vault ready</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SettingsDialog {...settings}>
          <Button variant="ghost" className="w-full justify-start group-data-[collapsible=icon]:justify-center">
            <Settings data-icon="inline-start" />
            <span className="group-data-[collapsible=icon]:hidden">{copy.settings}</span>
          </Button>
        </SettingsDialog>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
