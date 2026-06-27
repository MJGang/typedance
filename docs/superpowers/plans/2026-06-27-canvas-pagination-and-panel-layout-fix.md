# 画布分页与右侧面板布局修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复画布分页器整体错后一页的问题，并保证窄窗口下右侧 AI 面板完整显示。

**Architecture:** 分页修复限定在 `DraftCanvas` 的渲染 DOM 测量层，以编辑器顶部作为第一页、前一个页尾断点作为后续页目标；布局修复限定在 `RevisionWorkspacePage` 的网格列定义，让画布列可收缩并保留固定宽度的 AI 面板。两项改动均属于 Frontend，不修改业务数据或 AI 编排边界。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、Vitest、Testing Library、tiptap-pagination-plus 3.1.0

---

### Task 1: 修正分页目标位置

**Files:**
- Modify: `apps/web/src/features/revision/DraftCanvas.test.tsx`
- Modify: `apps/web/src/features/revision/DraftCanvas.tsx:219-248`

- [ ] **Step 1: 将测试分页 DOM 改成真实的页尾断点几何**

在 `DraftCanvas.test.tsx` 的 `.page` 几何 mock 中，让第一个 `.page` 位于第一页内容末尾：

```tsx
if (this.classList.contains("page")) {
  const pageIndex = Number.parseInt(this.dataset.pageIndex ?? "0", 10) || 0
  const scrollTop = document.querySelector<HTMLElement>(".td-editor-print-wrapper")?.scrollTop ?? 0
  return rect({
    left: 80,
    top: paginationTop
      + (pageIndex + 1) * paginationPageSize.height
      + pageIndex * 28
      - scrollTop,
    ...paginationPageSize,
  })
}
```

- [ ] **Step 2: 补充分页回归断言**

在现有“渲染外部分页器并跳页”测试中先跳到第三页，再点击第一页，断言滚动回顶部：

```tsx
fireEvent.click(screen.getByTestId("source-page-navigator-page-3"))
expect(screen.getByTestId("mock-editor-print-wrapper")).toHaveProperty("scrollTop", 2258)

fireEvent.click(screen.getByTestId("source-page-navigator-page-1"))
expect(screen.getByTestId("mock-editor-print-wrapper")).toHaveProperty("scrollTop", 0)
expect(screen.getByTestId("source-page-navigator-page-1")).toHaveAttribute("aria-current", "page")
```

- [ ] **Step 3: 运行测试并确认 RED**

Run:

```powershell
pnpm --filter @typedance/web exec vitest run src/features/revision/DraftCanvas.test.tsx
```

Expected: 分页测试失败；旧实现将第一页目标取为第一个页尾断点，`scrollTop` 不为 `0`。

- [ ] **Step 4: 实现统一页面顶部数组**

在 `getPageNavigationState` 中获取分页编辑器顶部，并将页面位置映射为“编辑器顶部 + 除最后一个以外的页尾断点”：

```tsx
const paginatedEditor = root.querySelector<HTMLElement>(".rm-with-pagination")
const pageBreakElements = Array.from(root.querySelectorAll<HTMLElement>(".rm-with-pagination .page"))
if (!printWrapper || !paginatedEditor || pageBreakElements.length === 0) {
  return { currentPageIndex: 0, pageTops: [] }
}

const wrapperRect = printWrapper.getBoundingClientRect()
const toWrapperScrollTop = (element: HTMLElement) => (
  printWrapper.scrollTop
  + element.getBoundingClientRect().top
  - wrapperRect.top
)
const pageTops = [
  toWrapperScrollTop(paginatedEditor),
  ...pageBreakElements.slice(0, -1).map(toWrapperScrollTop),
].filter((top) => Number.isFinite(top))
```

保持现有当前页判断、滚动偏移和分页器渲染逻辑不变。

- [ ] **Step 5: 运行测试并确认 GREEN**

Run:

```powershell
pnpm --filter @typedance/web exec vitest run src/features/revision/DraftCanvas.test.tsx
```

Expected: `DraftCanvas.test.tsx` 全部通过。

### Task 2: 保证右侧 AI 面板完整显示

**Files:**
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx:506-513`

- [ ] **Step 1: 添加可收缩画布列测试**

在加载工作台的测试中读取网格类名，要求打开 AI 面板时第一列为 `minmax(0,1fr)`：

```tsx
const workspaceGrid = await screen.findByTestId("revision-workspace-grid")
expect(workspaceGrid).toHaveClass("grid-cols-[minmax(0,1fr)_24rem]")
expect(workspaceGrid).not.toHaveClass("grid-cols-[minmax(48rem,1fr)_24rem]")
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
pnpm --filter @typedance/web exec vitest run src/features/revision/RevisionWorkspacePage.test.tsx
```

Expected: 新断言失败，实际类名仍为 `grid-cols-[minmax(48rem,1fr)_24rem]`。

- [ ] **Step 3: 允许画布列收缩**

将 `RevisionWorkspacePage.tsx` 中 AI 面板打开时的列定义改为：

```tsx
assistantPanelVisible
  ? "grid-cols-[minmax(0,1fr)_24rem]"
  : "grid-cols-[minmax(0,1fr)]"
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run:

```powershell
pnpm --filter @typedance/web exec vitest run src/features/revision/RevisionWorkspacePage.test.tsx
```

Expected: `RevisionWorkspacePage.test.tsx` 全部通过。

### Task 3: 回归验证

**Files:**
- Verify: `apps/web/src/features/revision/DraftCanvas.test.tsx`
- Verify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
- Verify: `apps/web/src/features/revision/AgentChatPanel.test.tsx`

- [ ] **Step 1: 运行关联测试**

Run:

```powershell
pnpm --filter @typedance/web exec vitest run src/features/revision/DraftCanvas.test.tsx src/features/revision/RevisionWorkspacePage.test.tsx src/features/revision/AgentChatPanel.test.tsx
```

Expected: 三个测试文件全部通过。

- [ ] **Step 2: 构建 Web 应用**

Run:

```powershell
pnpm --filter @typedance/web build
```

Expected: 构建成功；允许已有的 Vite chunk-size warning，不允许新增 TypeScript 或构建错误。

- [ ] **Step 3: 检查变更边界**

Run:

```powershell
git diff --check
git status --short
```

Expected: 无空白错误；实现变更只涉及两个组件及对应测试，保留用户原有未提交修改。
