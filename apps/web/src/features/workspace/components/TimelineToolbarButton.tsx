import { useRef } from "react"
import type { Editor } from "@tiptap/core"
import { useEditorState } from "@tiptap/react"
import { GitCommitVertical, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { executeEditorOperations, nodePathAtPosition, selectedBlockInsertion, selectedNodePaths } from "../../revision/editorCommands"

export function TimelineToolbarButton({ editor }: { editor: Editor | null }) {
  const busy = useRef(false)
  const inTimeline = useEditorState({ editor, selector: ({ editor: current }) => current?.isActive("timeline") ?? false }) ?? false
  const insert = async (wrap: boolean) => {
    if (!editor || busy.current) return
    busy.current = true
    try {
      let insertion = selectedBlockInsertion(editor)
      const { $to } = editor.state.selection
      for (let depth = $to.depth; depth > 0; depth--) {
        if ($to.node(depth).type.name !== "timeline") continue
        const path = nodePathAtPosition(editor, $to.before(depth))
        if (path) insertion = { parent: path.slice(0, -1), index: path[path.length - 1] + 1 }
        break
      }
      const paths = wrap ? selectedNodePaths(editor, ["paragraph", "heading", "bulletList", "orderedList", "columns", "horizontalRule", "codeBlock"]) : []
      await executeEditorOperations(editor, [{
        capability: wrap ? "timeline.wrap" : "timeline.insert",
        parameters: wrap ? { paths } : insertion,
      }], undefined, { focusPath: wrap ? paths[0] : [...insertion.parent, insertion.index] })
    } finally { busy.current = false }
  }
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="时间轴" disabled={!editor} data-active={inTimeline || undefined} className="td-editor-toolbar-button">
              <GitCommitVertical />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>时间轴</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => void insert(false)}><Plus />插入空白时间轴</DropdownMenuItem>
          <DropdownMenuItem disabled={inTimeline} onSelect={() => void insert(true)}><GitCommitVertical />所选内容转为时间轴条目</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
