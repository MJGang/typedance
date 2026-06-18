# 对话标题与操作入口优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 AI 面板、对话列表与工作区标题的操作入口，并为删除对话增加二次确认。

**Architecture:** `RevisionWorkspacePage` 继续持有当前对话选择与对话快照，并协调 AI 面板发起的置顶、重命名操作；`WorkbenchSidebar` 维护列表行操作与删除确认。所有持久化继续调用现有 TS Agent Host API，Harness Core 与 Python Sidecar 不变。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、shadcn/ui（radix-maia）、Tailwind CSS、Lucide icons

---

## 文件结构

- 新增 `apps/web/src/components/ui/alert-dialog.tsx`：由 shadcn 官方 CLI 生成的删除确认组件。
- 修改 `apps/web/src/features/revision/AgentChatPanel.tsx`：渲染当前对话标题菜单并触发页面回调。
- 修改 `apps/web/src/features/revision/AgentChatPanel.test.tsx`：覆盖标题、空状态、置顶文案与重命名回调。
- 修改 `apps/web/src/features/revision/WorkbenchSidebar.tsx`：重排悬停操作、增加菜单和删除确认。
- 修改 `apps/web/src/features/revision/WorkbenchSidebar.test.tsx`：覆盖列表菜单、操作顺序、重命名与删除确认。
- 修改 `apps/web/src/features/revision/RevisionWorkspacePage.tsx`：协调当前对话操作并将工作区菜单替换为直接重命名按钮。
- 修改 `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`：覆盖页面级对话刷新和工作区标题按钮。

### Task 1: 对话列表操作与删除确认

**Files:**
- Create: `apps/web/src/components/ui/alert-dialog.tsx`
- Modify: `apps/web/src/features/revision/WorkbenchSidebar.tsx`
- Test: `apps/web/src/features/revision/WorkbenchSidebar.test.tsx`

- [ ] **Step 1: 写入列表操作失败测试**

新增测试，构造未置顶与已置顶对话，断言每行右侧 DOM 顺序为“对话操作”在“重命名对话”之前；时间贴齐右侧并在悬停时隐藏；已置顶状态和“置顶对话”使用实心图钉，“取消置顶对话”使用空心图钉；删除菜单项只打开确认框，不立即调用删除 API。

```tsx
const row = screen.getByRole("button", { name: "质量检查" }).closest("[data-conversation-row]")!
const actions = within(row).getAllByRole("button")
expect(actions.map((button) => button.getAttribute("aria-label"))).toEqual([
  "质量检查",
  "质量检查操作",
  "重命名质量检查",
])
fireEvent.click(within(row).getByRole("button", { name: "质量检查操作" }))
fireEvent.click(await screen.findByRole("menuitem", { name: "删除对话" }))
expect(agentHostMocks.deleteWorkspaceConversation).not.toHaveBeenCalled()
expect(await screen.findByRole("alertdialog")).toHaveTextContent("质量检查")
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `rtk pnpm --filter @typedance/web test -- WorkbenchSidebar.test.tsx`

Expected: FAIL，原因是列表仍显示直接置顶/删除按钮且没有 `alertdialog`。

- [ ] **Step 3: 通过官方 CLI 添加 AlertDialog**

Run: `pnpm dlx shadcn@latest add alert-dialog --dry-run -c apps/web`

Expected: 仅新增 `apps/web/src/components/ui/alert-dialog.tsx`，style 仍为 `radix-maia`。

Run: `pnpm dlx shadcn@latest add alert-dialog --yes -c apps/web`

- [ ] **Step 4: 实现列表行操作**

将 `ConversationRow` 改为使用 shadcn `DropdownMenu` 与 `Button`：

```tsx
<div data-conversation-row className="group flex h-8 items-center ...">
  <button aria-label={displayTitle} onClick={onSelect}>{displayTitle}</button>
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button aria-label={`${displayTitle}操作`} className="... group-hover:opacity-100">
        <MoreHorizontal />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuItem onSelect={togglePinned}>
        <Pin />
        {conversation.pinned ? "取消置顶对话" : "置顶对话"}
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onSelect={() => onRequestDelete(conversation)}>
        <Trash2 />
        删除对话
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  <Button aria-label={`重命名${displayTitle}`} onClick={onRename}><Pencil /></Button>
</div>
```

在侧栏根组件持有 `deletingConversation`，用受控 `AlertDialog` 确认后调用 `deleteWorkspaceConversation`，成功后关闭并 `loadConversations()`；失败时保留状态并显示 `toast.error("删除对话失败")`。

- [ ] **Step 5: 运行侧栏测试并确认通过**

Run: `rtk pnpm --filter @typedance/web test -- WorkbenchSidebar.test.tsx`

Expected: PASS。

### Task 2: AI 面板当前对话菜单

**Files:**
- Modify: `apps/web/src/features/revision/AgentChatPanel.tsx`
- Test: `apps/web/src/features/revision/AgentChatPanel.test.tsx`

- [ ] **Step 1: 写入面板标题失败测试**

为 `AgentChatPanel` 增加 `activeConversationPinned`、`onToggleConversationPinned`、`onRenameConversation` 测试：已选对话时菜单可用并触发回调；已置顶时显示“取消置顶对话”；未选时不显示“未选择对话”“新建或选择会话”和对话操作按钮。

```tsx
expect(screen.queryByText("未选择对话")).not.toBeInTheDocument()
expect(screen.queryByText("新建或选择会话")).not.toBeInTheDocument()
expect(screen.queryByRole("button", { name: "对话操作" })).not.toBeInTheDocument()
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `rtk pnpm --filter @typedance/web test -- AgentChatPanel.test.tsx`

Expected: FAIL，原因是当前存在占位标题和说明文字且无操作菜单。

- [ ] **Step 3: 实现条件标题与菜单**

扩展 props，并仅在 `activeConversationId` 存在时渲染标题和菜单：

```tsx
{activeConversationId ? (
  <div className="flex min-w-0 items-center gap-1">
    <p className="truncate text-sm font-semibold">{activeConversationTitle?.trim() || "当前对话"}</p>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="对话操作" variant="ghost" size="icon-xs"><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={onToggleConversationPinned}>
          <Pin />{activeConversationPinned ? "取消置顶对话" : "置顶对话"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRenameConversation}>
          <Pencil />重命名对话
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
) : <div />}
```

- [ ] **Step 4: 运行面板测试并确认通过**

Run: `rtk pnpm --filter @typedance/web test -- AgentChatPanel.test.tsx`

Expected: PASS。

### Task 3: 页面协调与工作区直接重命名按钮

**Files:**
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
- Test: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`

- [ ] **Step 1: 写入页面协调失败测试**

扩展 `@/agentHost` mock，断言 AI 面板菜单可置顶当前对话、重命名后刷新列表；工作区标题旁存在 `aria-label="重命名工作区"` 的直接按钮且不存在 `aria-label="工作区操作"` 的菜单按钮。

```tsx
fireEvent.click(screen.getByRole("button", { name: "对话操作" }))
fireEvent.click(await screen.findByRole("menuitem", { name: "置顶对话" }))
await waitFor(() => expect(agentHostMocks.updateWorkspaceConversation)
  .toHaveBeenCalledWith("conv_1", { pinned: true }))
expect(screen.getByRole("button", { name: "重命名工作区" })).toBeInTheDocument()
expect(screen.queryByRole("button", { name: "工作区操作" })).not.toBeInTheDocument()
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `rtk pnpm --filter @typedance/web test -- RevisionWorkspacePage.test.tsx`

Expected: FAIL，原因是页面未传入对话菜单回调且工作区仍使用下拉菜单。

- [ ] **Step 3: 实现页面级当前对话操作**

导入 `updateWorkspaceConversation`，派生完整的 `activeConversation`。置顶回调写入相反值后调用 `refreshConversations()`；重命名使用页面受控 Dialog，成功后关闭并刷新。将 AgentChatPanel props 改为：

```tsx
<AgentChatPanel
  activeConversationId={activeConversation?.id}
  activeConversationTitle={conversationDisplayTitle(activeConversation)}
  activeConversationPinned={activeConversation?.pinned}
  onToggleConversationPinned={handleToggleActiveConversationPinned}
  onRenameConversation={openConversationRenameDialog}
  {...existingProps}
/>
```

将工作区标题菜单替换为：

```tsx
<Button type="button" variant="ghost" size="icon-xs" aria-label="重命名工作区" onClick={openRenameDialog}>
  <Pencil />
</Button>
```

- [ ] **Step 4: 运行页面测试并确认通过**

Run: `rtk pnpm --filter @typedance/web test -- RevisionWorkspacePage.test.tsx`

Expected: PASS。

### Task 4: 全量验证与提交推送

**Files:**
- Verify all modified files

- [ ] **Step 1: 确认 shadcn 配置与组件清单**

Run: `pnpm dlx shadcn@latest info --json -c apps/web`

Expected: `style` 为 `radix-maia`，组件列表包含 `alert-dialog`。

- [ ] **Step 2: 运行完整 Web 测试与构建**

Run: `rtk pnpm --filter @typedance/web test`

Expected: PASS。

Run: `rtk pnpm --filter @typedance/web build`

Expected: PASS。

- [ ] **Step 3: 检查差异并提交**

Run: `rtk git diff --check`

Expected: 无输出。

```bash
git add apps/web/src/components/ui/alert-dialog.tsx apps/web/src/features/revision/AgentChatPanel.tsx apps/web/src/features/revision/AgentChatPanel.test.tsx apps/web/src/features/revision/WorkbenchSidebar.tsx apps/web/src/features/revision/WorkbenchSidebar.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx docs/superpowers/plans/2026-06-18-conversation-title-actions.md
git commit -m "feat(workbench): 优化对话标题与操作入口"
git push
```
