import { useEffect, useState, type Dispatch, type MouseEvent, type SetStateAction } from "react"
import { ArrowLeft, ArrowRight, Minus, Moon, PanelLeft, Square, Sun, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useSidebar } from "@/components/ui/sidebar"
import {
  closeDesktopWindow,
  minimizeDesktopWindow,
  startDraggingDesktopWindow,
  toggleMaximizeDesktopWindow,
} from "@/desktopWindow"
import { useAppHistoryNavigation } from "@/hooks/useAppHistoryNavigation"

type GlobalTitleBarProps = {
  isWorkbenchRoute: boolean
  workbenchSidebarVisible: boolean
  setWorkbenchSidebarVisible: Dispatch<SetStateAction<boolean>>
}

export function GlobalTitleBar({
  isWorkbenchRoute,
  workbenchSidebarVisible,
  setWorkbenchSidebarVisible,
}: GlobalTitleBarProps) {
  const { open: siteSidebarVisible, toggleSidebar } = useSidebar()
  const { canGoBack, canGoForward, goBack, goForward } = useAppHistoryNavigation()
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  const leftSidebarVisible = isWorkbenchRoute ? workbenchSidebarVisible : siteSidebarVisible

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    localStorage.setItem("theme", dark ? "dark" : "light")
  }, [dark])

  const toggleLeftSidebar = () => {
    if (isWorkbenchRoute) {
      setWorkbenchSidebarVisible((visible) => !visible)
      return
    }
    toggleSidebar()
  }

  const handleDragRegionMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return
    if (event.detail === 2) {
      void toggleMaximizeDesktopWindow()
      return
    }
    void startDraggingDesktopWindow()
  }

  return (
    <header
      data-testid="global-titlebar"
      className="fixed inset-x-0 top-0 z-30 flex h-9 items-center border-b border-border bg-background text-foreground"
    >
      <div className="flex h-full shrink-0 items-center gap-0.5 px-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={leftSidebarVisible ? "隐藏左侧导航" : "显示左侧导航"}
          aria-pressed={leftSidebarVisible}
          data-control-order="0"
          data-testid="global-left-sidebar-toggle"
          onClick={toggleLeftSidebar}
        >
          <PanelLeft data-icon="inline-start" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="返回"
          data-control-order="1"
          disabled={!canGoBack}
          onClick={goBack}
        >
          <ArrowLeft data-icon="inline-start" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="前进"
          data-control-order="2"
          disabled={!canGoForward}
          onClick={goForward}
        >
          <ArrowRight data-icon="inline-start" />
        </Button>
      </div>

      <div
        data-tauri-drag-region
        data-testid="titlebar-drag-region"
        className="h-full min-w-8 flex-1"
        onMouseDown={handleDragRegionMouseDown}
      />

      <div className="flex h-full shrink-0 items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={dark ? "切换浅色模式" : "切换深色模式"}
          data-control-order="3"
          data-testid="site-theme-toggle"
          className="rounded-md"
          onClick={() => setDark((current) => !current)}
        >
          {dark ? <Sun data-icon="inline-start" /> : <Moon data-icon="inline-start" />}
        </Button>
        <Separator
          orientation="vertical"
          data-testid="titlebar-window-separator"
          className="mx-1 h-4"
        />
        <Button
          type="button"
          variant="ghost"
          aria-label="最小化"
          data-control-order="4"
          className="h-full w-11 rounded-none"
          onClick={() => void minimizeDesktopWindow()}
        >
          <Minus data-icon="inline-start" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label="最大化或还原"
          data-control-order="5"
          className="h-full w-11 rounded-none"
          onClick={() => void toggleMaximizeDesktopWindow()}
        >
          <Square data-icon="inline-start" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label="关闭"
          data-control-order="6"
          className="h-full w-11 rounded-none hover:bg-destructive hover:text-destructive-foreground"
          onClick={() => void closeDesktopWindow()}
        >
          <X data-icon="inline-start" />
        </Button>
      </div>
    </header>
  )
}
