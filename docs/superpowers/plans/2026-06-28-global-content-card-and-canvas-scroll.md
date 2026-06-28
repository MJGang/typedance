# 全局内容卡片与画布横向滚动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有页面位于当前左侧导航右边的主内容区呈现为四角圆角且带 4px 右/底留白的内容卡片，并让窄工作台中的左侧画布可以横向滚动。

**Architecture:** 普通页面由 `SiteLayout` 的 `SidebarInset` 承担内容卡片；工作台左侧导航位于 `SidebarInset` 内部，因此由导航之后的 `revision-workspace-grid` 承担同一视觉规则。横向滚动限制在 `revision-draft-panel`，保留编辑器内部纵向滚动和固定的 AI 面板。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、Vitest、Testing Library、Playwright CLI

---

### Task 1: 全局内容卡片

**Files:**
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/SiteLayout.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`

- [ ] **Step 1: 编写失败测试**

在普通路由上断言 `SidebarInset` 拥有：

```tsx
expect(contentInset).toHaveClass(
  "mt-9",
  "mr-1",
  "mb-1",
  "h-[calc(100svh-2.25rem-4px)]",
  "rounded-xl",
  "border",
  "border-border",
)
```

在工作台路由上断言 `SidebarInset` 保持 `h-svh pt-9` 且不绘制卡片；同时断言 `revision-workspace-grid` 拥有 `mr-1 mb-1 rounded-xl border border-border`。

- [ ] **Step 2: 运行 RED**

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/App.test.tsx src/features/revision/RevisionWorkspacePage.test.tsx
```

Expected: 普通页面仍为 2px 间距，工作台卡片外框仍错误地包住左侧导航，测试失败。

- [ ] **Step 3: 实施全局外壳**

`SidebarProvider` 保持 `bg-sidebar`。普通页面的 `SidebarInset` 使用：

```tsx
className="mt-9 mr-1 mb-1 h-[calc(100svh-2.25rem-4px)] min-h-0 min-w-0 overflow-hidden rounded-xl border border-border"
```

工作台 `SidebarInset` 使用 `h-svh pt-9`，并将 `mr-1 mb-1 rounded-xl border border-border` 放到 `RevisionWorkspacePage` 网格上。

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

在 1080px 视口检查卡片右/底各 4px、全圆角、卡片左边界位于工作台左侧导航之后、画布 `scrollWidth > clientWidth`、`overflow-x: auto`，并确认改变画布 `scrollLeft` 不改变 AI 面板边界。

- [ ] **Step 4: 提交限定文件**

仅暂存本计划涉及的组件、测试，以及本次与前序画布修复产生的文档和代码，提交：

```powershell
git commit -m "fix(workbench): 完善全局外框与画布滚动"
```
