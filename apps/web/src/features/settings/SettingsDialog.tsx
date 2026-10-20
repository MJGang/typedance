import { useState } from "react"
import { RefreshCw, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AiSettingsPanel } from "./AiSettingsPanel"
import { ClientUpdatePanel } from "./ClientUpdatePanel"
import { useClientUpdater } from "./useClientUpdater"

export function SettingsDialog({ open, onOpenChange, initialTab = "ai" }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: "ai" | "updates"
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] gap-0 overflow-hidden p-0 sm:max-w-[760px]">
        <DialogDescription className="sr-only">管理 AI 配置与客户端更新。</DialogDescription>
        <Tabs defaultValue={initialTab} orientation="vertical" className="min-h-[520px] gap-0 max-sm:flex-col">
          <div className="flex w-44 shrink-0 flex-col gap-6 border-r border-border p-4 max-sm:w-full max-sm:border-r-0 max-sm:border-b">
            <DialogTitle className="px-2 pt-2 text-lg font-semibold">设置</DialogTitle>
            <TabsList aria-label="设置分类" className="w-full items-stretch gap-1 bg-transparent p-0 max-sm:flex-row">
              <TabsTrigger value="ai" className="h-10 flex-none gap-2"><Settings data-icon="inline-start" />AI 设置</TabsTrigger>
              <TabsTrigger value="updates" className="h-10 flex-none gap-2"><RefreshCw data-icon="inline-start" />客户端更新</TabsTrigger>
            </TabsList>
          </div>
          <div className="max-h-[calc(90svh-160px)] min-w-0 flex-1 overflow-y-auto p-6 pt-12 sm:max-h-[min(700px,85svh)]">
            <TabsContent value="ai"><AiSettingsPanel /></TabsContent>
            <TabsContent value="updates"><ClientUpdatePanel onDismiss={() => onOpenChange(false)} /></TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

export function SettingsButton() {
  const [open, setOpen] = useState(false)
  const { phase, update } = useClientUpdater()
  const hasUpdate = update !== null && phase !== "latest"
  return (
    <>
      <Button aria-label="设置" variant="ghost" className="h-9 w-full justify-start gap-2 px-2" onClick={() => setOpen(true)}>
        <Settings data-icon="inline-start" />
        设置
        {hasUpdate ? <span className="size-1.5 rounded-full bg-primary" aria-label="有客户端更新" /> : null}
      </Button>
      {open ? <SettingsDialog open onOpenChange={setOpen} initialTab={hasUpdate ? "updates" : "ai"} /> : null}
    </>
  )
}
