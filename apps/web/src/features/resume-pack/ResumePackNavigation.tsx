import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { FileText, LayoutTemplate } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { resumePackPaths } from "./routes"

const NavigationContext = createContext<{ resume: string; templates: string } | null>(null)

export function ResumePackNavigationProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [destinations, setDestinations] = useState({
    resume: resumePackPaths.workspaces as string,
    templates: resumePackPaths.template("classic-a4"),
  })
  useEffect(() => {
    const mode = pathname.startsWith(`${resumePackPaths.workspaces}/`)
      ? "resume" : pathname.startsWith(resumePackPaths.templates) ? "templates" : null
    if (!mode) return
    setDestinations((current) => current[mode] === pathname ? current : { ...current, [mode]: pathname })
  }, [pathname])
  return <NavigationContext.Provider value={destinations}>{children}</NavigationContext.Provider>
}

export function ResumePackModeSwitch() {
  const destinations = useContext(NavigationContext)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  if (!destinations) throw new Error("ResumePackModeSwitch requires ResumePackNavigationProvider")
  const mode = pathname.startsWith(resumePackPaths.templates) ? "templates" : "resume"
  return (
    <nav aria-label="简历与模板" className="px-3 py-3">
      <ToggleGroup type="single" variant="outline" spacing={0} value={mode} className="w-full"
        onValueChange={(value) => {
          if (value === "resume" || value === "templates") navigate(destinations[value])
        }}>
        <ToggleGroupItem value="resume" className="flex-1"><FileText data-icon="inline-start" />简历</ToggleGroupItem>
        <ToggleGroupItem value="templates" className="flex-1"><LayoutTemplate data-icon="inline-start" />模板</ToggleGroupItem>
      </ToggleGroup>
    </nav>
  )
}
