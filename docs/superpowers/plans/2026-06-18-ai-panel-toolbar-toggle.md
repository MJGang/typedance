# AI 面板显示按钮工具栏整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复隐藏 AI 面板后“显示 AI 面板”与“导出”按钮重叠的问题。

**Architecture:** 由 `RevisionWorkspacePage` 按显隐状态组合 `DraftCanvas.toolbarEnd`，将恢复 AI 面板按钮与导出按钮放入同一 flex 操作组；删除主工作区中的绝对定位按钮。`DraftCanvas` 保持通用 ReactNode 插槽，不引入 AI 面板概念。

**Tech Stack:** React、TypeScript、Tailwind CSS、Vitest、Testing Library、shadcn/ui Button 与 Tooltip。

---

### Task 1: 将 AI 面板恢复入口纳入画布工具栏

**Files:**
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx:370-386`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx:391-420,471-505`

- [ ] **Step 1: 写入失败的回归测试**

在现有 `hides and restores the assistant panel from workbench controls` 测试中，隐藏面板后获取“简历格式工具栏”，断言“显示 AI 面板”和“导出”按钮都位于该工具栏内：

```tsx
const toolbar = screen.getByRole("toolbar", { name: "简历格式工具栏" })
const showAssistantButton = within(toolbar).getByRole("button", { name: "显示 AI 面板" })
expect(within(toolbar).getByRole("button", { name: "导出" })).toBeInTheDocument()
fireEvent.click(showAssistantButton)
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `pnpm --filter @typedance/web test -- RevisionWorkspacePage.test.tsx -t "hides and restores"`

Expected: FAIL，因为“显示 AI 面板”当前位于工具栏之外。

- [ ] **Step 3: 实现工具栏操作组**

在 `RevisionWorkspacePage` 中创建 `toolbarEndActions`，隐藏 AI 面板时在导出按钮左侧渲染同规格的恢复按钮，并带 Tooltip：

```tsx
const toolbarEndActions = (
  <div className="flex items-center gap-1">
    {!assistantPanelVisible ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="显示 AI 面板"
            className="td-editor-toolbar-button"
            onClick={() => chromeContext?.setAssistantPanelVisible?.(true)}
          >
            <PanelRightOpen data-icon="inline-start" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>显示 AI 面板</TooltipContent>
      </Tooltip>
    ) : null}
    {exportToolbarAction}
  </div>
)
```

将 `DraftCanvas.toolbarEnd` 改为 `toolbarEndActions`，并删除 `<main>` 末尾绝对定位的恢复按钮分支，只在面板可见时渲染 `AgentChatPanel`。

- [ ] **Step 4: 运行目标测试并确认通过**

Run: `pnpm --filter @typedance/web test -- RevisionWorkspacePage.test.tsx -t "hides and restores"`

Expected: PASS。

- [ ] **Step 5: 运行完整相关测试与构建**

Run: `pnpm --filter @typedance/web test -- RevisionWorkspacePage.test.tsx DraftCanvas.test.tsx AgentChatPanel.test.tsx`

Run: `pnpm --filter @typedance/web build`

Expected: 所有测试通过，构建退出码为 0。

- [ ] **Step 6: 提交并推送**

```bash
git add docs/superpowers/plans/2026-06-18-ai-panel-toolbar-toggle.md apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
git commit -m "fix(workbench): 修复AI面板按钮与导出按钮重叠"
git push
```

