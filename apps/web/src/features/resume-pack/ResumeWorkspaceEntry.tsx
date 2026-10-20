import { FileText } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { RevisionWorkspaceChromeContext } from "@/components/SiteLayout"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { PanelResizeHandle } from "../revision/PanelResizeHandle"
import { LEFT_PANEL_MIN_WIDTH } from "../revision/panelLayout"
import { ResumeDocumentList } from "./ResumeDocumentList"
import { ResumePackModeSwitch } from "./ResumePackNavigation"

export function ResumeWorkspaceEntry() {
  const { workbenchSidebarVisible, panels } = useOutletContext<RevisionWorkspaceChromeContext>()

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-sidebar">
      {workbenchSidebarVisible ? (
        <>
          <aside aria-label="简历导航" className="flex h-full shrink-0 flex-col bg-sidebar" style={{ width: panels.panelLayout.left }}>
            <ResumePackModeSwitch />
            <ResumeDocumentList openFirstDocument />
          </aside>
          <PanelResizeHandle
            ariaLabel="调整左侧面板宽度"
            direction={1}
            min={LEFT_PANEL_MIN_WIDTH}
            max={panels.panelLayout.leftMax}
            value={panels.panelLayout.left}
            onResize={panels.updateLeft}
            onResizeEnd={panels.persistLeft}
            showVisualLine={false}
          />
        </>
      ) : null}
      <main className="mr-1 mb-1 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileText /></EmptyMedia>
            <EmptyTitle role="heading" aria-level={1}>开始编辑简历</EmptyTitle>
            <EmptyDescription>在左侧选择简历，或新建、导入一份简历。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </main>
    </div>
  )
}
