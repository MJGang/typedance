# 编辑器辅助控件显隐与全文复制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让旧简历重构工作台默认隐藏低频样式辅助控件，并提供格式工具栏、大纲、分页器的按需开关以及纯文本全文复制。

**Architecture:** `RevisionWorkspacePage` 负责标题栏操作和格式工具栏显隐，`DraftCanvas` 负责大纲与分页器的会话内状态，`ResumeRichTextEditor` 只按受控属性渲染工具栏按钮。显隐状态不进入本地存储；复制直接读取当前本地画布 `doc_json` 并通过既有纯文本转换函数写入剪贴板。

**Tech Stack:** React 19、TypeScript、TipTap、shadcn/ui、Tailwind CSS、Vitest、Testing Library。

---

## 文件结构

- 修改 `apps/web/src/components/editor-toolbar.tsx`：为有受控激活状态的工具栏按钮补充 `aria-pressed`。
- 修改 `apps/web/src/components/editor-toolbar.test.tsx`：覆盖工具栏切换按钮的可访问状态。
- 修改 `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`：支持隐藏整条格式工具栏，并增加分页器按钮。
- 修改 `apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`：覆盖工具栏显隐和分页器按钮。
- 修改 `apps/web/src/features/revision/DraftCanvas.tsx`：管理大纲、分页器的非持久化状态并传递格式工具栏显隐属性。
- 修改 `apps/web/src/features/revision/DraftCanvas.test.tsx`：覆盖默认隐藏、按需显示和跨文档重置。
- 修改 `apps/web/src/features/revision/moduleInteractions.ts`：删除已废弃的大纲显隐/展开持久化实现，只保留布局计算。
- 修改 `apps/web/src/features/revision/RevisionWorkspacePage.tsx`：增加复制按钮和格式工具栏开关。
- 修改 `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`：覆盖标题栏按钮、复制和文档切换重置。

### Task 1：建立受控格式工具栏和分页器按钮

**Files:**

- Modify: `apps/web/src/components/editor-toolbar.tsx`
- Modify: `apps/web/src/components/editor-toolbar.test.tsx`
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`

- [ ] **Step 1：先写失败测试**

在 `editor-toolbar.test.tsx` 中增加断言：传入 `isActive` 的 `ToolbarIconButton` 使用 `aria-pressed`，未传 `isActive` 的普通动作按钮不产生该属性。

在 `ResumeRichTextEditor.toolbar.test.tsx` 中增加：

```tsx
it("keeps the editor mounted while the format toolbar is hidden", () => {
  render(
    <TooltipProvider>
      <ResumeRichTextEditor
        ariaLabel="Resume text"
        docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }}
        toolbarVisible={false}
        onChange={() => {}}
      />
    </TooltipProvider>,
  )

  expect(screen.queryByRole("toolbar", { name: "简历格式工具栏" })).not.toBeInTheDocument()
  expect(screen.getByLabelText("Resume text")).toBeInTheDocument()
})

it("toggles the page navigator from the format toolbar", () => {
  const onPageNavigatorVisibleChange = vi.fn()
  render(
    <TooltipProvider>
      <ResumeRichTextEditor
        ariaLabel="Resume text"
        docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }}
        pageNavigatorVisible={false}
        onPageNavigatorVisibleChange={onPageNavigatorVisibleChange}
        onChange={() => {}}
      />
    </TooltipProvider>,
  )

  const button = screen.getByRole("button", { name: "分页器" })
  expect(button).toHaveAttribute("aria-pressed", "false")
  fireEvent.click(button)
  expect(onPageNavigatorVisibleChange).toHaveBeenCalledWith(true)
})
```

- [ ] **Step 2：运行测试并确认按预期失败**

Run:

```powershell
rtk corepack.cmd pnpm --filter @typedance/web test editor-toolbar.test.tsx ResumeRichTextEditor.toolbar.test.tsx
```

Expected: FAIL，提示 `toolbarVisible` / `pageNavigatorVisible` 尚未支持，或分页器按钮不存在。

- [ ] **Step 3：实现最小功能**

在 `ToolbarIconButton` 中保留 `isActive` 的 `undefined` 语义：

```tsx
export function ToolbarIconButton({
  label,
  icon: Icon,
  isActive,
  disabled = false,
  onClick,
  className,
}: ToolbarIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={isActive}
          data-active={isActive || undefined}
          disabled={disabled}
          className={cn("td-editor-toolbar-button", className)}
          onClick={onClick}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
```

为 `ResumeRichTextEditorProps` 增加：

```tsx
toolbarVisible?: boolean
pageNavigatorVisible?: boolean
onPageNavigatorVisibleChange?: (visible: boolean) => void
```

默认 `toolbarVisible = true`，避免影响模板详情等其他调用方。将现有工具栏条件改为：

```tsx
{editable && toolbarVisible ? (
  <EditorToolbar>
    {/* 现有工具 */}
  </EditorToolbar>
) : null}
```

在大纲按钮附近增加分页器按钮，使用 `Files` 图标：

```tsx
{onPageNavigatorVisibleChange ? (
  <>
    <ToolbarVerticalSeparator />
    <ToolbarGroup>
      <ToolbarIconButton
        label="分页器"
        icon={Files}
        isActive={pageNavigatorVisible}
        onClick={() => onPageNavigatorVisibleChange(!pageNavigatorVisible)}
      />
    </ToolbarGroup>
  </>
) : null}
```

- [ ] **Step 4：运行测试并确认通过**

Run:

```powershell
rtk corepack.cmd pnpm --filter @typedance/web test editor-toolbar.test.tsx ResumeRichTextEditor.toolbar.test.tsx
```

Expected: PASS。

- [ ] **Step 5：提交本任务**

```powershell
rtk git add apps/web/src/components/editor-toolbar.tsx apps/web/src/components/editor-toolbar.test.tsx apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx
rtk git commit -m "feat(editor): 支持按需显示格式工具栏和分页器"
```

### Task 2：让大纲与分页器每次进入都默认隐藏

**Files:**

- Modify: `apps/web/src/features/revision/DraftCanvas.tsx`
- Modify: `apps/web/src/features/revision/DraftCanvas.test.tsx`
- Modify: `apps/web/src/features/revision/moduleInteractions.ts`

- [ ] **Step 1：先写失败测试**

扩展 `MockEditorProps`：

```tsx
toolbarVisible?: boolean
pageNavigatorVisible?: boolean
onPageNavigatorVisibleChange?: (visible: boolean) => void
```

新增测试：

```tsx
it("starts with the outline and page navigator hidden", () => {
  editorMocks.pageCount = 3
  render(<DraftCanvas canvas={canvas} toolbarVisible onChange={vi.fn()} saveStatus="idle" />)

  expect(editorMocks.props?.moduleOutlineVisible).toBe(false)
  expect(editorMocks.props?.pageNavigatorVisible).toBe(false)
  expect(screen.queryByLabelText("简历模块大纲")).not.toBeInTheDocument()
  expect(screen.queryByTestId("source-page-navigator")).not.toBeInTheDocument()
})

it("shows the page navigator only after its toolbar toggle is activated", async () => {
  editorMocks.pageCount = 3
  render(<DraftCanvas canvas={canvas} toolbarVisible onChange={vi.fn()} saveStatus="idle" />)

  act(() => editorMocks.props?.onPageNavigatorVisibleChange?.(true))
  expect(await screen.findByTestId("source-page-navigator")).toBeInTheDocument()
})
```

把依赖默认大纲可见的现有测试改为显式调用：

```tsx
function showModuleOutline() {
  act(() => editorMocks.props?.onModuleOutlineVisibleChange?.(true))
}
```

删除“恢复大纲显隐偏好”和“按文档持久化显隐”的断言，改为验证即使 `localStorage` 残留旧值，新画布仍默认隐藏。

- [ ] **Step 2：运行测试并确认按预期失败**

Run:

```powershell
rtk corepack.cmd pnpm --filter @typedance/web test DraftCanvas.test.tsx
```

Expected: FAIL，当前大纲和分页器仍默认渲染。

- [ ] **Step 3：实现最小功能并删除旧持久化路径**

为 `DraftCanvasProps` 增加：

```tsx
toolbarVisible?: boolean
```

在 `DraftCanvasWorkspace` 中使用纯会话状态：

```tsx
const [outlineVisible, setOutlineVisible] = useState(false)
const [outlineExpanded, setOutlineExpanded] = useState(true)
const [pageNavigatorVisible, setPageNavigatorVisible] = useState(false)
```

删除 `loadModuleOutlinePreferences`、`saveModuleOutlinePreferences` 的调用和相关 effect。`moduleInteractions.ts` 同步删除 `PersistedModuleOutlinePreferences`、`moduleOutlineStorageKey`、`loadModuleOutlinePreferences`、`saveModuleOutlinePreferences`，不保留旧字段或运行时兼容分支。

将状态传给编辑器：

```tsx
<ResumeRichTextEditor
  toolbarVisible={toolbarVisible}
  moduleOutlineVisible={outlineVisible}
  onModuleOutlineVisibleChange={setOutlineVisible}
  pageNavigatorVisible={pageNavigatorVisible}
  onPageNavigatorVisibleChange={setPageNavigatorVisible}
  {...existingProps}
/>
```

分页器改为：

```tsx
{pageNavigatorVisible && pageBounds ? (
  <SourceCanvasPageNavigator
    currentPageIndex={pageNavigationState.currentPageIndex}
    left={pageNavigatorLeft}
    maxHeight={outlineMaxHeight}
    pageCount={pageNavigationState.pageTops.length}
    top={outlineTop}
    onJumpToPage={scrollToPage}
  />
) : null}
```

- [ ] **Step 4：运行测试并确认通过**

Run:

```powershell
rtk corepack.cmd pnpm --filter @typedance/web test DraftCanvas.test.tsx
```

Expected: PASS。

- [ ] **Step 5：提交本任务**

```powershell
rtk git add apps/web/src/features/revision/DraftCanvas.tsx apps/web/src/features/revision/DraftCanvas.test.tsx apps/web/src/features/revision/moduleInteractions.ts
rtk git commit -m "feat(canvas): 默认隐藏大纲和分页器"
```

### Task 3：增加标题栏复制与格式工具栏开关

**Files:**

- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`

- [ ] **Step 1：先写失败测试**

让 `DraftCanvas` mock 接收 `toolbarVisible`，并只在它为真时渲染模拟工具栏。为 `navigator.clipboard.writeText` 和 `sonner` toast 建立可复位 mock。

新增测试：

```tsx
it("keeps the format toolbar hidden by default and resets it after switching workspaces", async () => {
  renderPage()
  const titlebar = await screen.findByTestId("revision-workspace-titlebar")
  const toggle = within(titlebar).getByRole("button", { name: "显示格式工具栏" })

  expect(toggle).toHaveAttribute("aria-pressed", "false")
  expect(screen.queryByRole("toolbar", { name: "简历格式工具栏" })).not.toBeInTheDocument()

  fireEvent.click(toggle)
  expect(within(titlebar).getByRole("button", { name: "隐藏格式工具栏" })).toHaveAttribute("aria-pressed", "true")
  expect(screen.getByRole("toolbar", { name: "简历格式工具栏" })).toBeInTheDocument()

  fireEvent.click(screen.getByText("切换工作区"))
  const nextTitlebar = await screen.findByTestId("revision-workspace-titlebar")
  await waitFor(() => {
    expect(within(nextTitlebar).getByRole("button", { name: "显示格式工具栏" })).toHaveAttribute("aria-pressed", "false")
  })
})

it("copies the latest complete resume as plain text", async () => {
  renderPage()
  const titlebar = await screen.findByTestId("revision-workspace-titlebar")

  fireEvent.click(within(titlebar).getByRole("button", { name: "复制简历全文" }))
  await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith("Original canvas text"))

  fireEvent.click(screen.getByRole("button", { name: "编辑画布" }))
  fireEvent.click(within(titlebar).getByRole("button", { name: "复制简历全文" }))
  await waitFor(() => expect(clipboardWriteText).toHaveBeenLastCalledWith("Updated canvas text"))
})
```

再增加空文档和剪贴板拒绝时的 toast 断言。

- [ ] **Step 2：运行测试并确认按预期失败**

Run:

```powershell
rtk corepack.cmd pnpm --filter @typedance/web test RevisionWorkspacePage.test.tsx
```

Expected: FAIL，标题栏按钮和 `toolbarVisible` 尚不存在。

- [ ] **Step 3：实现最小功能**

在 `RevisionWorkspacePage` 中增加：

```tsx
const [editorToolbarVisible, setEditorToolbarVisible] = useState(false)
```

在现有 `[documentId]` 重置 effect 内调用：

```tsx
setEditorToolbarVisible(false)
```

使用当前本地画布内容复制：

```tsx
const handleCopyResume = useCallback(async () => {
  if (!sourceCanvas) return
  const plainText = resumeDocToPlainText(sourceCanvas.doc_json as Record<string, unknown>)
  if (!plainText) {
    toast.error("暂无可复制的简历内容")
    return
  }

  try {
    await navigator.clipboard.writeText(plainText)
    toast.success("已复制简历全文")
  } catch {
    toast.error("复制失败，请稍后重试")
  }
}, [sourceCanvas])
```

标题栏操作区在模板选择器后增加使用现有 `Button` 和 `Tooltip` 的按钮：

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="复制简历全文" onClick={() => void handleCopyResume()}>
      <Copy />
    </Button>
  </TooltipTrigger>
  <TooltipContent>复制简历全文</TooltipContent>
</Tooltip>
<Tooltip>
  <TooltipTrigger asChild>
    <Button
      type="button"
      variant={editorToolbarVisible ? "secondary" : "ghost"}
      size="icon-sm"
      aria-label={editorToolbarVisible ? "隐藏格式工具栏" : "显示格式工具栏"}
      aria-pressed={editorToolbarVisible}
      onClick={() => setEditorToolbarVisible((visible) => !visible)}
    >
      <Paintbrush />
    </Button>
  </TooltipTrigger>
  <TooltipContent>{editorToolbarVisible ? "隐藏格式工具栏" : "显示格式工具栏"}</TooltipContent>
</Tooltip>
```

传给画布：

```tsx
<DraftCanvas
  toolbarVisible={editorToolbarVisible}
  {...existingProps}
/>
```

- [ ] **Step 4：运行测试并确认通过**

Run:

```powershell
rtk corepack.cmd pnpm --filter @typedance/web test RevisionWorkspacePage.test.tsx
```

Expected: PASS。

- [ ] **Step 5：提交本任务**

```powershell
rtk git add apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
rtk git commit -m "feat(workbench): 增加简历复制与格式工具栏开关"
```

### Task 4：完整验证与交付检查

**Files:**

- Verify: all files modified above

- [ ] **Step 1：运行定向测试**

```powershell
rtk corepack.cmd pnpm --filter @typedance/web test editor-toolbar.test.tsx ResumeRichTextEditor.toolbar.test.tsx DraftCanvas.test.tsx RevisionWorkspacePage.test.tsx
```

Expected: 所有定向测试通过，无新增错误或警告。

- [ ] **Step 2：运行 Web 全量测试**

```powershell
rtk corepack.cmd pnpm --filter @typedance/web test
```

Expected: 全部测试通过。

- [ ] **Step 3：运行生产构建**

```powershell
rtk corepack.cmd pnpm --filter @typedance/web build
```

Expected: exit code 0；允许既有 Vite chunk-size 提示，不允许新增 TypeScript 或构建错误。

- [ ] **Step 4：检查 shadcn 配置与差异**

本次只组合已有 `Button`、`Tooltip`，不修改 `apps/web/src/components/ui/*`，因此不运行 shadcn overwrite。确认：

```powershell
rtk corepack.cmd pnpm dlx shadcn@latest info --json
rtk git diff --check
rtk git status --short
```

Expected: `style` 仍为 `radix-maia`；diff check 通过；工作区只包含计划内文件。

- [ ] **Step 5：最终需求核对**

- 标题栏包含复制和格式工具栏按钮。
- 工具栏默认隐藏且激活态正确。
- 大纲默认隐藏。
- 分页器默认隐藏，可从工具栏开启。
- 复制内容为当前完整纯文本。
- 刷新或切换文档后所有低频辅助控件恢复隐藏。
