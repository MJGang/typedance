# 全局内容卡片与画布横向滚动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有页面共享四角圆角且带 2px 右/底留白的内容卡片，并让窄工作台中的左侧画布可以横向滚动。

**Architecture:** `SiteLayout` 统一拥有应用级内容卡片；`RevisionWorkspacePage` 只负责内部两列网格。横向滚动限制在 `revision-draft-panel`，保留编辑器内部纵向滚动和固定的 AI 面板。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、Vitest、Testing Library、Playwright CLI

---

### Task 1: 全局内容卡片

**Files:**
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/SiteLayout.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`

- [ ] **Step 1: 编写失败测试**

在普通路由和工作台路由上断言 `SidebarInset` 同时拥有：

```tsx
expect(contentInset).toHaveClass(
  "mt-9",
  "mr-0.5",
  "mb-0.5",
  "h-[calc(100svh-2.25rem-2px)]",
  "rounded-xl",
  "border",
  "border-border",
)
```

同时断言工作台 `revision-workspace-grid` 不再拥有 `rounded-l-xl` 和 `border`。

- [ ] **Step 2: 运行 RED**

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/App.test.tsx src/features/revision/RevisionWorkspacePage.test.tsx
```

Expected: 现有工作台仍使用 `pt-9 h-svh`，页面网格仍持有边框，测试失败。

- [ ] **Step 3: 实施全局外壳**

`SidebarProvider` 增加 `bg-sidebar`。`SidebarInset` 统一使用：

```tsx
className="mt-9 mr-0.5 mb-0.5 h-[calc(100svh-2.25rem-2px)] min-h-0 min-w-0 overflow-hidden rounded-xl border border-border"
```

移除 `RevisionWorkspacePage` 网格上的 `rounded-l-xl border border-border`。

- [ ] **Step 4: 运行 GREEN**

重复 Step 2 命令，Expected: 两个测试文件全部通过。

### Task 2: 画布横向滚动

**Files:**
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`

- [ ] **Step 1: 编写失败测试**

```tsx
const draftPanel = await screen.findByTestId("revision-draft-panel")
expect(draftPanel).toHaveClass("overflow-x-auto", "overflow-y-hidden")
expect(draftPanel).not.toHaveClass("overflow-hidden")
```

- [ ] **Step 2: 运行 RED**

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/features/revision/RevisionWorkspacePage.test.tsx
```

Expected: 画布列仍为 `overflow-hidden`，测试失败。

- [ ] **Step 3: 实施横向滚动**

将 `revision-draft-panel` 的 `overflow-hidden` 替换为：

```tsx
overflow-x-auto overflow-y-hidden overscroll-x-contain
```

- [ ] **Step 4: 运行 GREEN**

重复 Step 2 命令，Expected: `RevisionWorkspacePage.test.tsx` 全部通过。

### Task 3: 完整验证与提交

**Files:**
- Verify: `apps/web/src`

- [ ] **Step 1: 运行 Web 全量测试**

```powershell
corepack pnpm --filter @typedance/web test
```

Expected: 全部测试通过。

- [ ] **Step 2: 运行生产构建**

```powershell
corepack pnpm --filter @typedance/web build
```

Expected: 构建成功，仅允许已有 chunk-size warning。

- [ ] **Step 3: 浏览器验证**

在 1080px 视口检查卡片右/底各 2px、全圆角、画布 `scrollWidth > clientWidth`、`overflow-x: auto`，并确认改变画布 `scrollLeft` 不改变 AI 面板边界。

- [ ] **Step 4: 提交限定文件**

仅暂存本计划涉及的组件、测试，以及本次与前序画布修复产生的文档和代码，提交：

```powershell
git commit -m "fix(workbench): 完善全局外框与画布滚动"
```
