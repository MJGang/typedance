import { useRef, useState } from "react"
import { NodeViewContent, NodeViewWrapper, useEditorState, type NodeViewProps } from "@tiptap/react"
import { Ellipsis, Plus, Split, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { executeEditorOperations, nodePathAtPosition } from "../../revision/editorCommands"

export function TimelineItemNodeView({ editor, getPos, node }: NodeViewProps) {
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const context = useEditorState({ editor, selector: ({ editor: current }) => {
    const position = getPos()
    const selectionInside = typeof position === "number"
      && current.state.selection.from > position && current.state.selection.to < position + node.nodeSize
    const { $from } = current.state.selection
    let splitIndex = 0
    if (selectionInside) for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.before(depth) === position) { splitIndex = $from.index(depth); break }
    }
    return { active: selectionInside && current.isFocused, splitIndex }
  } })
  const run = async (action: "before" | "after" | "remove" | "delete" | "unwrap" | "exit" | "split") => {
    const position = getPos()
    if (busy.current || typeof position !== "number") return
    const path = nodePathAtPosition(editor, position)
    if (!path) return
    busy.current = true
    setPending(true)
    try {
      const parent = path.slice(0, -1)
      const index = path[path.length - 1]
      const exit = { parent: parent.slice(0, -1), index: parent[parent.length - 1] + 1, kind: "paragraph" }
      await executeEditorOperations(editor, [{
        capability: action === "split" ? "timeline.split" : action === "exit" ? "blocks.insert" : action === "before" || action === "after" ? "timeline.add"
          : action === "remove" ? "timeline.remove" : action === "unwrap" ? "timeline.unwrap" : "timeline.delete",
        parameters: action === "split" ? { path: [...path, context.splitIndex] } : action === "exit" ? exit : action === "before" || action === "after"
          ? { path: parent, index: index + (action === "after" ? 1 : 0) }
          : { path: action === "remove" ? path : parent },
      }], undefined, action === "split" ? { focusPath: [...parent, index + 1] } : action === "exit" ? { focusPath: [...exit.parent, exit.index] } : action === "before" || action === "after"
        ? { focusPath: [...parent, index + (action === "after" ? 1 : 0)] } : {})
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <NodeViewWrapper className="td-timeline-item group/timeline-item" data-td-timeline-item="">
      <span className="td-timeline-line" aria-hidden="true" contentEditable={false} />
      <span className="td-timeline-dot" aria-hidden="true" contentEditable={false} />
      <NodeViewContent className="td-timeline-body" />
      {editor.isEditable ? (
        <div data-active={context.active || undefined} className="td-module-interaction-only absolute -left-1 top-0 opacity-0 transition-opacity group-hover/timeline-item:opacity-100 focus-within:opacity-100 data-[active=true]:opacity-100" contentEditable={false}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-xs" aria-label="时间轴条目操作" title="时间轴条目操作" disabled={pending} onMouseDown={(event) => event.preventDefault()}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => void run("before")}><Plus />在前面新增条目</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void run("after")}><Plus />在后面新增条目</DropdownMenuItem>
                <DropdownMenuItem disabled={!context.splitIndex} onSelect={() => void run("split")}><Split />从当前段落拆出新条目</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => void run("remove")}><Trash2 />删除此条目及正文</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => void run("exit")}>在时间轴后继续输入</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void run("unwrap")}>取消时间轴，保留正文</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => void run("delete")}><Trash2 />删除整个时间轴及正文</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </NodeViewWrapper>
  )
}
