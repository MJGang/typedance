# Resume Pack Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把前端入口迁移到 `/packs/resume/...`，并让用户可以从 Resume Pack 的“工作台”菜单重新进入已创建的改稿工作台。

**Architecture:** 使用一个 Resume Pack 路由常量文件作为路径和菜单的单一来源；新增工作台列表页读取 `GET /documents`，简历成品页沿用当前 `GET /resume-versions`；路由层只保留 `/packs/resume/...` 新结构，不保留旧路径。侧边栏从固定全局导航改为读取当前 Pack 配置。

**Tech Stack:** React 19, react-router-dom 7 `createBrowserRouter`, Vitest, Testing Library, Zod, Tailwind CSS, shadcn/ui existing components.

---

## Context

- 设计规格：`docs/superpowers/specs/2026-05-26-resume-pack-dashboard-design.md`
- Context7 已查询 React Router 文档：
  - `/remix-run/react-router`
  - 关键点：`createBrowserRouter` 支持 route object children，父级 layout 用 `Outlet`，index route 可作为默认子页面。
- 当前工作区有用户改动：`AGENTS.md`。本计划不触碰该文件，提交时只 stage 本任务文件。

## File Structure

- Create: `apps/web/src/features/resume-pack/routes.ts`
  - Resume Pack 路径常量、导航项、激活规则。
- Create: `apps/web/src/features/resume-pack/RevisionWorkspaceCard.tsx`
  - 工作台列表中的单个卡片。
- Create: `apps/web/src/features/resume-pack/ResumeWorkspacesPage.tsx`
  - 工作台列表页，读取 `listRevisionDocuments`，承载导入旧简历和空白引导入口。
- Create: `apps/web/src/features/resume-pack/ResumeProductsPage.tsx`
  - 简历成品列表页，从当前 `HomePage` 迁移简历成品卡片逻辑。
- Create: `apps/web/src/features/resume-pack/ResumeWorkspacesPage.test.tsx`
  - 覆盖工作台列表、空态、错误、点击进入详情、导入入口。
- Create: `apps/web/src/features/resume-pack/ResumeProductsPage.test.tsx`
  - 覆盖成品列表、空态、点击进入成品编辑器、从成品打开新工作台。
- Modify: `apps/web/src/api.ts`
  - 增加 `listRevisionDocuments()`。
- Modify: `apps/web/src/api.test.ts`
  - 增加 `listRevisionDocuments` 测试。
- Modify: `apps/web/src/components/SiteSidebar.tsx`
  - 改成 Resume Pack 身份和 Pack 菜单。
- Modify: `apps/web/src/router.tsx`
  - 移除旧路由，增加 `/packs/resume/...`。
- Modify: `apps/web/src/features/home/ImportOldResumeModal.tsx`
  - 导入成功跳转到工作台新路径。
- Modify: `apps/web/src/features/home/BlankGuidedResumeModal.tsx`
  - 生成成功跳转到工作台新路径。
- Modify: `apps/web/src/features/home/NewResumeModal.tsx`
  - 模板创建成功跳转到简历成品新路径，模板库链接使用新路径。
- Modify: `apps/web/src/features/workspace/WorkspacePage.tsx`
  - 返回按钮回到简历成品列表。
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
  - 返回按钮回到工作台列表。
- Modify: `apps/web/src/App.test.tsx`
  - 更新 Sidebar 和 App 默认入口断言。
- Modify: `apps/web/src/features/home/ImportOldResumeModal.test.tsx`
  - 更新导入成功路径断言。
- Modify: `apps/web/src/features/home/BlankGuidedResumeModal.test.tsx`
  - 更新空白引导成功路径断言。
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
  - 测试路由参数改为新路径。

---

### Task 1: Add Resume Pack Routes

**Files:**
- Create: `apps/web/src/features/resume-pack/routes.ts`

- [ ] **Step 1: Create route constants and navigation config**

Create `apps/web/src/features/resume-pack/routes.ts` with:

```ts
import { BriefcaseBusiness, FileText, LayoutTemplate, Settings } from "lucide-react"
import type { ComponentType } from "react"

export const RESUME_PACK_BASE_PATH = "/packs/resume" as const

export const resumePackPaths = {
  workspaces: `${RESUME_PACK_BASE_PATH}/workspaces`,
  workspace: (documentId: string) => `${RESUME_PACK_BASE_PATH}/workspaces/${documentId}`,
  resumes: `${RESUME_PACK_BASE_PATH}/resumes`,
  resume: (resumeId: string) => `${RESUME_PACK_BASE_PATH}/resumes/${resumeId}`,
  templates: `${RESUME_PACK_BASE_PATH}/templates`,
  settings: `${RESUME_PACK_BASE_PATH}/settings`,
} as const

export type ResumePackNavItem = {
  id: "workspaces" | "resumes" | "templates" | "settings"
  label: string
  path: string
  icon: ComponentType<{ className?: string }>
  isActive: (pathname: string) => boolean
}

export const resumePackNavigation: ResumePackNavItem[] = [
  {
    id: "workspaces",
    label: "工作台",
    path: resumePackPaths.workspaces,
    icon: BriefcaseBusiness,
    isActive: (pathname) => pathname === resumePackPaths.workspaces || pathname.startsWith(`${resumePackPaths.workspaces}/`),
  },
  {
    id: "resumes",
    label: "简历成品",
    path: resumePackPaths.resumes,
    icon: FileText,
    isActive: (pathname) => pathname === resumePackPaths.resumes || pathname.startsWith(`${resumePackPaths.resumes}/`),
  },
  {
    id: "templates",
    label: "模板",
    path: resumePackPaths.templates,
    icon: LayoutTemplate,
    isActive: (pathname) => pathname === resumePackPaths.templates,
  },
  {
    id: "settings",
    label: "设置",
    path: resumePackPaths.settings,
    icon: Settings,
    isActive: (pathname) => pathname === resumePackPaths.settings,
  },
]
```

- [ ] **Step 2: Run type check through web build**

Run:

```bash
corepack pnpm --filter @typedance/web build
```

Expected: build may fail because the file is not yet imported; any failure at this step should not mention `routes.ts` syntax or type errors.

---

### Task 2: Add listRevisionDocuments API Helper

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [ ] **Step 1: Write failing API test**

In `apps/web/src/api.test.ts`, inside `describe("revision api", () => { ... })`, add this test before the existing workspace-view test:

```ts
  it("lists revision documents for the workspace dashboard", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      {
        id: "doc_1",
        pack_id: "resume",
        title: "旧简历重构",
        status: "active",
        target_language: "zh-CN",
        current_draft_id: "draft_1",
        updated_at: "2026-05-26T08:00:00.000Z",
        quality_state: "needs_review",
      },
    ]))))

    const { listRevisionDocuments } = await import("./api")
    const documents = await listRevisionDocuments()

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4317/documents")
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({
      id: "doc_1",
      title: "旧简历重构",
      quality_state: "needs_review",
    })
  })
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
corepack pnpm --filter @typedance/web test -- api.test.ts
```

Expected: FAIL with an export error for `listRevisionDocuments`.

- [ ] **Step 3: Implement API helper**

In `apps/web/src/api.ts`, extend the contracts import:

```ts
  documentListItemSchema,
```

and add the type import:

```ts
  type DocumentListItem,
```

Add this function after `createRevisionDocument`:

```ts
export async function listRevisionDocuments(): Promise<DocumentListItem[]> {
  const response = await fetch(`${baseUrl}/documents`)
  return parseTemplateResponse(
    response,
    (value) => z.array(documentListItemSchema).parse(value),
    "Failed to list revision documents",
  )
}
```

- [ ] **Step 4: Run the API test**

Run:

```bash
corepack pnpm --filter @typedance/web test -- api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "feat(web): 新增改稿工作台列表API"
```

---

### Task 3: Build Workspaces Dashboard

**Files:**
- Create: `apps/web/src/features/resume-pack/RevisionWorkspaceCard.tsx`
- Create: `apps/web/src/features/resume-pack/ResumeWorkspacesPage.tsx`
- Create: `apps/web/src/features/resume-pack/ResumeWorkspacesPage.test.tsx`
- Modify: `apps/web/src/features/home/ImportOldResumeModal.tsx`
- Modify: `apps/web/src/features/home/BlankGuidedResumeModal.tsx`
- Modify: `apps/web/src/features/home/ImportOldResumeModal.test.tsx`
- Modify: `apps/web/src/features/home/BlankGuidedResumeModal.test.tsx`

- [ ] **Step 1: Write failing page tests**

Create `apps/web/src/features/resume-pack/ResumeWorkspacesPage.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ResumeWorkspacesPage } from "./ResumeWorkspacesPage"

const apiMocks = vi.hoisted(() => ({
  listRevisionDocuments: vi.fn(),
}))

vi.mock("@/api", () => ({
  listRevisionDocuments: (...args: unknown[]) => apiMocks.listRevisionDocuments(...args),
}))

vi.mock("../home/ImportOldResumeModal", () => ({
  ImportOldResumeModal: ({ open }: { open: boolean }) => open ? <div role="dialog">导入旧简历弹窗</div> : null,
}))

vi.mock("../home/BlankGuidedResumeModal", () => ({
  BlankGuidedResumeModal: ({ open }: { open: boolean }) => open ? <div role="dialog">新建简历弹窗</div> : null,
}))

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/packs/resume/workspaces"]}>
      <ResumeWorkspacesPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe("ResumeWorkspacesPage", () => {
  beforeEach(() => {
    apiMocks.listRevisionDocuments.mockReset()
    apiMocks.listRevisionDocuments.mockResolvedValue([
      {
        id: "doc_1",
        pack_id: "resume",
        title: "旧简历重构",
        status: "active",
        target_language: "zh-CN",
        current_draft_id: "draft_1",
        updated_at: "2026-05-26T08:00:00.000Z",
        quality_state: "needs_review",
      },
    ])
  })

  it("lists revision workspaces and opens a workspace", async () => {
    renderPage()

    expect(await screen.findByRole("heading", { name: "工作台" })).toBeInTheDocument()
    expect(screen.getByText("旧简历重构")).toBeInTheDocument()
    expect(screen.getByText("需检查")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /打开旧简历重构/ }))

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/packs/resume/workspaces/doc_1")
    })
  })

  it("opens import and blank guided modals", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "导入旧简历" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("导入旧简历弹窗")

    fireEvent.click(screen.getByRole("button", { name: "新建简历" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("新建简历弹窗")
  })

  it("shows an empty state", async () => {
    apiMocks.listRevisionDocuments.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText("还没有工作台")).toBeInTheDocument()
    expect(screen.getByText("导入旧简历或新建简历来开始改稿。")).toBeInTheDocument()
  })

  it("shows an error state with retry", async () => {
    apiMocks.listRevisionDocuments.mockRejectedValueOnce(new Error("network"))
    apiMocks.listRevisionDocuments.mockResolvedValueOnce([])

    renderPage()

    expect(await screen.findByText("工作台加载失败")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "重试" }))

    await waitFor(() => expect(apiMocks.listRevisionDocuments).toHaveBeenCalledTimes(2))
  })
})
```

- [ ] **Step 2: Run the failing page test**

Run:

```bash
corepack pnpm --filter @typedance/web test -- ResumeWorkspacesPage.test.tsx
```

Expected: FAIL because `ResumeWorkspacesPage` does not exist.

- [ ] **Step 3: Create workspace card**

Create `apps/web/src/features/resume-pack/RevisionWorkspaceCard.tsx`:

```tsx
import type { DocumentListItem } from "@typedance/contracts"
import { Button } from "@/components/ui/button"
import { PreviewShowcaseCard } from "@/components/preview-showcase-card"
import { ClipboardCheck, FileText } from "lucide-react"

type RevisionWorkspaceCardProps = {
  document: DocumentListItem
  onOpen: () => void
}

export function RevisionWorkspaceCard({ document, onOpen }: RevisionWorkspaceCardProps) {
  const statusLabel = getQualityStateLabel(document.quality_state)
  const timeLabel = getRelativeTime(document.updated_at)

  return (
    <PreviewShowcaseCard
      title={document.title}
      subtitle={`${statusLabel} · ${timeLabel}`}
      onClick={onOpen}
      previewClassName="bg-muted/40"
      preview={
        <div className="flex aspect-[210/297] w-full flex-col items-center justify-center gap-3 bg-card px-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ClipboardCheck className="size-6" />
          </div>
          <div className="grid gap-1">
            <p className="text-sm font-medium text-foreground">{statusLabel}</p>
            <p className="text-xs text-muted-foreground">{document.target_language}</p>
          </div>
        </div>
      }
      floatingActions={
        <Button size="sm" aria-label={`打开${document.title}`}>
          <FileText className="mr-2 size-4" />
          打开
        </Button>
      }
    />
  )
}

function getQualityStateLabel(state: DocumentListItem["quality_state"]): string {
  switch (state) {
    case "ready":
      return "可导出"
    case "blocked":
      return "有阻塞"
    case "needs_review":
      return "需检查"
    default:
      return "待检查"
  }
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

- [ ] **Step 4: Create workspaces page**

Create `apps/web/src/features/resume-pack/ResumeWorkspacesPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FileUp, Loader2, Plus } from "lucide-react"
import type { DocumentListItem } from "@typedance/contracts"
import { listRevisionDocuments } from "@/api"
import { Button } from "@/components/ui/button"
import { BlankGuidedResumeModal } from "../home/BlankGuidedResumeModal"
import { ImportOldResumeModal } from "../home/ImportOldResumeModal"
import { resumePackPaths } from "./routes"
import { RevisionWorkspaceCard } from "./RevisionWorkspaceCard"

export function ResumeWorkspacesPage() {
  const navigate = useNavigate()
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [guidedOpen, setGuidedOpen] = useState(false)

  const loadDocuments = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const list = await listRevisionDocuments()
      setDocuments(list.filter((document) => document.pack_id === "resume"))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadDocuments() }, [loadDocuments])

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">工作台</h1>
          <p className="mt-1 text-sm text-muted-foreground">继续处理导入重构、质量检查和修改建议。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileUp className="mr-2 size-4" />
            导入旧简历
          </Button>
          <Button onClick={() => setGuidedOpen(true)}>
            <Plus className="mr-2 size-4" />
            新建简历
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          加载工作台
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="mb-2 text-lg text-muted-foreground">工作台加载失败</p>
          <Button variant="outline" onClick={() => void loadDocuments()}>重试</Button>
        </div>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="mb-2 text-lg text-muted-foreground">还没有工作台</p>
          <p className="mb-6 text-sm text-muted-foreground">导入旧简历或新建简历来开始改稿。</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => setImportOpen(true)}>
              <FileUp className="mr-2 size-4" />
              导入旧简历
            </Button>
            <Button variant="outline" onClick={() => setGuidedOpen(true)}>新建简历</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-6 gap-y-8">
          {documents.map((document) => (
            <RevisionWorkspaceCard
              key={document.id}
              document={document}
              onOpen={() => navigate(resumePackPaths.workspace(document.id))}
            />
          ))}
        </div>
      )}

      <ImportOldResumeModal open={importOpen} onOpenChange={setImportOpen} />
      <BlankGuidedResumeModal open={guidedOpen} onOpenChange={setGuidedOpen} />
    </div>
  )
}
```

- [ ] **Step 5: Update modal navigation paths**

In `apps/web/src/features/home/ImportOldResumeModal.tsx`, import `resumePackPaths`:

```ts
import { resumePackPaths } from "../resume-pack/routes"
```

Replace:

```ts
navigate(`/revision/${workspace.document.id}`)
```

with:

```ts
navigate(resumePackPaths.workspace(workspace.document.id))
```

In `apps/web/src/features/home/BlankGuidedResumeModal.tsx`, make the same import and replacement.

- [ ] **Step 6: Update modal route tests**

In `apps/web/src/features/home/ImportOldResumeModal.test.tsx`, replace:

```ts
expect(screen.getByTestId("location")).toHaveTextContent("/revision/doc_import")
```

with:

```ts
expect(screen.getByTestId("location")).toHaveTextContent("/packs/resume/workspaces/doc_import")
```

In `apps/web/src/features/home/BlankGuidedResumeModal.test.tsx`, replace:

```ts
expect(screen.getByTestId("location")).toHaveTextContent("/revision/doc_guided")
```

with:

```ts
expect(screen.getByTestId("location")).toHaveTextContent("/packs/resume/workspaces/doc_guided")
```

- [ ] **Step 7: Run workspaces tests**

Run:

```bash
corepack pnpm --filter @typedance/web test -- ResumeWorkspacesPage.test.tsx ImportOldResumeModal.test.tsx BlankGuidedResumeModal.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/web/src/features/resume-pack/routes.ts apps/web/src/features/resume-pack/RevisionWorkspaceCard.tsx apps/web/src/features/resume-pack/ResumeWorkspacesPage.tsx apps/web/src/features/resume-pack/ResumeWorkspacesPage.test.tsx apps/web/src/features/home/ImportOldResumeModal.tsx apps/web/src/features/home/BlankGuidedResumeModal.tsx apps/web/src/features/home/ImportOldResumeModal.test.tsx apps/web/src/features/home/BlankGuidedResumeModal.test.tsx
git commit -m "feat(web): 新增Resume Pack工作台列表"
```

---

### Task 4: Build Resume Products Page

**Files:**
- Create: `apps/web/src/features/resume-pack/ResumeProductsPage.tsx`
- Create: `apps/web/src/features/resume-pack/ResumeProductsPage.test.tsx`
- Modify: `apps/web/src/features/home/NewResumeModal.tsx`
- Modify: `apps/web/src/features/home/HomePage.tsx`

- [ ] **Step 1: Write failing products page tests**

Create `apps/web/src/features/resume-pack/ResumeProductsPage.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ResumeProductsPage } from "./ResumeProductsPage"

const apiMocks = vi.hoisted(() => ({
  listResumeVersions: vi.fn(),
  deleteResumeVersion: vi.fn(),
  getTemplateStyle: vi.fn(),
  projectLegacyResumeToRevisionWorkspace: vi.fn(),
}))

vi.mock("@/api", () => ({
  listResumeVersions: (...args: unknown[]) => apiMocks.listResumeVersions(...args),
  deleteResumeVersion: (...args: unknown[]) => apiMocks.deleteResumeVersion(...args),
  getTemplateStyle: (...args: unknown[]) => apiMocks.getTemplateStyle(...args),
  projectLegacyResumeToRevisionWorkspace: (...args: unknown[]) => apiMocks.projectLegacyResumeToRevisionWorkspace(...args),
}))

vi.mock("../home/NewResumeModal", () => ({
  NewResumeModal: ({ open }: { open: boolean }) => open ? <div role="dialog">选择模板</div> : null,
}))

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/packs/resume/resumes"]}>
      <ResumeProductsPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe("ResumeProductsPage", () => {
  beforeEach(() => {
    apiMocks.listResumeVersions.mockReset()
    apiMocks.deleteResumeVersion.mockReset()
    apiMocks.getTemplateStyle.mockReset()
    apiMocks.projectLegacyResumeToRevisionWorkspace.mockReset()
    apiMocks.getTemplateStyle.mockResolvedValue({
      template_id: "classic-a4",
      name: "经典",
      version: 1,
      page: {},
      typography: {},
      colors: {},
      spacing: {},
      blocks: {},
      updated_at: "2026-05-26T08:00:00.000Z",
    })
    apiMocks.listResumeVersions.mockResolvedValue([
      {
        id: "resume_1",
        title: "张三简历",
        target_language: "zh-CN",
        template_id: "classic-a4",
        plain_text_snapshot: "张三",
        doc_json: { type: "doc", content: [] },
        created_at: "2026-05-26T08:00:00.000Z",
        updated_at: "2026-05-26T08:00:00.000Z",
      },
    ])
    apiMocks.projectLegacyResumeToRevisionWorkspace.mockResolvedValue({
      document: { id: "doc_from_resume" },
    })
  })

  it("lists resume products and opens a product editor", async () => {
    renderPage()

    expect(await screen.findByRole("heading", { name: "简历成品" })).toBeInTheDocument()
    expect(screen.getByText("张三简历")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /张三简历/ }))

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/packs/resume/resumes/resume_1")
    })
  })

  it("opens a new workspace from a resume product", async () => {
    renderPage()

    fireEvent.click(await screen.findByLabelText("打开简历菜单"))
    fireEvent.click(screen.getByText("用新工作台打开"))

    await waitFor(() => expect(apiMocks.projectLegacyResumeToRevisionWorkspace).toHaveBeenCalledWith("resume_1"))
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/packs/resume/workspaces/doc_from_resume")
    })
  })

  it("shows an empty state for resume products", async () => {
    apiMocks.listResumeVersions.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText("还没有简历成品")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "从模板开始" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("选择模板")
  })
})
```

- [ ] **Step 2: Run the failing products page test**

Run:

```bash
corepack pnpm --filter @typedance/web test -- ResumeProductsPage.test.tsx
```

Expected: FAIL because `ResumeProductsPage` does not exist.

- [ ] **Step 3: Create products page**

Create `apps/web/src/features/resume-pack/ResumeProductsPage.tsx` by moving the current `HomePage` resume-list behavior and using new paths:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { deleteResumeVersion, getTemplateStyle, listResumeVersions, projectLegacyResumeToRevisionWorkspace } from "@/api"
import type { ResumeVersion, TemplateStyleConfig } from "@typedance/contracts"
import { ResumeCard } from "../home/ResumeCard"
import { NewResumeModal } from "../home/NewResumeModal"
import { defaultClassicA4Style } from "../templates/data"
import { resumePackPaths } from "./routes"

export function ResumeProductsPage() {
  const navigate = useNavigate()
  const [resumes, setResumes] = useState<ResumeVersion[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [styleMap, setStyleMap] = useState<Record<string, TemplateStyleConfig>>({})

  const loadResumes = useCallback(async () => {
    try {
      const list = await listResumeVersions()
      setResumes(list)
    } catch {
      setResumes([])
    }
  }, [])

  useEffect(() => { void loadResumes() }, [loadResumes])

  const uniqueTemplateIds = useMemo(
    () => [...new Set(resumes.map((resume) => resume.template_id))],
    [resumes],
  )

  useEffect(() => {
    if (uniqueTemplateIds.length === 0) return

    let cancelled = false
    Promise.allSettled(
      uniqueTemplateIds.map(async (id) => {
        const style = await getTemplateStyle(id)
        return { templateId: id, style }
      }),
    ).then((results) => {
      if (cancelled) return
      const nextStyleMap: Record<string, TemplateStyleConfig> = {}
      for (const result of results) {
        if (result.status === "fulfilled") {
          nextStyleMap[result.value.templateId] = result.value.style
        }
      }
      setStyleMap(nextStyleMap)
    })
    return () => { cancelled = true }
  }, [uniqueTemplateIds])

  const handleDelete = useCallback(async (resumeId: string) => {
    await deleteResumeVersion(resumeId)
    setResumes((prev) => prev.filter((resume) => resume.id !== resumeId))
  }, [])

  const handleOpenRevisionWorkspace = useCallback(async (resumeId: string) => {
    const workspace = await projectLegacyResumeToRevisionWorkspace(resumeId)
    navigate(resumePackPaths.workspace(workspace.document.id))
  }, [navigate])

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">简历成品</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理可编辑、可导出和可复用的简历版本。</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="mr-2 size-4" />
          从模板开始
        </Button>
      </div>

      {resumes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="mb-2 text-lg text-muted-foreground">还没有简历成品</p>
          <p className="mb-6 text-sm text-muted-foreground">从模板创建一份可编辑和导出的简历。</p>
          <Button onClick={() => setModalOpen(true)}>从模板开始</Button>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-6 gap-y-8">
          {resumes.map((resume) => (
            <ResumeCard
              key={resume.id}
              resume={resume}
              styleConfig={styleMap[resume.template_id] ?? defaultClassicA4Style}
              onClick={() => navigate(resumePackPaths.resume(resume.id))}
              onOpenRevision={() => void handleOpenRevisionWorkspace(resume.id)}
              onDelete={() => void handleDelete(resume.id)}
            />
          ))}
        </div>
      )}

      <NewResumeModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  )
}
```

- [ ] **Step 4: Make old HomePage a thin export**

Replace `apps/web/src/features/home/HomePage.tsx` with:

```tsx
export { ResumeProductsPage as HomePage } from "../resume-pack/ResumeProductsPage"
```

This keeps existing imports compiling while router moves to Pack pages.

- [ ] **Step 5: Update template creation navigation**

In `apps/web/src/features/home/NewResumeModal.tsx`, import `resumePackPaths`:

```ts
import { resumePackPaths } from "../resume-pack/routes"
```

Replace:

```ts
navigate(`/workspace/${resume.id}`)
```

with:

```ts
navigate(resumePackPaths.resume(resume.id))
```

Replace:

```ts
navigate("/templates")
```

with:

```ts
navigate(resumePackPaths.templates)
```

- [ ] **Step 6: Run products page tests**

Run:

```bash
corepack pnpm --filter @typedance/web test -- ResumeProductsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/web/src/features/resume-pack/ResumeProductsPage.tsx apps/web/src/features/resume-pack/ResumeProductsPage.test.tsx apps/web/src/features/home/HomePage.tsx apps/web/src/features/home/NewResumeModal.tsx
git commit -m "feat(web): 新增Resume Pack简历成品页"
```

---

### Task 5: Replace Router and Sidebar with Pack IA

**Files:**
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/components/SiteSidebar.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`

- [ ] **Step 1: Update App and Sidebar tests first**

In `apps/web/src/App.test.tsx`, replace the two tests with:

```tsx
  it("renders the resume pack workspaces page as the default entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    )

    render(<App />)

    expect(await screen.findByRole("heading", { name: "工作台" })).toBeInTheDocument()
    expect(screen.getByText("Resume Pack")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "工作台" })).toHaveAttribute("data-active", "true")
    expect(screen.getByRole("link", { name: "简历成品" })).not.toHaveAttribute("data-active")
    expect(screen.queryByRole("button", { name: "切换 Pack" })).not.toBeInTheDocument()
  })

  it("marks resume pack entries active on nested pages", () => {
    renderSidebarAt("/packs/resume/templates")

    expect(screen.getByRole("link", { name: "工作台" })).not.toHaveAttribute("data-active")
    expect(screen.getByRole("link", { name: "模板" })).toHaveAttribute("data-active", "true")
  })
```

- [ ] **Step 2: Update revision page test route**

In `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`, replace `renderPage()` with:

```tsx
function renderPage() {
  render(
    <MemoryRouter initialEntries={["/packs/resume/workspaces/doc_1"]}>
      <Routes>
        <Route path="/packs/resume/workspaces/:documentId" element={<RevisionWorkspacePage />} />
      </Routes>
    </MemoryRouter>,
  )
}
```

- [ ] **Step 3: Run failing route/sidebar tests**

Run:

```bash
corepack pnpm --filter @typedance/web test -- App.test.tsx RevisionWorkspacePage.test.tsx
```

Expected: FAIL because router and sidebar still point to old paths.

- [ ] **Step 4: Replace router**

Replace `apps/web/src/router.tsx` with:

```tsx
import { Navigate, createBrowserRouter } from "react-router-dom"
import { SiteLayout } from "./components/SiteLayout"
import { TemplateLibrary } from "./features/templates/components/TemplateLibrary"
import { RevisionWorkspacePage } from "./features/revision/RevisionWorkspacePage"
import { SettingsPage } from "./features/settings/SettingsPage"
import { WorkspacePage } from "./features/workspace/WorkspacePage"
import { ResumeProductsPage } from "./features/resume-pack/ResumeProductsPage"
import { ResumeWorkspacesPage } from "./features/resume-pack/ResumeWorkspacesPage"
import { resumePackPaths } from "./features/resume-pack/routes"

export const router = createBrowserRouter([
  {
    element: <SiteLayout />,
    children: [
      { path: "/", element: <Navigate to={resumePackPaths.workspaces} replace /> },
      { path: "/packs/resume/workspaces", element: <ResumeWorkspacesPage /> },
      { path: "/packs/resume/workspaces/:documentId", element: <RevisionWorkspacePage /> },
      { path: "/packs/resume/resumes", element: <ResumeProductsPage /> },
      { path: "/packs/resume/resumes/:id", element: <WorkspacePage /> },
      { path: "/packs/resume/templates", element: <TemplateLibrary /> },
      { path: "/packs/resume/settings", element: <SettingsPage /> },
    ],
  },
])
```

- [ ] **Step 5: Replace sidebar**

Replace `apps/web/src/components/SiteSidebar.tsx` with:

```tsx
import { ClipboardCheck } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { resumePackNavigation } from "@/features/resume-pack/routes"

export function SiteSidebar() {
  const location = useLocation()
  const canSwitchPacks = false

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
                <span className="truncate font-semibold">简历</span>
                <span className="truncate text-xs text-muted-foreground">Resume Pack</span>
              </div>
              {canSwitchPacks && (
                <button type="button" aria-label="切换 Pack" className="ml-auto rounded-md p-1 hover:bg-sidebar-accent">
                  <span className="sr-only">切换 Pack</span>
                </button>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {resumePackNavigation.map((item) => {
                const Icon = item.icon
                const isActive = item.isActive(location.pathname)
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                    >
                      <Link to={item.path} aria-current={isActive ? "page" : undefined}>
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
```

- [ ] **Step 6: Run route/sidebar tests**

Run:

```bash
corepack pnpm --filter @typedance/web test -- App.test.tsx RevisionWorkspacePage.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/web/src/router.tsx apps/web/src/components/SiteSidebar.tsx apps/web/src/App.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
git commit -m "feat(web): 切换Resume Pack路由导航"
```

---

### Task 6: Update Remaining Internal Links

**Files:**
- Modify: `apps/web/src/features/workspace/WorkspacePage.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
- Modify: any source file found by the search command in this task.

- [ ] **Step 1: Search old route references**

Run:

```bash
rg -n 'navigate\(|to="/|href="/|/workspace|/revision|/templates|/settings' apps/web/src
```

Expected remaining production references before edits:

```text
apps/web/src/features/workspace/WorkspacePage.tsx
apps/web/src/features/revision/RevisionWorkspacePage.tsx
```

Test files may still mention old strings until updated in the next step.

- [ ] **Step 2: Update WorkspacePage back navigation**

In `apps/web/src/features/workspace/WorkspacePage.tsx`, import:

```ts
import { resumePackPaths } from "../resume-pack/routes"
```

Replace every:

```ts
navigate("/")
```

with:

```ts
navigate(resumePackPaths.resumes)
```

- [ ] **Step 3: Update RevisionWorkspacePage back navigation**

In `apps/web/src/features/revision/RevisionWorkspacePage.tsx`, import:

```ts
import { resumePackPaths } from "../resume-pack/routes"
```

Replace:

```ts
navigate("/")
```

with:

```ts
navigate(resumePackPaths.workspaces)
```

- [ ] **Step 4: Search again**

Run:

```bash
rg -n '"/workspace|"/revision|"/templates"|"/settings"|`/workspace|`/revision' apps/web/src
```

Expected: no production source references to old route literals. If output includes the design of removed route tests, update those tests to `/packs/resume/...`.

- [ ] **Step 5: Run focused web tests**

Run:

```bash
corepack pnpm --filter @typedance/web test -- App.test.tsx ResumeWorkspacesPage.test.tsx ResumeProductsPage.test.tsx ImportOldResumeModal.test.tsx BlankGuidedResumeModal.test.tsx RevisionWorkspacePage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/src/features/workspace/WorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.tsx
git commit -m "fix(web): 更新Pack路由内部返回入口"
```

---

### Task 7: Full Verification

**Files:**
- Verify only unless failures require code changes.

- [ ] **Step 1: Run full web tests**

Run:

```bash
corepack pnpm --filter @typedance/web test
```

Expected: PASS.

- [ ] **Step 2: Run web build**

Run:

```bash
corepack pnpm --filter @typedance/web build
```

Expected: PASS.

- [ ] **Step 3: Search for old routes**

Run:

```bash
rg -n '"/workspace|"/revision|"/templates"|"/settings"|`/workspace|`/revision|`/templates|`/settings' apps/web/src
```

Expected: no matches in production code. If matches are in intentionally historical docs or changelog outside `apps/web/src`, leave them alone.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short --branch
```

Expected:

```text
## main...origin/main [ahead N]
 M AGENTS.md
```

`AGENTS.md` is user-owned local work and must not be staged by this task.

- [ ] **Step 5: Final commit if verification edits were needed**

If Step 1 or Step 2 required fixes after Task 6, commit only those fix files:

```bash
git add <files-fixed-for-verification>
git commit -m "fix(web): 修复Pack路由验证问题"
```

If no verification fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage:
  - `/packs/resume/...` 路由：Task 5.
  - 工作台列表和重新进入工作台：Task 2 and Task 3.
  - 简历成品独立入口：Task 4.
  - Pack Identity 和侧边栏菜单：Task 1 and Task 5.
  - 不保留旧路由：Task 5 and Task 6.
  - 模板、设置、编辑器迁移：Task 5 and Task 6.
- Placeholder scan: no open placeholders and no unbounded “add tests” instruction.
- Type consistency:
  - `DocumentListItem` comes from `@typedance/contracts`.
  - `resumePackPaths.workspace(documentId)` is used for revision workspaces.
  - `resumePackPaths.resume(resumeId)` is used for resume products.
  - `RevisionWorkspacePage` keeps `documentId`; `WorkspacePage` keeps `id`.
