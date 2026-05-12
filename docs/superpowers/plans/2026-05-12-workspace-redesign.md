# Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the app from a single-page section-switcher to a React Router driven app with home page, template library, and workspace editor.

**Architecture:** Three routes (`/`, `/templates`, `/workspace/:id`) wrapped in a shared layout with collapsible left sidebar and top toolbar. Workspace uses right Tab panel (Style | AI Assistant). Template fork: modifying a built-in template's styles auto-creates a user template.

**Tech Stack:** react-router-dom v6, React 19, shadcn/ui Sidebar, TipTap, existing StylePanel

---

### Task 1: Install react-router-dom + create route definitions

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/router.tsx`

- [ ] **Step 1: Install react-router-dom**

Run:
```bash
cd e:/workspaces/typedance && pnpm add react-router-dom --filter @typedance/web
```
Expected: added react-router-dom to `apps/web/package.json`

- [ ] **Step 2: Create `apps/web/src/router.tsx`**

```tsx
import { createBrowserRouter, Navigate } from "react-router-dom"
import { SiteLayout } from "./components/SiteLayout"
import { HomePage } from "./features/home/HomePage"
import { TemplateLibrary } from "./features/templates/TemplateLibrary"
import { WorkspacePage } from "./features/workspace/WorkspacePage"

export const router = createBrowserRouter([
  {
    element: <SiteLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/templates", element: <TemplateLibrary /> },
      { path: "/workspace/:id", element: <WorkspacePage /> },
    ],
  },
])
```

- [ ] **Step 3: Commit**

```bash
cd e:/workspaces/typedance && git add apps/web/package.json apps/web/src/router.tsx && git commit -m "feat: add react-router-dom and route definitions"
```

---

### Task 2: Create SiteLayout (sidebar + topbar + content)

**Files:**
- Create: `apps/web/src/components/SiteLayout.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/features/workspace/components/WorkspaceSidebar.tsx`

- [ ] **Step 1: Create `apps/web/src/components/SiteLayout.tsx`**

```tsx
import { Outlet } from "react-router-dom"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { PanelLeft } from "lucide-react"
import { SiteSidebar } from "./SiteSidebar"

export function SiteLayout() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <SiteSidebar />
        <SidebarInset>
          <header className="flex h-12 items-center gap-2 border-b px-4">
            <SidebarTrigger>
              <Button variant="ghost" size="icon">
                <PanelLeft />
              </Button>
            </SidebarTrigger>
            <div className="ml-auto flex items-center gap-2">
              {/* Theme + language controls — will be added later */}
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
```

- [ ] **Step 2: Create `apps/web/src/components/SiteSidebar.tsx`**

```tsx
import { FileText, LayoutTemplate, Settings } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { ClipboardCheck } from "lucide-react"

const navItems = [
  { path: "/", label: "首页", icon: FileText },
  { path: "/templates", label: "模板库", icon: LayoutTemplate },
] as const

export function SiteSidebar() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <ClipboardCheck />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">TypeDance</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = location.pathname === item.path
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.label}
                      onClick={() => navigate(item.path)}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="设置">
              <Settings />
              <span>设置</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
```

- [ ] **Step 3: Rewrite `apps/web/src/App.tsx`**

Replace the current content with:

```tsx
import { RouterProvider } from "react-router-dom"
import { router } from "./router"
import "./styles.css"

export function App() {
  return <RouterProvider router={router} />
}
```

- [ ] **Step 4: Commit**

```bash
cd e:/workspaces/typedance && git add apps/web/src/components/ apps/web/src/App.tsx && git commit -m "feat: add SiteLayout with collapsible sidebar and router integration"
```

---

### Task 3: Add resume list API + types

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Add list/delete resume endpoints to `apps/web/src/api.ts`**

Add these functions after existing exports:

```typescript
export async function listResumeVersions(): Promise<ResumeVersion[]> {
  const response = await fetch(`${baseUrl}/resume-versions`);
  if (!response.ok) throw new Error(`Failed to list resumes: ${response.status}`);
  return z.array(resumeVersionSchema).parse(deepStripNull(await response.json()));
}

export async function deleteResumeVersion(resumeId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/resume-versions/${resumeId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Failed to delete resume: ${response.status}`);
}
```

Also update the imports to include `z`:

```typescript
import { z } from "zod";
```

And add the import for `resumeVersionSchema` if not already present — it is already imported.

- [ ] **Step 2: Add delete endpoint to sidecar `main.py`**

Add after `update_resume_version` (line 97):

```python
@app.delete("/resume-versions/{resume_id}", status_code=204)
def delete_resume_version(
    resume_id: str,
    repo: ResumeRepository = Depends(resume_repository),
) -> None:
    resume = repo.get(resume_id)
    if resume is None:
        raise HTTPException(status_code=404, detail="Resume version not found")
    repo.delete(resume_id)
```

Add `delete` method to `ResumeRepository` in `services/sidecar/src/typedance_sidecar/db.py`:

```python
def delete(self, resume_id: str) -> None:
    self.connection.execute("DELETE FROM resume_versions WHERE id = ?", (resume_id,))
    self.connection.commit()
```

- [ ] **Step 3: Commit**

```bash
cd e:/workspaces/typedance && git add apps/web/src/api.ts services/sidecar/src/typedance_sidecar/main.py services/sidecar/src/typedance_sidecar/db.py && git commit -m "feat: add list/delete resume API endpoints"
```

---

### Task 4: Create HomePage with resume grid

**Files:**
- Create: `apps/web/src/features/home/HomePage.tsx`
- Create: `apps/web/src/features/home/ResumeCard.tsx`
- Create: `apps/web/src/features/home/NewResumeModal.tsx`

- [ ] **Step 1: Create `apps/web/src/features/home/ResumeCard.tsx`**

```tsx
import type { ResumeVersion } from "@typedance/contracts"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, FileText } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type ResumeCardProps = {
  resume: ResumeVersion
  onClick: () => void
  onRename?: () => void
  onDuplicate?: () => void
  onDelete: () => void
}

export function ResumeCard({ resume, onClick, onRename, onDuplicate, onDelete }: ResumeCardProps) {
  const timeAgo = getRelativeTime(resume.updated_at)

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:bg-accent/50 cursor-pointer" onClick={onClick}>
      {/* A4 ratio thumbnail area */}
      <div className="aspect-[210/297] w-full bg-muted flex items-center justify-center overflow-hidden p-4">
        {resume.preview_pdf_url ? (
          <iframe
            src={resume.preview_pdf_url}
            className="h-full w-full pointer-events-none"
            title={resume.title}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <FileText className="h-8 w-8" />
            <span className="text-xs">{resume.template_id}</span>
          </div>
        )}
      </div>
      {/* Card footer */}
      <div className="flex items-center justify-between border-t px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{resume.title}</p>
          <p className="text-xs text-muted-foreground">
            {resume.target_language} · {timeAgo}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onRename && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRename(); }}>重命名</DropdownMenuItem>}
            {onDuplicate && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>复制</DropdownMenuItem>}
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-destructive">删除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function getRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(isoString).toLocaleDateString()
}
```

- [ ] **Step 2: Create `apps/web/src/features/home/NewResumeModal.tsx`**

```tsx
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { templateRegistry } from "../templates/data"
import { TemplatePreview } from "../templates/components/TemplatePreview"
import { builtInSamples, defaultClassicA4Style } from "../templates/data"
import { createResumeVersion } from "@/api"
import type { TargetLanguage } from "../workspace/types"

type NewResumeModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetLanguage: TargetLanguage
}

export function NewResumeModal({ open, onOpenChange, targetLanguage }: NewResumeModalProps) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState<string | null>(null)

  const handleApply = async (templateId: string) => {
    setLoading(templateId)
    try {
      const sampleId = templateRegistry.find(t => t.id === templateId)?.sampleContentIds[targetLanguage] ?? "sample-tech-zh"
      const sample = builtInSamples[sampleId] ?? builtInSamples["sample-tech-zh"]
      const resume = await createResumeVersion({
        title: "未命名简历",
        target_language: targetLanguage,
        template_id: templateId,
        doc_json: sample.doc_json,
        plain_text_snapshot: sample.plain_text_snapshot,
      })
      onOpenChange(false)
      navigate(`/workspace/${resume.id}`)
    } catch {
      // handle error
    } finally {
      setLoading(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>选择模板</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-4 py-4">
          {templateRegistry.map((template) => (
            <div key={template.id} className="flex flex-col items-center gap-2">
              <div className="aspect-[210/297] w-full rounded-lg border overflow-hidden">
                <TemplatePreview
                  sample={builtInSamples[template.sampleContentIds[targetLanguage] ?? "sample-tech-zh"]}
                  styleConfig={defaultClassicA4Style}
                />
              </div>
              <p className="text-sm font-medium">{template.localizedName["zh-CN"]}</p>
              <Button
                size="sm"
                onClick={() => handleApply(template.id)}
                disabled={loading === template.id}
              >
                {loading === template.id ? "创建中..." : "应用"}
              </Button>
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-muted-foreground">
          也可以去 <Button variant="link" className="h-auto p-0" onClick={() => { onOpenChange(false); navigate("/templates"); }}>模板库</Button> 浏览更多
        </p>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Create `apps/web/src/features/home/HomePage.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { listResumeVersions, deleteResumeVersion } from "@/api"
import type { ResumeVersion } from "@typedance/contracts"
import { ResumeCard } from "./ResumeCard"
import { NewResumeModal } from "./NewResumeModal"

export function HomePage() {
  const navigate = useNavigate()
  const [resumes, setResumes] = useState<ResumeVersion[]>([])
  const [modalOpen, setModalOpen] = useState(false)

  const loadResumes = useCallback(async () => {
    try {
      const list = await listResumeVersions()
      setResumes(list)
    } catch {
      // DB might be empty, that's OK
    }
  }, [])

  useEffect(() => { loadResumes() }, [loadResumes])

  const handleDelete = useCallback(async (resumeId: string) => {
    await deleteResumeVersion(resumeId)
    setResumes((prev) => prev.filter((r) => r.id !== resumeId))
  }, [])

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">我的简历</h1>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          新建简历
        </Button>
      </div>

      {resumes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="mb-2 text-lg text-muted-foreground">还没有简历</p>
          <p className="mb-6 text-sm text-muted-foreground">创建你的第一份简历，从选择模板开始</p>
          <Button onClick={() => setModalOpen(true)}>创建第一份简历</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {resumes.map((resume) => (
            <ResumeCard
              key={resume.id}
              resume={resume}
              onClick={() => navigate(`/workspace/${resume.id}`)}
              onDelete={() => handleDelete(resume.id)}
            />
          ))}
        </div>
      )}

      <NewResumeModal open={modalOpen} onOpenChange={setModalOpen} targetLanguage="zh-CN" />
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
cd e:/workspaces/typedance && git add apps/web/src/features/home/ && git commit -m "feat: add home page with resume grid and new resume modal"
```

---

### Task 5: Adapt TemplateLibrary and TemplateCard for routing

**Files:**
- Modify: `apps/web/src/features/templates/components/TemplateCard.tsx`
- Modify: `apps/web/src/features/templates/components/TemplateLibrary.tsx`

- [ ] **Step 1: Add apply button to `TemplateCard.tsx`**

Add `onApply` prop and render the button:

```tsx
type TemplateCardProps = {
  template: ResumeTemplateDefinition
  sample: TemplateSampleContent
  styleConfig: TemplateStyleConfig
  uiLanguage: UiLanguage
  targetLanguage: TargetLanguage
  onOpen: () => void
  onApply?: () => void      // ← add
}
```

Add the button after tags, inside the card:

```tsx
      <span className="td-template-card-tags">
        {template.tags[uiLanguage].map((tag) => (
          <Badge key={tag} variant="secondary">{tag}</Badge>
        ))}
        <Badge variant={template.languages.includes(targetLanguage) ? "default" : "secondary"}>
          {template.status === "built-in" ? "内置" : "规划中"}
        </Badge>
      </span>
      {/* ← add: */}
      {onApply && (
        <Button
          size="sm"
          className="mt-2 w-full"
          onClick={(e) => { e.stopPropagation(); onApply(); }}
        >
          应用
        </Button>
      )}
```

- [ ] **Step 2: Update `TemplateLibrary.tsx` to work with router**

```tsx
// Add useNavigate at top
import { useNavigate } from "react-router-dom"
import { createResumeVersion } from "@/api" // if not already imported

export function TemplateLibrary({ uiLanguage, targetLanguage }: TemplateLibraryProps) {
  const navigate = useNavigate()
  // ... existing state ...

  const handleApply = async (templateId: string) => {
    const sampleId = currentTemplate.sampleContentIds[targetLanguage] ?? "sample-tech-zh"
    const sample = builtInSamples[sampleId] ?? builtInSamples["sample-tech-zh"]
    const resume = await createResumeVersion({
      title: "未命名简历",
      target_language: targetLanguage,
      template_id: templateId,
      doc_json: sample.doc_json,
      plain_text_snapshot: sample.plain_text_snapshot,
    })
    navigate(`/workspace/${resume.id}`)
  }

  // Pass handleApply to TemplateCard as onApply
  // ...
}
```

Pass `onApply` when rendering TemplateCard in the template grid section.

- [ ] **Step 3: Commit**

```bash
cd e:/workspaces/typedance && git add apps/web/src/features/templates/components/ && git commit -m "feat: add apply button to template cards, adapt template library for routing"
```

---

### Task 6: Create WorkspacePage with right tab panel

**Files:**
- Create: `apps/web/src/features/workspace/WorkspacePage.tsx`
- Create: `apps/web/src/features/workspace/components/RightPanel.tsx`
- Create: `apps/web/src/features/workspace/components/AiTab.tsx`

- [ ] **Step 1: Create `apps/web/src/features/workspace/components/RightPanel.tsx`**

```tsx
import { type ReactNode, useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Paintbrush, Bot } from "lucide-react"

type TabId = "style" | "ai"

type RightPanelProps = {
  styleContent: ReactNode
  aiContent: ReactNode
  aiUnread?: boolean
}

export function RightPanel({ styleContent, aiContent, aiUnread }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("style")

  return (
    <aside className="flex h-full w-80 flex-col border-l bg-background">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} className="flex h-full flex-col">
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
```

- [ ] **Step 2: Create `apps/web/src/features/workspace/components/AiTab.tsx`**

```tsx
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
          <p className="text-center text-sm text-muted-foreground py-8">
            选中简历文本，或在此输入提问
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`rounded-lg p-3 text-sm ${msg.role === "user" ? "bg-primary/10 ml-4" : "bg-muted mr-4"}`}>
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
```

- [ ] **Step 3: Create `apps/web/src/features/workspace/WorkspacePage.tsx`**

This file coordinates the workspace — editor on left, RightPanel on right:

```tsx
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
import type { ResumeVersion } from "@typedance/contracts"
import type { TemplateStyleConfig } from "@typedance/contracts"
import type { BlockType } from "@typedance/contracts"

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [resume, setResume] = useState<ResumeVersion | null>(null)
  const [docJson, setDocJson] = useState<ResumeDocJson>({ type: "doc", content: [] })
  const [activeBlock, setActiveBlock] = useState<BlockType>("paragraph")
  const [styleConfig, setStyleConfig] = useState<TemplateStyleConfig>(defaultClassicA4Style)

  // Track whether current template has been forked
  const forkedRef = useRef(false)
  const forkedTemplateIdRef = useRef<string | null>(null)

  useEffect(() => {
    // TODO: fetch resume by id from API
    // For now, the resume is passed via navigation state or fetched
    // We'll use a placeholder and load template styles
    const template = templateRegistry[0]
    getTemplateStyle(template.id)
      .then(setStyleConfig)
      .catch(() => setStyleConfig(defaultClassicA4Style))
  }, [id])

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
    // Template fork logic:
    if (!forkedRef.current && resume) {
      const template = templateRegistry.find(t => t.id === resume.template_id)
      if (template?.status === "built-in") {
        // Fork: save under new template ID, update resume
        forkedRef.current = true
        const newId = `user_${resume.template_id}_${Date.now()}`
        forkedTemplateIdRef.current = newId
        saveTemplateStyle({ ...newStyle, template_id: newId })
          .then(() => {
            // TODO: update resume template_id via PATCH endpoint
          })
      } else {
        saveTemplateStyle(newStyle)
      }
    } else {
      const id = forkedTemplateIdRef.current ?? newStyle.template_id
      saveTemplateStyle({ ...newStyle, template_id: id })
    }
  }, [resume])

  return (
    <div className="flex h-full">
      {/* Editor area */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-sm font-medium flex-1">{resume?.title ?? "加载中..."}</h2>
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
```

- [ ] **Step 4: Commit**

```bash
cd e:/workspaces/typedance && git add apps/web/src/features/workspace/WorkspacePage.tsx apps/web/src/features/workspace/components/RightPanel.tsx apps/web/src/features/workspace/components/AiTab.tsx && git commit -m "feat: add workspace page with right tab panel (style + AI)"
```

---

### Task 7: Clean up deprecated code and types

**Files:**
- Delete: `apps/web/src/features/workspace/components/InsightPanel.tsx`
- Modify: `apps/web/src/features/workspace/types.ts` (remove unused sections)
- Modify: `apps/web/src/features/workspace/data.ts` (clean up unused data)

- [ ] **Step 1: Remove `InsightPanel.tsx`**

```bash
git rm apps/web/src/features/workspace/components/InsightPanel.tsx
```

- [ ] **Step 2: Clean up `types.ts`**

Remove unused sections from `WorkspaceSection`:

```typescript
export type WorkspaceSection = "workspace" | "templates"
```

Remove unused types like `EvidenceCard`, `ReviewGateResult`, `RunState`, `JobTarget`, etc. that are no longer used by the simplified workspace.

(Keep `UiLanguage`, `TargetLanguage`, `ThemePreference`, `WorkspaceCopy` as they're still used.)

- [ ] **Step 3: Commit**

```bash
cd e:/workspaces/typedance && git add apps/web/src/features/workspace/ && git commit -m "refactor: remove deprecated InsightPanel and clean up workspace types"
```

---

### Task 8: AI Inline Interaction — Text Selection Popper (Optional Phase)

**Files:**
- Create: `apps/web/src/features/workspace/components/AiPopper.tsx`
- Modify: `apps/web/src/features/workspace/WorkspacePage.tsx`

- [ ] **Step 1: Create `AiPopper.tsx`**

```tsx
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Sparkles, PenLine, SpellCheck, MessageSquare, Pin } from "lucide-react"

type AiPopperProps = {
  selectedText: string
  position: { x: number; y: number }
  onAction: (action: string, text: string) => void
  onDock: () => void
  onClose: () => void
}

const actions = [
  { id: "polish", label: "润色", icon: Sparkles },
  { id: "rewrite", label: "改写", icon: PenLine },
  { id: "grammar", label: "语法检查", icon: SpellCheck },
  { id: "custom", label: "自定义", icon: MessageSquare },
]

export function AiPopper({ selectedText, position, onAction, onDock, onClose }: AiPopperProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay to avoid immediate close from the selection event itself
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-50 flex items-center gap-1 rounded-lg border bg-popover p-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <Button
            key={action.id}
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            onClick={() => onAction(action.id, selectedText)}
          >
            <Icon className="h-3.5 w-3.5" />
            {action.label}
          </Button>
        )
      })}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onDock}
        title="钉到侧栏"
      >
        <Pin className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Integrate popper into `WorkspacePage.tsx`**

Add state for selection popper and handle text selection:

```tsx
// Add state:
const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null)
const [aiUnread, setAiUnread] = useState(false)

// Add selection handler:
const handleTextSelect = useCallback(() => {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.toString().trim()) {
    setSelection(null)
    return
  }
  const range = sel.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  setSelection({
    text: sel.toString(),
    x: rect.left + rect.width / 2,
    y: rect.bottom + 8,
  })
}, [])

// Add to the editor area, attach onMouseUp handler:
// (This is a simplified approach — TipTap has its own selection handling)
```

Then render the popper conditionally:

```tsx
{selection && (
  <AiPopper
    selectedText={selection.text}
    position={{ x: selection.x, y: selection.y }}
    onAction={(action, text) => {
      // Send to AI tab, show in AI tab with notification
      setAiUnread(true)
      setSelection(null)
    }}
    onDock={() => {
      setAiUnread(true)
      setSelection(null)
    }}
    onClose={() => setSelection(null)}
  />
)}
```

- [ ] **Step 3: Commit**

```bash
cd e:/workspaces/typedance && git add apps/web/src/features/workspace/components/AiPopper.tsx apps/web/src/features/workspace/WorkspacePage.tsx && git commit -m "feat: add AI text selection popper with quick actions"
```

---

### Task 9: Draggable AI Floating Window (Optional Phase)

**Files:**
- Create: `apps/web/src/features/workspace/components/AiFloatingWindow.tsx`

- [ ] **Step 1: Create `AiFloatingWindow.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { GripHorizontal, Pin, X } from "lucide-react"

type AiFloatingWindowProps = {
  title?: string
  children: React.ReactNode
  defaultPosition?: { x: number; y: number }
  onDock?: () => void
  onClose: () => void
}

export function AiFloatingWindow({
  children,
  title = "AI 助手",
  defaultPosition = { x: 100, y: 100 },
  onDock,
  onClose,
}: AiFloatingWindowProps) {
  const [position, setPosition] = useState(defaultPosition)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0 })
  const windowRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    }
  }, [position])

  useEffect(() => {
    if (!dragging) return
    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      setPosition({
        x: dragRef.current.startPosX + dx,
        y: dragRef.current.startPosY + dy,
      })
    }
    const handleMouseUp = () => setDragging(false)
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [dragging])

  return (
    <div
      ref={windowRef}
      className="fixed z-50 flex w-80 flex-col rounded-lg border bg-background shadow-xl"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="flex cursor-move items-center gap-2 border-b px-3 py-2"
        onMouseDown={handleMouseDown}
      >
        <GripHorizontal className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium">{title}</span>
        {onDock && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDock}>
            <Pin className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="overflow-auto p-3">{children}</div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd e:/workspaces/typedance && git add apps/web/src/features/workspace/components/AiFloatingWindow.tsx && git commit -m "feat: add draggable AI floating window"
```

---

### Task 10: Integration and tests

- [ ] **Step 1: Verify build**

Run:
```bash
cd e:/workspaces/typedance && pnpm build
```
Expected: Build succeeds without TypeScript errors.

- [ ] **Step 2: Fix any build errors**

Check for missing imports, wrong types, or broken references. The main areas to verify:
- `TemplateCard` has the new `onApply` prop
- `TemplateLibrary` uses `useNavigate` correctly
- `App.tsx` uses `RouterProvider`
- Old imports referencing `EvidenceCard`, `RunState`, etc. are updated

- [ ] **Step 3: Tag the commit as "v1.0-workspace-redesign"**

```bash
cd e:/workspaces/typedance && git tag -a "v1.0-workspace-redesign" -m "Workspace redesign: routing, home page, template flow, workspace tab panel"
```

---
