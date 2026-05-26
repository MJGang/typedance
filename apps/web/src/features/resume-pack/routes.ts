import { BriefcaseBusiness, FileText, LayoutTemplate, Settings } from "lucide-react"
import type { ComponentType } from "react"

export const RESUME_PACK_BASE_PATH = "/packs/resume" as const

export const resumePackPaths = {
  workspaces: `${RESUME_PACK_BASE_PATH}/workspaces`,
  workspace: (documentId: string) => `${RESUME_PACK_BASE_PATH}/workspaces/${documentId}`,
  resumes: `${RESUME_PACK_BASE_PATH}/resumes`,
  resume: (resumeId: string) => `${RESUME_PACK_BASE_PATH}/resumes/${resumeId}`,
  templates: `${RESUME_PACK_BASE_PATH}/templates`,
  settings: `${RESUME_PACK_BASE_PATH}/settings`,
} as const

export type ResumePackNavItem = {
  id: "workspaces" | "resumes" | "templates" | "settings"
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
      pathname === resumePackPaths.workspaces || pathname.startsWith(`${resumePackPaths.workspaces}/`),
  },
  {
    id: "resumes",
    label: "简历成品",
    path: resumePackPaths.resumes,
    icon: FileText,
    isActive: (pathname) => pathname === resumePackPaths.resumes || pathname.startsWith(`${resumePackPaths.resumes}/`),
  },
  {
    id: "templates",
    label: "模板",
    path: resumePackPaths.templates,
    icon: LayoutTemplate,
    isActive: (pathname) => pathname === resumePackPaths.templates,
  },
  {
    id: "settings",
    label: "设置",
    path: resumePackPaths.settings,
    icon: Settings,
    isActive: (pathname) => pathname === resumePackPaths.settings,
  },
]
