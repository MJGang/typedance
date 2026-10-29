import { useState } from "react"
import { FilePlus2, FileText } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { RevisionWorkspaceChromeContext } from "@/components/SiteLayout"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { AccountMenu } from "@/features/account/AccountMenu"
import { PanelResizeHandle } from "../revision/PanelResizeHandle"
import { LEFT_PANEL_MIN_WIDTH } from "../revision/panelLayout"
import { ResumeDocumentList } from "./ResumeDocumentList"
import { ResumePackModeSwitch, useResumePackNavigation } from "./ResumePackNavigation"
import { CreateResumeDialog } from "./CreateResumeDialog"

export function ResumeWorkspaceEntry() {
  const { workbenchSidebarVisible, panels } = useOutletContext<RevisionWorkspaceChromeContext>()
  const { documentsChanged } = useResumePackNavigation()
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-sidebar">
      {workbenchSidebarVisible ? (
        <>
          <aside aria-label="简历导航" className="flex h-full shrink-0 flex-col bg-sidebar" style={{ width: panels.panelLayout.left }}>
            <ResumePackModeSwitch />
            <div className="min-h-0 flex-1 overflow-y-auto"><ResumeDocumentList openFirstDocument={!createOpen} /></div>
            <AccountMenu />
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
      <main aria-label="简历工作台" className="mr-1 mb-1 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileText /></EmptyMedia>
            <EmptyTitle role="heading" aria-level={1}>开始编辑简历</EmptyTitle>
            <EmptyDescription>在左侧选择简历，或新建一份简历。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="lg" className="h-11 rounded-xl px-5 [--primary:#1677ff] [--primary-foreground:#fff]" onClick={() => setCreateOpen(true)}><FilePlus2 data-icon="inline-start" />新建简历</Button>
          </EmptyContent>
        </Empty>
      </main>
      {createOpen ? <CreateResumeDialog onClose={() => setCreateOpen(false)} onCreated={() => documentsChanged()} /> : null}
    </div>
  )
}
