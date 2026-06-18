# 选择对话时自动展开 AI 面板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 点击工作台左侧既有对话时，自动展开当前隐藏的右侧 AI 面板并显示所选对话。

**架构：** 交互协调保留在 `RevisionWorkspacePage`。页面通过稳定的事件回调同时更新 `activeConversationId` 和 `assistantPanelVisible`；`WorkbenchSidebar` 仍只负责上报选择事件，不新增跨组件状态依赖。

**技术栈：** React、TypeScript、Vitest、Testing Library

---

### Task 1: 对话选择展开 AI 面板

**文件：**
- 修改：`apps/web/src/features/revision/RevisionWorkspacePage.tsx`
- 测试：`apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`

- [x] **Step 1: 编写失败测试**

在 `RevisionWorkspacePage.test.tsx` 增加页面集成测试：以 `renderPage(false)` 渲染，等待名为 `优化简历` 的对话按钮出现并点击，随后断言“隐藏 AI 面板”按钮出现、工作区恢复 `grid-cols-[minmax(48rem,1fr)_24rem]`，并显示对话标题。

- [x] **Step 2: 运行测试并确认正确失败**

运行：

```powershell
rtk pnpm --filter @typedance/web test -- RevisionWorkspacePage.test.tsx -t "expands the assistant panel when selecting a conversation"
```

预期：测试因点击对话后 AI 面板仍然隐藏而失败，而不是语法、环境或查询错误。

- [x] **Step 3: 编写最小实现**

在 `RevisionWorkspacePage.tsx` 中新增稳定事件回调：

```tsx
const handleSelectConversation = useCallback((conversationId: string) => {
  setActiveConversationId(conversationId)
  chromeContext?.setAssistantPanelVisible?.(true)
}, [chromeContext])
```

将 `WorkbenchSidebar` 的 `onSelectConversation` 从 `setActiveConversationId` 改为 `handleSelectConversation`。不添加监听状态的 `useEffect`。

- [x] **Step 4: 运行定向测试并确认通过**

运行：

```powershell
rtk pnpm --filter @typedance/web test -- RevisionWorkspacePage.test.tsx
```

预期：该测试文件全部通过且无新增错误。

- [x] **Step 5: 运行前端完整验证**

运行：

```powershell
rtk pnpm --filter @typedance/web test
rtk pnpm --filter @typedance/web build
```

预期：测试和构建退出码均为 0。

- [x] **Step 6: 检查、提交并推送**

确认 diff 只包含本功能的页面回调、回归测试和文档，然后提交：

```powershell
git add -- apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx docs/superpowers/plans/2026-06-18-conversation-opens-ai-panel.md
git commit -m "feat(workbench): 选择对话时自动展开AI面板"
git push origin main
```
