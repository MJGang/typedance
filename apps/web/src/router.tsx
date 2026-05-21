import { createBrowserRouter } from "react-router-dom"
import { SiteLayout } from "./components/SiteLayout"
import { HomePage } from "./features/home/HomePage"
import { TemplateLibrary } from "./features/templates/components/TemplateLibrary"
import { RevisionWorkspacePage } from "./features/revision/RevisionWorkspacePage"
import { WorkspacePage } from "./features/workspace/WorkspacePage"

export const router = createBrowserRouter([
  {
    element: <SiteLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/templates", element: <TemplateLibrary /> },
      { path: "/workspace/:id", element: <WorkspacePage /> },
      { path: "/revision/:documentId", element: <RevisionWorkspacePage /> },
    ],
  },
])
