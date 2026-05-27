import { createBrowserRouter } from "react-router-dom"
import { SiteLayout } from "./components/SiteLayout"
import { TemplateLibrary } from "./features/templates/components/TemplateLibrary"
import { RevisionWorkspacePage } from "./features/revision/RevisionWorkspacePage"
import { SettingsPage } from "./features/settings/SettingsPage"
import { WorkspacePage } from "./features/workspace/WorkspacePage"
import { ResumeProductsPage } from "./features/resume-pack/ResumeProductsPage"
import { ResumeWorkspacesPage } from "./features/resume-pack/ResumeWorkspacesPage"

export const router = createBrowserRouter([
  {
    element: <SiteLayout />,
    children: [
      { path: "/", element: <ResumeWorkspacesPage /> },
      { path: "/packs/resume/workspaces", element: <ResumeWorkspacesPage /> },
      { path: "/packs/resume/workspaces/:documentId", element: <RevisionWorkspacePage /> },
      { path: "/packs/resume/resumes", element: <ResumeProductsPage /> },
      { path: "/packs/resume/resumes/:id", element: <WorkspacePage /> },
      { path: "/packs/resume/templates", element: <TemplateLibrary /> },
      { path: "/packs/resume/settings", element: <SettingsPage /> },
    ],
  },
])
