# 编辑器顶部工具栏 Tooltip 延迟实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让编辑器顶部工具栏 Tooltip 在持续悬停 500ms 后显示，同时保持全站其他 Tooltip 的现有行为。

**Architecture:** 在 `ResumeRichTextEditor` 的工具栏节点内增加最近作用域的 `TooltipProvider`，通过 Radix 上下文覆盖站点级 `0ms` 默认值。改动只位于 Frontend，不修改通用 shadcn Tooltip 源码，也不触及 Harness、Agent Host 或 Sidecar。

**Tech Stack:** React 19、Radix UI Tooltip、shadcn/ui、Vitest、Testing Library

---

### Task 1: 锁定并实现工具栏局部延迟

**Files:**
- Create: `apps/web/src/components/editor-toolbar.test.tsx`
- Modify: `apps/web/src/components/editor-toolbar.tsx`
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`

- [ ] **Step 1: 写入失败测试**

在独立工具栏测试中启用 fake timers，渲染外层 `delayDuration={0}` 的 Provider 和 `EditorToolbar`，向“加粗”按钮派发 `pointerMove`，断言 499ms 时提示未出现，推进到 500ms 后提示出现，并在 `finally` 中恢复真实计时器。测试提供最小 `ResizeObserver` mock，避免加载 TipTap 编辑器。

```tsx
it("delays toolbar tooltips without inheriting the instant site default", async () => {
  vi.useFakeTimers()
  const view = render(
    <TooltipProvider delayDuration={0}>
      <EditorToolbar>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">加粗</button>
          </TooltipTrigger>
          <TooltipContent>加粗</TooltipContent>
        </Tooltip>
      </EditorToolbar>
    </TooltipProvider>,
  )

  try {
    fireEvent.pointerMove(screen.getByRole("button", { name: "加粗" }), { pointerType: "mouse" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(499)
    })
    expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent("加粗")
  } finally {
    view.unmount()
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/components/editor-toolbar.test.tsx`

Expected: 测试因 `EditorToolbar` 尚未导出而失败，证明新增工具栏作用域尚未实现。

- [ ] **Step 3: 写入最小实现**

在 `editor-toolbar.tsx` 中让 `EditorToolbar` 同时提供工具栏语义与固定延迟作用域，并用它替换原有工具栏容器：

```tsx
export function EditorToolbar({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={500}>
      <div className="td-rich-editor-toolbar" role="toolbar" aria-label="简历格式工具栏">
        {children}
      </div>
    </TooltipProvider>
  )
}

<EditorToolbar>{/* 现有工具栏内容保持不变 */}</EditorToolbar>
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm exec vitest run src/components/editor-toolbar.test.tsx src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`

Expected: 工具栏测试全部通过，新增测试在 499ms 前无 Tooltip、500ms 时存在 Tooltip。

- [ ] **Step 5: 完整验证**

Run: `rtk pnpm --filter @typedance/web build`

Expected: TypeScript 与 Vite 构建退出码为 0。

- [ ] **Step 6: 检查并提交**

```powershell
rtk git diff --check
rtk git diff
git add docs/superpowers/specs/2026-06-18-editor-toolbar-tooltip-delay-design.md docs/superpowers/plans/2026-06-18-editor-toolbar-tooltip-delay.md apps/web/src/components/editor-toolbar.tsx apps/web/src/components/editor-toolbar.test.tsx apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx
git commit -m "fix(editor): 延迟显示顶部工具栏提示"
```

- [ ] **Step 7: 推送当前分支**

Run: `git push origin HEAD`

Expected: 当前分支及设计、实现提交成功推送到远端。
