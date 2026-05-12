import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send } from "lucide-react"

type Message = {
  role: "user" | "assistant"
  content: string
}

export function AiTab() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")

  const handleSend = (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    setMessages((prev) => [...prev, { role: "user", content: input }])
    setInput("")
    // TODO: connect to actual AI backend
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: "assistant", content: "AI 建议功能开发中..." }])
    }, 500)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-auto py-2">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            选中简历文本，或在此输入提问
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`rounded-lg p-3 text-sm ${
              msg.role === "user" ? "ml-4 bg-primary/10" : "mr-4 bg-muted"
            }`}
          >
            {msg.content}
          </div>
        ))}
      </div>
      <form onSubmit={handleSend} className="flex items-center gap-2 border-t pt-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入消息..."
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={!input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  )
}
