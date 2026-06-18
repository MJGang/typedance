# 全局标题栏与导航控制实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用应用主题一致的自绘标题栏替换 Windows 原生黑色标题栏，并完成全局侧栏、历史导航、主题、窗口控制和 AI 面板显隐入口重排。

**Architecture:** Tauri 仅提供无原生装饰的窗口与窗口控制权限；React `SiteLayout` 渲染全局标题栏，独立 hook 管理应用历史边界，独立适配层封装 Tauri Window API。AI 面板显隐仍由现有 Outlet context 管理，隐藏按钮进入 `AgentChatPanel` 标题，恢复入口留在工作台右缘。

**Tech Stack:** Tauri 2、React 19、React Router 7、TypeScript、Tailwind CSS、shadcn/ui、Lucide React、Vitest、Testing Library

---

## 文件结构

- 新建 `apps/web/src/components/GlobalTitleBar.tsx`：全局标题栏布局、按钮语义与拖拽交互。
- 新建 `apps/web/src/components/GlobalTitleBar.test.tsx`：标题栏顺序、历史边界、主题、侧栏和窗口控制测试。
- 新建 `apps/web/src/hooks/useAppHistoryNavigation.ts`：读取 React Router 导航类型和 `history.state.idx`，计算返回/前进可用性。
- 新建 `apps/web/src/hooks/useAppHistoryNavigation.test.tsx`：PUSH、POP、前进分支截断测试。
- 新建 `apps/web/src/desktopWindow.ts`：Tauri Window API 的可测试适配层及 Web 安全边界。
- 新建 `apps/web/src/desktopWindow.test.ts`：非 Tauri 与 Tauri 调用测试。
- 修改 `apps/web/src/components/SiteLayout.tsx`：接入全局标题栏，删除旧应用内 header，将普通站点与工作台左栏显隐状态交给标题栏。
- 修改 `apps/web/src/App.test.tsx`：更新全局壳层和工作台显隐断言。
- 修改 `apps/web/src/features/revision/AgentChatPanel.tsx`：标题右侧增加隐藏 AI 面板按钮。
- 修改 `apps/web/src/features/revision/AgentChatPanel.test.tsx`：验证标题按钮触发隐藏回调。
- 修改 `apps/web/src/features/revision/RevisionWorkspacePage.tsx`：传递隐藏回调并渲染隐藏后的恢复入口。
- 修改 `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`：验证隐藏与恢复闭环。
- 修改 `apps/web/package.json` 与 `pnpm-lock.yaml`：为 Web 包加入 `@tauri-apps/api`。
- 修改 `apps/desktop/src-tauri/tauri.conf.json`：关闭原生窗口装饰。
- 修改 `apps/desktop/src-tauri/capabilities/default.json`：加入拖拽和窗口控制权限。

### Task 1：建立桌面窗口适配层

**Files:**
- Create: `apps/web/src/desktopWindow.ts`
- Create: `apps/web/src/desktopWindow.test.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1：安装 Tauri JavaScript API 到 Web 包**

Run:

```powershell
corepack pnpm --filter @typedance/web add @tauri-apps/api@^2.5.0
```

Expected: `apps/web/package.json` 增加 `@tauri-apps/api`，锁文件更新且命令退出码为 0。

- [ ] **Step 2：编写窗口适配层失败测试**

在 `apps/web/src/desktopWindow.test.ts` 中 mock `@tauri-apps/api/window`，覆盖：Web 环境不调用窗口 API；Tauri 环境分别调用 `minimize`、`toggleMaximize`、`close`、`startDragging`。

```ts
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }))

it("does not call desktop APIs outside Tauri", async () => {
  await minimizeDesktopWindow()
  expect(getCurrentWindow).not.toHaveBeenCalled()
})

it.each([
  ["minimize", minimizeDesktopWindow],
  ["toggleMaximize", toggleMaximizeDesktopWindow],
  ["close", closeDesktopWindow],
  ["startDragging", startDraggingDesktopWindow],
] as const)("calls %s in Tauri", async (method, action) => {
  window.__TAURI_INTERNALS__ = { invoke: vi.fn() }
  await action()
  expect(appWindow[method]).toHaveBeenCalledOnce()
})
```

- [ ] **Step 3：运行测试并确认失败**

Run:

```powershell
rtk vitest run apps/web/src/desktopWindow.test.ts
```

Expected: FAIL，提示 `desktopWindow` 模块不存在。

- [ ] **Step 4：实现窗口适配层**

在 `apps/web/src/desktopWindow.ts` 中复用 `isTauri()`，只在桌面环境延迟获取当前窗口，并统一捕获异步错误：

```ts
import { getCurrentWindow } from "@tauri-apps/api/window"
import { isTauri } from "@/tauri"

type DesktopWindowAction = "minimize" | "toggleMaximize" | "close" | "startDragging"

async function runDesktopWindowAction(action: DesktopWindowAction) {
  if (!isTauri()) return
  try {
    await getCurrentWindow()[action]()
  } catch (error) {
    console.error(`Failed to ${action} desktop window:`, error)
  }
}

export const minimizeDesktopWindow = () => runDesktopWindowAction("minimize")
export const toggleMaximizeDesktopWindow = () => runDesktopWindowAction("toggleMaximize")
export const closeDesktopWindow = () => runDesktopWindowAction("close")
export const startDraggingDesktopWindow = () => runDesktopWindowAction("startDragging")
```

- [ ] **Step 5：运行窗口适配层测试**

Run: `rtk vitest run apps/web/src/desktopWindow.test.ts`

Expected: PASS。

- [ ] **Step 6：提交窗口适配层**

```powershell
git add apps/web/src/desktopWindow.ts apps/web/src/desktopWindow.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(shell): 封装桌面窗口控制能力"
```

### Task 2：实现应用历史导航状态

**Files:**
- Create: `apps/web/src/hooks/useAppHistoryNavigation.ts`
- Create: `apps/web/src/hooks/useAppHistoryNavigation.test.tsx`

- [ ] **Step 1：编写历史导航失败测试**

使用 `BrowserRouter` 和测试页面覆盖初始禁用、PUSH 后可返回、POP 后可前进、返回后重新 PUSH 截断旧前进分支：

```tsx
function Probe() {
  const navigation = useAppHistoryNavigation()
  return (
    <>
      <button onClick={navigation.goBack} disabled={!navigation.canGoBack}>返回</button>
      <button onClick={navigation.goForward} disabled={!navigation.canGoForward}>前进</button>
      <Link to="/next">下一页</Link>
      <Link to="/replacement">替代页</Link>
    </>
  )
}
```

断言首次渲染两个按钮禁用，访问 `/next` 后返回可用，返回 `/` 后前进可用，再访问 `/replacement` 后前进重新禁用。

- [ ] **Step 2：运行测试并确认失败**

Run: `rtk vitest run apps/web/src/hooks/useAppHistoryNavigation.test.tsx`

Expected: FAIL，提示 hook 模块不存在。

- [ ] **Step 3：实现历史边界 hook**

使用 `useLocation()`、`useNavigate()`、`useNavigationType()`；以 `window.history.state?.idx` 为当前索引。首次渲染记录 `maxIndex`，`PUSH` 时把最大索引设为当前索引以截断旧前进分支，`POP` 时保留最大索引：

```ts
export function useAppHistoryNavigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const currentIndex = readHistoryIndex()
  const maxIndexRef = useRef(currentIndex)

  if (navigationType === "PUSH") maxIndexRef.current = currentIndex
  else maxIndexRef.current = Math.max(maxIndexRef.current, currentIndex)

  return {
    canGoBack: currentIndex > 0,
    canGoForward: currentIndex < maxIndexRef.current,
    goBack: () => currentIndex > 0 && navigate(-1),
    goForward: () => currentIndex < maxIndexRef.current && navigate(1),
    locationKey: location.key,
  }
}
```

`readHistoryIndex()` 对缺失或非法 `idx` 返回 0，避免跳出应用会话。

- [ ] **Step 4：运行历史导航测试**

Run: `rtk vitest run apps/web/src/hooks/useAppHistoryNavigation.test.tsx`

Expected: PASS。

- [ ] **Step 5：提交历史导航 hook**

```powershell
git add apps/web/src/hooks/useAppHistoryNavigation.ts apps/web/src/hooks/useAppHistoryNavigation.test.tsx
git commit -m "feat(shell): 增加应用历史导航状态"
```

### Task 3：实现全局自绘标题栏

**Files:**
- Create: `apps/web/src/components/GlobalTitleBar.tsx`
- Create: `apps/web/src/components/GlobalTitleBar.test.tsx`
- Modify: `apps/web/src/components/SiteLayout.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1：编写标题栏失败测试**

测试按 DOM 顺序断言：左侧导航、返回、前进、主题、分隔线、最小化、最大化、关闭；同时验证禁用状态、侧栏切换、主题切换和四个窗口适配函数。

```tsx
const controls = [
  "隐藏左侧导航",
  "返回",
  "前进",
  "切换深色模式",
  "最小化",
  "最大化或还原",
  "关闭",
]
for (const [index, label] of controls.entries()) {
  expect(screen.getByRole("button", { name: label })).toHaveAttribute("data-control-order", String(index))
}
```

在 `App.test.tsx` 更新工作台断言：旧 `site-assistant-panel-toggle` 不再位于 `SiteLayout`；非工作台与工作台都渲染 `global-titlebar`；旧应用内 header 不存在。

- [ ] **Step 2：运行测试并确认失败**

Run:

```powershell
rtk vitest run apps/web/src/components/GlobalTitleBar.test.tsx apps/web/src/App.test.tsx
```

Expected: FAIL，提示 `GlobalTitleBar` 不存在或仍找到旧 header 控件。

- [ ] **Step 3：实现全局标题栏**

`GlobalTitleBar` 使用现有 shadcn `Button`、`Tooltip` 和 Lucide 图标。根节点使用：

```tsx
<header
  data-testid="global-titlebar"
  className="flex h-9 shrink-0 items-center border-b border-border bg-background text-foreground"
>
```

左侧控制顺序为 `PanelLeft`、`ArrowLeft`、`ArrowRight`；中部使用 `flex-1 self-stretch` 作为拖拽区域，单击主键调用 `startDraggingDesktopWindow()`，双击调用 `toggleMaximizeDesktopWindow()`；右侧依次为 `Moon/Sun`、竖线、`Minus`、`Square`、`X`。交互按钮不添加 `data-tauri-drag-region`。

关闭按钮使用 `hover:bg-destructive hover:text-destructive-foreground`；其余按钮使用 ghost 样式。历史按钮的 `disabled` 来自 `useAppHistoryNavigation()`。

- [ ] **Step 4：改造 SiteLayout**

保留 `SidebarProvider` 和 `RevisionWorkspaceChromeContext`，为 context 增加 `workbenchSidebarVisible` 与 setter，删除旧 `ThemeToggle`、`PanelVisibilityControls` 及内容上方 `h-12` header；在 `SidebarInset` 顶部统一渲染：

```tsx
<GlobalTitleBar />
<main className="min-h-0 flex-1 overflow-auto">
  <Outlet context={{ assistantPanelVisible, setAssistantPanelVisible, workbenchSidebarVisible, setWorkbenchSidebarVisible }} />
</main>
```

标题栏通过 `useSidebar()` 获取普通页面的 `open` 和 `toggleSidebar()`，同时接收工作台路由的 `workbenchSidebarVisible` 与 setter。左侧按钮在普通页面控制 `SiteSidebar`，在工作台页面控制 `WorkbenchSidebar`，按钮状态始终反映当前实际左栏。

- [ ] **Step 5：运行标题栏测试**

Run:

```powershell
rtk vitest run apps/web/src/components/GlobalTitleBar.test.tsx apps/web/src/App.test.tsx
```

Expected: PASS。

- [ ] **Step 6：提交全局标题栏**

```powershell
git add apps/web/src/components/GlobalTitleBar.tsx apps/web/src/components/GlobalTitleBar.test.tsx apps/web/src/components/SiteLayout.tsx apps/web/src/App.test.tsx
git commit -m "feat(shell): 新增全局自绘标题栏"
```

### Task 4：移动 AI 面板显隐入口

**Files:**
- Modify: `apps/web/src/features/revision/AgentChatPanel.tsx`
- Modify: `apps/web/src/features/revision/AgentChatPanel.test.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`

- [ ] **Step 1：编写 AI 标题按钮失败测试**

给 `AgentChatPanelProps` 测试数据增加 `onHide`，断言标题区域右侧存在“隐藏 AI 面板”按钮并调用回调：

```tsx
const onHide = vi.fn()
renderAgentChatPanel({ onHide })
fireEvent.click(screen.getByRole("button", { name: "隐藏 AI 面板" }))
expect(onHide).toHaveBeenCalledOnce()
```

- [ ] **Step 2：编写工作台恢复入口失败测试**

在 `RevisionWorkspacePage.test.tsx` 的 Outlet context harness 中暴露 `assistantPanelVisible` 和 `workbenchSidebarVisible` 状态。隐藏 AI 后断言 AI aside 消失、“显示 AI 面板”按钮出现；点击恢复后 aside 与标题内隐藏按钮重新出现。切换 `workbenchSidebarVisible` 后断言 `WorkbenchSidebar` 消失且画布继续展示。

- [ ] **Step 3：运行测试并确认失败**

Run:

```powershell
rtk vitest run apps/web/src/features/revision/AgentChatPanel.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
```

Expected: FAIL，提示缺少 `onHide` 或找不到面板显隐按钮。

- [ ] **Step 4：实现标题内隐藏按钮**

为 `AgentChatPanelProps` 增加 `onHide: () => void`。标题右侧将运行状态点与按钮组合：

```tsx
<div className="flex items-center gap-2">
  {runningRunId ? <span className="size-2 rounded-full bg-sky-500" /> : null}
  <Button variant="ghost" size="icon-sm" aria-label="隐藏 AI 面板" onClick={onHide}>
    <PanelRightClose className="size-4" />
  </Button>
</div>
```

- [ ] **Step 5：实现工作台恢复入口**

从 `chromeContext` 读取 `setAssistantPanelVisible` 和 `workbenchSidebarVisible`。仅在 `workbenchSidebarVisible` 为 true 时渲染 `WorkbenchSidebar`。AI 面板可见时向 `AgentChatPanel` 传 `onHide={() => setAssistantPanelVisible?.(false)}`；隐藏时在 grid 右缘渲染固定宽度恢复按钮：

```tsx
{assistantPanelVisible ? (
  <AgentChatPanel onHide={() => setAssistantPanelVisible?.(false)} {...chatProps} />
) : (
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label="显示 AI 面板"
    className="absolute right-2 top-2 z-20"
    onClick={() => setAssistantPanelVisible?.(true)}
  >
    <PanelRightOpen className="size-4" />
  </Button>
)}
```

给 `revision-workspace-grid` 增加 `relative`，恢复按钮不占画布列宽。

- [ ] **Step 6：运行 AI 面板测试**

Run:

```powershell
rtk vitest run apps/web/src/features/revision/AgentChatPanel.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
```

Expected: PASS。

- [ ] **Step 7：提交 AI 面板入口调整**

```powershell
git add apps/web/src/features/revision/AgentChatPanel.tsx apps/web/src/features/revision/AgentChatPanel.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
git commit -m "feat(workbench): 调整 AI 面板显隐入口"
```

### Task 5：启用 Tauri 自绘窗口并完成验证

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`

- [ ] **Step 1：关闭原生窗口装饰**

在主窗口配置加入：

```json
"decorations": false
```

保持现有标题、尺寸和 `dragDropEnabled` 不变。

- [ ] **Step 2：增加窗口权限**

在 `permissions` 增加：

```json
"core:window:allow-start-dragging",
"core:window:allow-minimize",
"core:window:allow-toggle-maximize",
"core:window:allow-close"
```

- [ ] **Step 3：运行聚焦测试**

Run:

```powershell
rtk vitest run apps/web/src/desktopWindow.test.ts apps/web/src/hooks/useAppHistoryNavigation.test.tsx apps/web/src/components/GlobalTitleBar.test.tsx apps/web/src/App.test.tsx apps/web/src/features/revision/AgentChatPanel.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
```

Expected: 所有测试 PASS。

- [ ] **Step 4：运行 Web 全量测试与构建**

Run:

```powershell
rtk pnpm --filter @typedance/web test
rtk pnpm --filter @typedance/web build
```

Expected: Vitest 全部通过，TypeScript 和 Vite 构建退出码为 0。

- [ ] **Step 5：验证 Tauri 配置与 Rust**

Run:

```powershell
rtk cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: `Finished dev profile`，退出码为 0。

- [ ] **Step 6：桌面人工验收**

Run: `corepack pnpm --filter @typedance/desktop dev`

逐项确认：顶部不再纯黑；空白区可拖动且双击最大化/还原；返回/前进边界正确；主题按钮位于最小化左侧且有竖线；窗口三按钮可用；AI 标题按钮可隐藏面板，右缘按钮可恢复面板。

- [ ] **Step 7：提交 Tauri 配置与最终收口**

```powershell
git add apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/capabilities/default.json
git commit -m "feat(desktop): 启用主题化自绘窗口标题栏"
```

- [ ] **Step 8：检查最终差异与工作区状态**

Run:

```powershell
rtk git status --short
rtk git diff HEAD~4..HEAD --check
```

Expected: 工作区无未提交改动，`diff --check` 无错误。
