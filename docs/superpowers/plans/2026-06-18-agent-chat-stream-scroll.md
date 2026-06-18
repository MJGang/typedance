# AI 聊天流式滚动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 回复在用户停留底部时持续贴底，用户上滚后暂停，并通过底部箭头平滑返回后恢复跟随。

**Architecture:** 改动仅位于 Frontend 的 `AgentChatPanel`。用 DOM ref 保存消息容器，用 ref 保存高频跟随状态，用 React state 控制箭头显隐；`useLayoutEffect` 在消息内容提交后、浏览器绘制前执行即时贴底，人工点击箭头只触发一次原生平滑滚动。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、Tailwind CSS、shadcn/ui Button、Lucide

---

### Task 1: 建立流式滚动回归测试

**Files:**
- Test: `apps/web/src/features/revision/AgentChatPanel.test.tsx`

- [ ] **Step 1: 写入失败测试**

在现有流式回复测试旁新增两个测试。第一个测试把消息容器设为位于底部，派发 `assistant_delta` 后断言 `scrollTop` 更新为新的 `scrollHeight`。第二个测试先派发 `scroll` 模拟用户上滚，断言后续 delta 不改变位置、显示“回到底部”按钮；点击按钮后断言：

```ts
expect(scrollTo).toHaveBeenCalledWith({ top: scrollHeight, behavior: "smooth" })
```

再模拟容器抵达底部并派发 `scroll`，断言按钮隐藏，下一次 delta 恢复即时贴底。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `rtk pnpm --filter @typedance/web test -- AgentChatPanel.test.tsx`

Expected: FAIL，原因是消息容器尚无 `data-testid="agent-chat-messages"`、回到底部按钮和自动滚动行为。

- [ ] **Step 3: 提交测试**

```bash
git add apps/web/src/features/revision/AgentChatPanel.test.tsx
git commit -m "test(workbench): 覆盖聊天流式滚动行为"
```

### Task 2: 实现自动跟随与平滑返回

**Files:**
- Modify: `apps/web/src/features/revision/AgentChatPanel.tsx`

- [ ] **Step 1: 添加滚动状态与底部判断**

加入 24px 容差的纯函数，并在组件内加入消息容器 ref、自动跟随 ref 与箭头显隐 state：

```ts
const CHAT_BOTTOM_THRESHOLD_PX = 24

function isNearChatBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_BOTTOM_THRESHOLD_PX
}

const messageListRef = useRef<HTMLDivElement>(null)
const shouldFollowLatestRef = useRef(true)
const [showScrollToBottom, setShowScrollToBottom] = useState(false)
```

- [ ] **Step 2: 在绘制前贴底并响应用户滚动**

消息变化时仅在跟随状态下即时设置滚动位置，避免每个 token 叠加平滑动画：

```ts
useLayoutEffect(() => {
  const messageList = messageListRef.current
  if (!messageList || !shouldFollowLatestRef.current) return
  messageList.scrollTop = messageList.scrollHeight
}, [messages])

const handleMessageListScroll = useCallback((element: HTMLDivElement) => {
  const isAtBottom = isNearChatBottom(element)
  shouldFollowLatestRef.current = isAtBottom
  setShowScrollToBottom(!isAtBottom)
}, [])
```

切换会话时重置为跟随状态，确保新会话首次加载直接定位到底部。

- [ ] **Step 3: 渲染底部箭头按钮**

给消息区域增加相对定位包装层，容器增加 `data-testid="agent-chat-messages"`。用户离开底部时复用现有 shadcn Button：

```tsx
<Button
  type="button"
  variant="outline"
  size="icon"
  aria-label="回到底部"
  className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
  onClick={() => {
    const messageList = messageListRef.current
    messageList?.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" })
  }}
>
  <ChevronDown data-icon="inline-start" />
</Button>
```

点击时不提前开启跟随；只有平滑滚动触发的 `scroll` 表明容器已进入底部阈值后才恢复，避免动画途中被新 delta 瞬移打断。

- [ ] **Step 4: 运行定向测试并确认 GREEN**

Run: `rtk pnpm --filter @typedance/web test -- AgentChatPanel.test.tsx`

Expected: PASS，所有 `AgentChatPanel` 测试通过。

- [ ] **Step 5: 运行 Web 全量验证**

Run: `rtk pnpm --filter @typedance/web test`

Expected: PASS。

Run: `rtk pnpm --filter @typedance/web build`

Expected: exit 0。

Run: `pnpm dlx shadcn@latest info --json`

Expected: `style` 仍为 `radix-maia`，`button` 仍在组件清单中。

- [ ] **Step 6: 提交并推送**

```bash
git add apps/web/src/features/revision/AgentChatPanel.tsx apps/web/src/features/revision/AgentChatPanel.test.tsx docs/superpowers/plans/2026-06-18-agent-chat-stream-scroll.md
git commit -m "fix(workbench): 优化聊天流式滚动体验"
git push origin HEAD
```
