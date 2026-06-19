# 工作台对话与界面边界优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新对话首次发送后才创建，并让工作台左侧导航、应用顶部栏、工作区标题栏和 AI 输入区形成更轻、更连续的视觉边界。

**Architecture:** `RevisionWorkspacePage` 维护“未选择后端对话”的空白草稿状态，`WorkbenchSidebar` 的两个新对话入口只发出 `onStartNewConversation`，`AgentChatPanel` 继续在首次发送时调用现有创建接口。视觉调整只修改现有 Tailwind class，不引入全局 CSS 或新的跨层接口。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、Vitest、Testing Library、现有 shadcn/ui 组件。

---

### Task 1: 新对话延迟创建

**Files:**
- Modify: `apps/web/src/features/revision/WorkbenchSidebar.test.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
- Modify: `apps/web/src/features/revision/WorkbenchSidebar.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`

- [ ] **Step 1: 写入失败测试**

将 `WorkbenchSidebar` 的新对话测试改为断言两个入口都只调用 `onStartNewConversation`，且 `createWorkspaceConversation` 从未被调用：

```tsx
const onStartNewConversation = vi.fn()
// render WorkbenchSidebar with onStartNewConversation
fireEvent.click(createButtons[0])
fireEvent.click(createButtons[1])
expect(onStartNewConversation).toHaveBeenCalledTimes(2)
expect(agentHostMocks.createWorkspaceConversation).not.toHaveBeenCalled()
```

将页面级测试改为断言点击“新对话”后不会创建或刷新列表，同时当前历史对话标题从 AI 面板消失：

```tsx
fireEvent.click(await screen.findByRole("button", { name: "优化简历" }))
expect(screen.getAllByText("优化简历")).toHaveLength(2)
fireEvent.click((await screen.findAllByRole("button", { name: "新对话" }))[0])
expect(agentHostMocks.createWorkspaceConversation).not.toHaveBeenCalled()
expect(agentHostMocks.listWorkspaceConversations).toHaveBeenCalledTimes(1)
expect(screen.getAllByText("优化简历")).toHaveLength(1)
```

再增加一个列表测试，确保服务端返回的空名称、空预览记录不会显示为“新对话”，而是按无对话状态处理。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `rtk pnpm --filter @typedance/web test -- WorkbenchSidebar.test.tsx RevisionWorkspacePage.test.tsx`

Expected: FAIL，因为 `WorkbenchSidebar` 尚无 `onStartNewConversation`，点击入口仍调用创建接口。

- [ ] **Step 3: 实现最小改动**

在 `WorkbenchSidebarProps` 中新增回调并替换现有异步创建逻辑：

```tsx
type WorkbenchSidebarProps = {
  // existing props
  onStartNewConversation: () => void
}

const handleNewConversation = useCallback(() => {
  onStartNewConversation()
}, [onStartNewConversation])
```

删除 `WorkbenchSidebar` 对 `createWorkspaceConversation` 的导入。两个入口继续调用同一函数。在 `RevisionWorkspacePage` 中新增并传递稳定回调：

```tsx
const handleStartNewConversation = useCallback(() => {
  setActiveConversationId(undefined)
  setAssistantPanelVisible?.(true)
}, [setAssistantPanelVisible])
```

渲染列表前过滤 `name` 与 `preview` 均为空的记录，并让标题函数只处理具有真实名称或预览的记录，不再返回“新对话”占位标题。

保持 `AgentChatPanel.handleSend` 的现有首次发送创建路径不变。

- [ ] **Step 4: 运行测试并确认通过**

Run: `rtk pnpm --filter @typedance/web test -- WorkbenchSidebar.test.tsx RevisionWorkspacePage.test.tsx AgentChatPanel.test.tsx`

Expected: PASS，新对话点击不创建，首次发送测试仍证明创建发生在发送阶段。

- [ ] **Step 5: 提交行为改动**

```bash
git add apps/web/src/features/revision/WorkbenchSidebar.tsx apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/WorkbenchSidebar.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
git commit -m "fix(workbench): 延迟创建空白对话"
```

### Task 2: 统一工作台边界与图标尺寸

**Files:**
- Modify: `apps/web/src/components/GlobalTitleBar.test.tsx`
- Modify: `apps/web/src/features/revision/WorkbenchSidebar.test.tsx`
- Modify: `apps/web/src/features/revision/AgentChatPanel.test.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
- Modify: `apps/web/src/components/GlobalTitleBar.tsx`
- Modify: `apps/web/src/features/revision/WorkbenchSidebar.tsx`
- Modify: `apps/web/src/features/revision/AgentChatPanel.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`

- [ ] **Step 1: 写入失败测试**

增加以下 class 断言：

```tsx
expect(screen.getByTestId("global-titlebar")).toHaveClass("bg-sidebar")
expect(screen.getByTestId("global-titlebar")).not.toHaveClass("border-b")
expect(settingsContainer).not.toHaveClass("border-t")
expect(pinnedIcon).toHaveClass("size-3")
expect(screen.getByTestId("revision-workspace-titlebar")).toHaveClass("rounded-l-xl")
expect(screen.getByTestId("agent-chat-composer-region")).not.toHaveClass("border-t")
```

同时为非工作台标题栏增加回归断言：

```tsx
renderTitleBar({ isWorkbenchRoute: false })
expect(screen.getByTestId("global-titlebar")).toHaveClass("border-b", "bg-background")
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `rtk pnpm --filter @typedance/web test -- GlobalTitleBar.test.tsx WorkbenchSidebar.test.tsx AgentChatPanel.test.tsx RevisionWorkspacePage.test.tsx`

Expected: FAIL，现有组件仍包含工作台顶栏和 composer 分隔线，且图钉与标题栏没有目标尺寸和圆角。

- [ ] **Step 3: 实现最小视觉改动**

仅修改现有 Tailwind class：

```tsx
// GlobalTitleBar
className={cn(
  "fixed inset-x-0 top-0 z-30 flex h-9 items-center text-foreground",
  isWorkbenchRoute ? "bg-sidebar" : "border-b border-border bg-background",
)}

// WorkbenchSidebar settings container and pinned status
<div data-testid="workbench-settings" className="p-2">
<Pin data-pinned="true" className="size-3" fill="currentColor" />

// RevisionWorkspacePage titlebar
className={cn(
  "flex h-12 shrink-0 items-center border-b border-border bg-background px-3",
  workbenchSidebarVisible && "rounded-l-xl",
)}

// AgentChatPanel composer region
<div data-testid="agent-chat-composer-region" className="shrink-0 p-3">
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `rtk pnpm --filter @typedance/web test -- GlobalTitleBar.test.tsx WorkbenchSidebar.test.tsx AgentChatPanel.test.tsx RevisionWorkspacePage.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交视觉改动**

```bash
git add apps/web/src/components/GlobalTitleBar.tsx apps/web/src/components/GlobalTitleBar.test.tsx apps/web/src/features/revision/WorkbenchSidebar.tsx apps/web/src/features/revision/WorkbenchSidebar.test.tsx apps/web/src/features/revision/AgentChatPanel.tsx apps/web/src/features/revision/AgentChatPanel.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
git commit -m "fix(workbench): 弱化导航与对话面板分隔线"
```

### Task 3: 完整验证

**Files:**
- Verify: `apps/web/src/features/revision/*.test.tsx`
- Verify: `apps/web/src/components/GlobalTitleBar.test.tsx`

- [ ] **Step 1: 运行完整 Web 测试**

Run: `rtk pnpm --filter @typedance/web test`

Expected: PASS，全部 Vitest 用例通过。

- [ ] **Step 2: 运行生产构建**

Run: `rtk pnpm --filter @typedance/web build`

Expected: PASS，TypeScript 与 Vite 构建均成功。

- [ ] **Step 3: 检查最终差异**

Run: `rtk git diff main...HEAD --check`

Expected: 无空白错误；差异只包含设计、计划、目标组件及测试。
