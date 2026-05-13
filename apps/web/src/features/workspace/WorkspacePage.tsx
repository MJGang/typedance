import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Save, FileDown } from "lucide-react"
import { ResumeRichTextEditor } from "./components/ResumeRichTextEditor"
import { RightPanel } from "./components/RightPanel"
import { AiTab } from "./components/AiTab"
import { StylePanel } from "../templates/components/style-panel/StylePanel"
import { generateFullCSS } from "../templates/style-engine/css-generator"
import { getTemplateStyle, saveTemplateStyle } from "@/api"
import { templateRegistry, defaultClassicA4Style } from "../templates/data"
import type { ResumeDocJson, ResumeEditorChange } from "./editor"
import type { ResumeVersion, TemplateStyleConfig, BlockType } from "@typedance/contracts"

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [resume, setResume] = useState<ResumeVersion | null>(null)
  const [docJson, setDocJson] = useState<ResumeDocJson>({ type: "doc", content: [] })
  const [activeBlock, setActiveBlock] = useState<BlockType>("paragraph")
  const [styleConfig, setStyleConfig] = useState<TemplateStyleConfig>(defaultClassicA4Style)

  // Track whether a built-in template has been forked
  const forkedRef = useRef(false)
  const forkedTemplateIdRef = useRef<string | null>(null)

  useEffect(() => {
    // Load template styles for the default template
    const defaultTemplate = templateRegistry[0]
    getTemplateStyle(defaultTemplate.id)
      .then(setStyleConfig)
      .catch(() => setStyleConfig(defaultClassicA4Style))
  }, [])

  const cssText = useMemo(() => generateFullCSS(styleConfig.blocks ?? {}), [styleConfig])

  const handleEditorChange = useCallback((change: ResumeEditorChange) => {
    setDocJson(change.docJson)
  }, [])

  const handleSelectionUpdate = useCallback((blockName: string) => {
    const validBlocks: BlockType[] = ["heading1", "heading2", "heading3", "paragraph", "bulletList", "orderedList"]
    if (validBlocks.includes(blockName as BlockType)) {
      setActiveBlock(blockName as BlockType)
    }
  }, [])

  const handleStyleChange = useCallback((newStyle: TemplateStyleConfig) => {
    setStyleConfig(newStyle)
    // Template fork: if modifying a built-in template, save as a new user template
    const template = resume ? templateRegistry.find(t => t.id === resume.template_id) : null
    if (template?.status === "built-in" && !forkedRef.current) {
      forkedRef.current = true
      const newId = `user_${resume!.template_id}_${Date.now()}`
      forkedTemplateIdRef.current = newId
      saveTemplateStyle({ ...newStyle, template_id: newId, name: template.localizedName["zh-CN"], preset: "" }).catch(console.error)
    } else {
      const targetId = forkedTemplateIdRef.current ?? newStyle.template_id
      saveTemplateStyle({ ...newStyle, template_id: targetId }).catch(console.error)
    }
  }, [resume])

  // If no resume id is available, show a message
  if (!id) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-muted-foreground">未找到简历</p>
          <Button className="mt-4" onClick={() => navigate("/")}>
            返回首页
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Editor area */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="flex-1 text-sm font-medium">{resume?.title ?? "加载中..."}</h2>
          <Button variant="outline" size="sm">
            <Save className="mr-1 h-4 w-4" />保存
          </Button>
          <Button size="sm">
            <FileDown className="mr-1 h-4 w-4" />导出 PDF
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <style>{cssText}</style>
          <ResumeRichTextEditor
            ariaLabel="Resume editor"
            docJson={docJson}
            onChange={handleEditorChange}
            onSelectionUpdate={handleSelectionUpdate}
          />
        </div>
      </div>

      {/* Right panel */}
      <RightPanel
        styleContent={
          <StylePanel
            styleConfig={styleConfig}
            onChange={handleStyleChange}
            activeBlock={activeBlock}
            onActiveBlockChange={setActiveBlock}
            uiLanguage="zh-CN"
          />
        }
        aiContent={<AiTab />}
      />
    </div>
  )
}
