import { type ReactNode, useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Bot, Palette } from "lucide-react"

type RightPanelProps = {
  designContent: ReactNode
  aiContent: ReactNode
  aiUnread?: boolean
}

export function RightPanel({ designContent, aiContent, aiUnread }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState("ai")

  return (
    <aside className="flex h-full w-80 flex-col border-l border-border bg-background">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
        <TabsList className="mx-3 mt-2 grid grid-cols-2">
          <TabsTrigger value="design" className="gap-1.5">
            <Palette className="h-4 w-4" />
            <span>主题</span>
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-1.5">
            <Bot className="h-4 w-4" />
            <span>AI 助手</span>
            {aiUnread && <span className="ml-1 h-2 w-2 rounded-full bg-destructive" />}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="design" className="flex-1 overflow-auto px-3 pb-3">
          {designContent}
        </TabsContent>

        <TabsContent value="ai" className="flex-1 flex flex-col overflow-auto px-3 pb-3">
          {aiContent}
        </TabsContent>
      </Tabs>
    </aside>
  )
}
