import { type ReactNode, useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Paintbrush, Bot } from "lucide-react"

type RightPanelProps = {
  styleContent: ReactNode
  aiContent: ReactNode
  aiUnread?: boolean
}

export function RightPanel({ styleContent, aiContent, aiUnread }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState("style")

  return (
    <aside className="flex h-full w-80 flex-col border-l bg-background">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
        <TabsList className="mx-3 mt-2 grid grid-cols-2">
          <TabsTrigger value="style" className="gap-1.5">
            <Paintbrush className="h-4 w-4" />
            <span>样式</span>
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-1.5">
            <Bot className="h-4 w-4" />
            <span>AI 助手</span>
            {aiUnread && <span className="ml-1 h-2 w-2 rounded-full bg-destructive" />}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="style" className="flex-1 overflow-auto px-3 pb-3">
          {styleContent}
        </TabsContent>

        <TabsContent value="ai" className="flex-1 flex flex-col overflow-auto px-3 pb-3">
          {aiContent}
        </TabsContent>
      </Tabs>
    </aside>
  )
}
