import { Outlet, useLocation } from "react-router-dom"
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PanelLeft, PanelRight, Sun, Moon } from "lucide-react"
import { SiteSidebar } from "./SiteSidebar"
import { useEffect, useState, type Dispatch, type SetStateAction } from "react"

export type RevisionWorkspaceChromeContext = {
  assistantPanelVisible: boolean
  setAssistantPanelVisible: Dispatch<SetStateAction<boolean>>
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    localStorage.setItem("theme", dark ? "dark" : "light")
  }, [dark])

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? "切换浅色模式" : "切换深色模式"}
      data-testid="site-theme-toggle"
      onClick={() => setDark(!dark)}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}

function PanelVisibilityIcon({ active, side }: { active: boolean; side: "left" | "right" }) {
  const Icon = side === "left" ? PanelLeft : PanelRight

  return (
    <span className="relative flex size-4 items-center justify-center">
      <Icon className="size-4" />
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[3px] bottom-[3px] w-[5px] rounded-[1px] bg-current transition-opacity",
          active ? "opacity-45" : "opacity-0",
          side === "left" ? "left-[3px]" : "right-[3px]",
        )}
      />
    </span>
  )
}

function PanelToggleButton({
  active,
  activeLabel,
  inactiveLabel,
  side,
  testId,
  onClick,
}: {
  active: boolean
  activeLabel: string
  inactiveLabel: string
  side: "left" | "right"
  testId: string
  onClick: () => void
}) {
  const label = active ? activeLabel : inactiveLabel

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          data-panel-state={active ? "filled" : "hollow"}
          data-testid={testId}
          className={cn("relative text-muted-foreground", active && "text-foreground")}
          onClick={onClick}
        >
          <PanelVisibilityIcon active={active} side={side} />
          {side === "left" && !active ? (
            <span
              aria-hidden="true"
              data-testid="site-left-sidebar-hidden-dot"
              className="absolute right-1 top-1 size-2 rounded-full bg-sky-500 ring-2 ring-background"
            />
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function PanelVisibilityControls({
  assistantPanelVisible,
  setAssistantPanelVisible,
  isWorkbenchRoute,
}: RevisionWorkspaceChromeContext & { isWorkbenchRoute: boolean }) {
  const { open, toggleSidebar } = useSidebar()

  return (
    <div className="flex items-center gap-1">
      {!isWorkbenchRoute ? (
        <PanelToggleButton
          active={open}
          activeLabel="隐藏左侧导航"
          inactiveLabel="显示左侧导航"
          side="left"
          testId="site-left-sidebar-toggle"
          onClick={toggleSidebar}
        />
      ) : null}
      {isWorkbenchRoute ? (
        <PanelToggleButton
          active={assistantPanelVisible}
          activeLabel="隐藏 AI 面板"
          inactiveLabel="显示 AI 面板"
          side="right"
          testId="site-assistant-panel-toggle"
          onClick={() => setAssistantPanelVisible((visible) => !visible)}
        />
      ) : null}
    </div>
  )
}

export function SiteLayout() {
  const location = useLocation()
  const isWorkbenchRoute = /^\/packs\/resume\/workspaces\/[^/]+$/.test(location.pathname)
  const [assistantPanelVisible, setAssistantPanelVisible] = useState(true)

  return (
    <TooltipProvider>
      <SidebarProvider>
        {!isWorkbenchRoute ? <SiteSidebar /> : null}
        <SidebarInset className="h-svh min-h-0 overflow-hidden">
          <header className="flex h-12 items-center gap-2 border-b border-border px-4">
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <span
                aria-hidden="true"
                data-testid="site-chrome-control-separator"
                className="mx-1 h-4 w-px bg-border"
              />
              <PanelVisibilityControls
                assistantPanelVisible={assistantPanelVisible}
                setAssistantPanelVisible={setAssistantPanelVisible}
                isWorkbenchRoute={isWorkbenchRoute}
              />
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-auto">
            <Outlet context={{ assistantPanelVisible, setAssistantPanelVisible } satisfies RevisionWorkspaceChromeContext} />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
