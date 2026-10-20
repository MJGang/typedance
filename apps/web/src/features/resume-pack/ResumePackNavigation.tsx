import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { FileText, LayoutTemplate } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { resumePackPaths } from "./routes"

type ResumePackNavigation = {
  resume: string
  templates: string
  documentsVersion: number
  documentsChanged: (deletedId?: string) => void
}
const NavigationContext = createContext<ResumePackNavigation | null>(null)

export function useResumePackNavigation() {
  const navigation = useContext(NavigationContext)
  if (!navigation) throw new Error("ResumePackNavigationProvider is required")
  return navigation
}

export function ResumePackNavigationProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [destinations, setDestinations] = useState({
    resume: resumePackPaths.workspaces as string,
    templates: resumePackPaths.template("classic-a4"),
  })
  const [documentsVersion, setDocumentsVersion] = useState(0)
  const documentsChanged = useCallback((deletedId?: string) => {
    setDocumentsVersion((version) => version + 1)
    if (deletedId) setDestinations((current) => current.resume === resumePackPaths.workspace(deletedId)
      ? { ...current, resume: resumePackPaths.workspaces } : current)
  }, [])
  useEffect(() => {
    const mode = pathname.startsWith(`${resumePackPaths.workspaces}/`)
      ? "resume" : pathname.startsWith(resumePackPaths.templates) ? "templates" : null
    if (!mode) return
    setDestinations((current) => current[mode] === pathname ? current : { ...current, [mode]: pathname })
  }, [pathname])
  const value = useMemo(() => ({ ...destinations, documentsVersion, documentsChanged }), [destinations, documentsVersion, documentsChanged])
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function ResumePackModeSwitch() {
  const destinations = useResumePackNavigation()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const mode = pathname.startsWith(resumePackPaths.templates) ? "templates" : "resume"
  return (
    <nav aria-label="简历与模板" className="shrink-0 px-3 pb-4">
      <ToggleGroup type="single" variant="outline" spacing={0} value={mode} className="h-12 w-full overflow-hidden rounded-xl border border-border [&>[data-slot=toggle-group-item]]:h-full [&>[data-slot=toggle-group-item]]:border-0"
        onValueChange={(value) => {
          if (value === "resume" || value === "templates") navigate(destinations[value])
        }}>
        <ToggleGroupItem value="resume" className="flex-1"><FileText data-icon="inline-start" />简历</ToggleGroupItem>
        <ToggleGroupItem value="templates" className="flex-1"><LayoutTemplate data-icon="inline-start" />模板</ToggleGroupItem>
      </ToggleGroup>
    </nav>
  )
}
