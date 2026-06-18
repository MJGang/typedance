# 简历修订工作台标题栏与工具栏精简 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除重复标题栏，把可改名工作区标题与返回入口归入左侧导航，并把纯图标导出菜单放入编辑器顶部工具栏。

**Architecture:** `RevisionWorkspacePage` 保留标题保存和导出业务状态；`WorkbenchSidebar` 通过受控属性渲染标题编辑与返回交互；`DraftCanvas` 和 `ResumeRichTextEditor` 只透传通用 `toolbarEnd` 插槽。标题长度使用 `Array.from` 按 Unicode 字符序列限制为 10。

**Tech Stack:** React 19、TypeScript、React Router、shadcn/ui、Lucide、Vitest、Testing Library、Tailwind CSS

---

### Task 1: 用测试固定新布局与标题约束

**Files:**
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
- Modify: `apps/web/src/features/revision/WorkbenchSidebar.test.tsx`
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`

- [ ] **Step 1: 写失败的页面集成测试**

把现有标题编辑和导出用例改为断言：独立标题栏不存在；左侧标题按钮可编辑；输入显示 `0/10` 到 `10/10`；11 字符输入被截为 10 字符；返回按钮导航到工作区列表；导出按钮位于 `role="toolbar"` 内且只通过 `aria-label="导出"` 呈现。

```tsx
expect(screen.queryByTestId("revision-workspace-header")).not.toBeInTheDocument()
const toolbar = screen.getByRole("toolbar", { name: "简历格式工具栏" })
expect(within(toolbar).getByRole("button", { name: "导出" })).toBeInTheDocument()
fireEvent.change(screen.getByLabelText("工作区标题"), { target: { value: "一二三四五六七八九十十一" } })
expect(screen.getByText("10/10")).toBeInTheDocument()
```

- [ ] **Step 2: 写失败的组件边界测试**

验证 `WorkbenchSidebar` 调用 `onStartTitleEditing`、`onTitleDraftChange`、`onCommitTitleEditing`、`onCancelTitleEditing` 与 `onBack`；验证 `ResumeRichTextEditor` 在工具栏末尾渲染 `toolbarEnd`。

```tsx
renderEditor({ toolbarEnd: <button type="button">尾部操作</button> })
expect(within(screen.getByRole("toolbar")).getByRole("button", { name: "尾部操作" })).toBeInTheDocument()
```

- [ ] **Step 3: 运行测试并确认红灯**

Run: `rtk vitest run apps/web/src/features/revision/RevisionWorkspacePage.test.tsx apps/web/src/features/revision/WorkbenchSidebar.test.tsx apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`

Expected: FAIL，原因是新属性、工具栏插槽和新布局尚未实现。

### Task 2: 实现受控侧栏标题编辑与返回入口

**Files:**
- Modify: `apps/web/src/features/revision/WorkbenchSidebar.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`

- [ ] **Step 1: 扩展侧栏受控属性**

新增 `editingTitle`、`titleDraft`、`titleSaveError`、`isSavingTitle`、`onStartTitleEditing`、`onTitleDraftChange`、`onCommitTitleEditing`、`onCancelTitleEditing` 和 `onBack`。标题展示态使用 shadcn `Button` 与 `Pencil`，编辑态使用 `Input`，右端使用 `ArrowLeft` 图标按钮。

```tsx
<Input
  ref={titleInputRef}
  aria-label="工作区标题"
  value={titleDraft}
  maxLength={10}
  onChange={(event) => onTitleDraftChange(Array.from(event.target.value).slice(0, 10).join(""))}
/>
<span aria-live="polite">{Array.from(titleDraft).length}/10</span>
```

- [ ] **Step 2: 在页面提交层执行 10 字符约束**

提取 `limitWorkspaceTitle(value)`，在输入回调与 `commitTitleEditing` 中统一使用，确保粘贴与程序赋值都不能绕过限制。

```ts
const WORKSPACE_TITLE_MAX_LENGTH = 10
function limitWorkspaceTitle(value: string) {
  return Array.from(value).slice(0, WORKSPACE_TITLE_MAX_LENGTH).join("")
}
```

- [ ] **Step 3: 删除独立工作区标题栏并接线侧栏**

删除 `revision-workspace-header`，将标题状态和 `navigate(resumePackPaths.workspaces)` 回调传给 `WorkbenchSidebar`，保留现有保存错误恢复与成功后状态同步。

- [ ] **Step 4: 运行侧栏与页面测试**

Run: `rtk vitest run apps/web/src/features/revision/WorkbenchSidebar.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`

Expected: PASS。

### Task 3: 注入纯图标导出菜单到富文本工具栏

**Files:**
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`
- Modify: `apps/web/src/features/revision/DraftCanvas.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`

- [ ] **Step 1: 增加通用工具栏尾部插槽**

在 `ResumeRichTextEditorProps` 和 `DraftCanvasProps` 中增加 `toolbarEnd?: ReactNode`，由 `DraftCanvas` 原样传给编辑器。编辑器使用 `ml-auto` 容器将插槽稳定放在工具栏右端。

```tsx
{toolbarEnd ? <div className="ml-auto flex shrink-0 items-center">{toolbarEnd}</div> : null}
```

- [ ] **Step 2: 页面构造导出图标菜单**

使用 shadcn `DropdownMenu`、`Tooltip` 和 `Button size="icon-sm" variant="ghost"`。按钮只显示 `Download` 或旋转的 `Loader2`，菜单保留 PDF/HTML 两项并调用现有 `handleExport`。

```tsx
<Button type="button" variant="ghost" size="icon-sm" aria-label="导出" disabled={exportDisabled}>
  {exportingFormat ? <Loader2 className="animate-spin" /> : <Download />}
</Button>
```

- [ ] **Step 3: 运行工具栏与导出测试**

Run: `rtk vitest run apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx apps/web/src/features/revision/DraftCanvas.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`

Expected: PASS，且导出 API 仍接收当前画布、页边距与模板样式。

### Task 4: 完整验证、提交与推送

**Files:**
- Verify: `apps/web/src/features/revision/*`
- Verify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`

- [ ] **Step 1: 运行 shadcn 项目信息检查**

Run: `pnpm dlx shadcn@latest info --json`

Expected: `style` 为 `radix-maia`，现有组件清单可读取。

- [ ] **Step 2: 运行 Web 测试和构建**

Run: `rtk pnpm --filter @typedance/web test`

Expected: PASS。

Run: `rtk pnpm --filter @typedance/web build`

Expected: PASS。

- [ ] **Step 3: 启动页面并做可见界面验证**

在真实页面确认：左侧标题可编辑且显示 `x/10`；返回按钮在标题行右端；重复标题栏消失；下载图标位于格式工具栏右端；PDF/HTML 菜单和加载态正常；无横向或纵向布局回归。

- [ ] **Step 4: 检查差异并提交**

```bash
rtk git diff
git add apps/web/src/features/revision apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx docs/superpowers/plans/2026-06-18-revision-workbench-toolbar-and-sidebar.md
git commit -m "feat(workbench): 精简标题栏并统一导出入口"
```

- [ ] **Step 5: 推送当前分支**

Run: `git push`

Expected: 当前分支成功推送到已配置远端。
