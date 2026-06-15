import { BriefcaseBusiness, LayoutTemplate, Settings } from "lucide-react"
import type { ComponentType } from "react"

export const RESUME_PACK_BASE_PATH = "/packs/resume" as const

export const resumePackPaths = {
  workspaces: `${RESUME_PACK_BASE_PATH}/workspaces`,
  workspace: (documentId: string) => `${RESUME_PACK_BASE_PATH}/workspaces/${documentId}`,
  templates: `${RESUME_PACK_BASE_PATH}/templates`,
  template: (templateId: string) => `${RESUME_PACK_BASE_PATH}/templates/${encodeURIComponent(templateId)}`,
  settings: `${RESUME_PACK_BASE_PATH}/settings`,
} as const

export type ResumePackNavItem = {
  id: "workspaces" | "templates" | "settings"
  label: string
  path: string
  icon: ComponentType<{ className?: string }>
  isActive: (pathname: string) => boolean
}

export const resumePackNavigation: ResumePackNavItem[] = [
  {
    id: "workspaces",
    label: "工作台",
    path: resumePackPaths.workspaces,
    icon: BriefcaseBusiness,
    isActive: (pathname) =>
      pathname === "/" || pathname === resumePackPaths.workspaces || pathname.startsWith(`${resumePackPaths.workspaces}/`),
  },
  {
    id: "templates",
    label: "模板",
    path: resumePackPaths.templates,
    icon: LayoutTemplate,
    isActive: (pathname) => pathname === resumePackPaths.templates || pathname.startsWith(`${resumePackPaths.templates}/`),
  },
  {
    id: "settings",
    label: "设置",
    path: resumePackPaths.settings,
    icon: Settings,
    isActive: (pathname) => pathname === resumePackPaths.settings,
  },
]
