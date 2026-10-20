import { createBrowserRouter, Navigate } from "react-router-dom"
import { SiteLayout } from "./components/SiteLayout"
import { TemplateWorkspacePage } from "./features/templates/components/TemplateWorkspacePage"
import { RevisionWorkspacePage } from "./features/revision/RevisionWorkspacePage"
import { ResumeWorkspaceEntry } from "./features/resume-pack/ResumeWorkspaceEntry"
import { resumePackPaths } from "./features/resume-pack/routes"

export const appRoutes = [
  {
    element: <SiteLayout />,
    children: [
      { path: "/", element: <Navigate to={resumePackPaths.workspaces} replace /> },
      { path: resumePackPaths.workspaces, element: <ResumeWorkspaceEntry /> },
      { path: "/packs/resume/workspaces/:documentId", element: <RevisionWorkspacePage /> },
      { path: resumePackPaths.templates, element: <Navigate to={resumePackPaths.template("classic-a4")} replace /> },
      { path: "/packs/resume/templates/:templateId", element: <TemplateWorkspacePage /> },
    ],
  },
]

export const router = createBrowserRouter(appRoutes)
