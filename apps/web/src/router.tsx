import { createBrowserRouter } from "react-router-dom"
import { SiteLayout } from "./components/SiteLayout"
import { TemplateLibrary } from "./features/templates/components/TemplateLibrary"
import { RevisionWorkspacePage } from "./features/revision/RevisionWorkspacePage"
import { SettingsPage } from "./features/settings/SettingsPage"
import { ResumeWorkspacesPage } from "./features/resume-pack/ResumeWorkspacesPage"

export const router = createBrowserRouter([
  {
    element: <SiteLayout />,
    children: [
      { path: "/", element: <ResumeWorkspacesPage /> },
      { path: "/packs/resume/workspaces", element: <ResumeWorkspacesPage /> },
      { path: "/packs/resume/workspaces/:documentId", element: <RevisionWorkspacePage /> },
      { path: "/packs/resume/templates", element: <TemplateLibrary /> },
      { path: "/packs/resume/templates/:templateId", element: <TemplateLibrary /> },
      { path: "/packs/resume/settings", element: <SettingsPage /> },
    ],
  },
])
