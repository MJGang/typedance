# 工作台左右面板可拖拽宽度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让修订工作台左右面板支持有边界、可键盘操作且可在本机持久化的宽度拖拽。

**Architecture:** `RevisionWorkspacePage` 继续拥有三栏布局状态，但把纯尺寸计算和本机存储放入 `panelLayout.ts`，把指针与键盘交互放入 `PanelResizeHandle.tsx`。页面仅负责观察工作台容器宽度、计算实际栏宽、连接两个分隔条，并保持 `WorkbenchSidebar` 与 `AgentChatPanel` 不感知外部布局状态。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、Vitest、Testing Library、`localStorage`、`ResizeObserver`

---

## 文件结构

- Create: `apps/web/src/features/revision/panelLayout.ts`
  - 定义默认值、范围、中央画布保留宽度、存储读写和双侧实际宽度计算。
- Create: `apps/web/src/features/revision/panelLayout.test.ts`
  - 纯函数测试，不依赖页面异步数据。
- Create: `apps/web/src/features/revision/PanelResizeHandle.tsx`
  - 封装 pointer capture、拖拽清理、键盘步进和 separator ARIA。
- Create: `apps/web/src/features/revision/PanelResizeHandle.test.tsx`
  - 验证指针方向、边界、提交时机、键盘与清理行为。
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
  - 观察容器宽度、持有请求宽度、计算实际宽度、插入两条分隔条并持久化。
- Modify: `apps/web/src/features/revision/WorkbenchSidebar.tsx`
  - 将内部固定宽度改为填满页面分配的容器宽度。
- Modify: `apps/web/src/features/revision/AgentChatPanel.tsx`
  - 将内部固定宽度改为填满 grid 分配的列宽。
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
  - 更新固定 grid class 断言，增加默认值、恢复值、隐藏/恢复和动态列宽集成测试。

### Task 1: 实现尺寸约束与本机持久化

**Files:**
- Create: `apps/web/src/features/revision/panelLayout.ts`
- Create: `apps/web/src/features/revision/panelLayout.test.ts`

- [ ] **Step 1: 写入失败的纯函数测试**

```ts
import { beforeEach, describe, expect, it } from "vitest"
import {
  DEFAULT_PANEL_WIDTHS,
  PANEL_WIDTH_STORAGE_KEY,
  loadPanelWidths,
  resolvePanelLayout,
  savePanelWidths,
} from "./panelLayout"

describe("panelLayout", () => {
  beforeEach(() => localStorage.clear())

  it("loads defaults and validates persisted values", () => {
    expect(loadPanelWidths()).toEqual(DEFAULT_PANEL_WIDTHS)

    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify({ left: 310, right: 470 }))
    expect(loadPanelWidths()).toEqual({ left: 310, right: 470 })

    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify({ left: "wide", right: 9999 }))
    expect(loadPanelWidths()).toEqual(DEFAULT_PANEL_WIDTHS)
  })

  it("persists requested panel widths", () => {
    savePanelWidths({ left: 300, right: 440 })
    expect(JSON.parse(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY)!)).toEqual({
      left: 300,
      right: 440,
    })
  })

  it("preserves the canvas by shrinking the right panel before the left", () => {
    expect(resolvePanelLayout({
      containerWidth: 1200,
      leftVisible: true,
      rightVisible: true,
      requested: { left: 420, right: 560 },
    })).toEqual({
      left: 240,
      right: 320,
      leftMax: 240,
      rightMax: 320,
    })
  })

  it("restores requested width when a panel is hidden or space returns", () => {
    expect(resolvePanelLayout({
      containerWidth: 1200,
      leftVisible: true,
      rightVisible: false,
      requested: { left: 420, right: 560 },
    }).left).toBe(420)

    expect(resolvePanelLayout({
      containerWidth: 1800,
      leftVisible: true,
      rightVisible: true,
      requested: { left: 420, right: 560 },
    })).toMatchObject({ left: 420, right: 560 })
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
corepack.cmd pnpm --filter @typedance/web test panelLayout.test.ts
```

Expected: FAIL，提示无法解析 `./panelLayout`。

- [ ] **Step 3: 实现纯布局与安全存储函数**

```ts
export type PanelWidths = {
  left: number
  right: number
}

export const PANEL_WIDTH_STORAGE_KEY = "typedance.revision-workspace.panel-widths.v1"
export const DEFAULT_PANEL_WIDTHS: PanelWidths = { left: 272, right: 384 }
export const LEFT_PANEL_MIN_WIDTH = 220
export const LEFT_PANEL_MAX_WIDTH = 420
export const RIGHT_PANEL_MIN_WIDTH = 320
export const RIGHT_PANEL_MAX_WIDTH = 560
export const DRAFT_PANEL_MIN_WIDTH = 640

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function isValidPanelWidths(value: unknown): value is PanelWidths {
  if (!value || typeof value !== "object") return false
  const widths = value as Partial<PanelWidths>
  return (
    typeof widths.left === "number"
    && Number.isFinite(widths.left)
    && widths.left >= LEFT_PANEL_MIN_WIDTH
    && widths.left <= LEFT_PANEL_MAX_WIDTH
    && typeof widths.right === "number"
    && Number.isFinite(widths.right)
    && widths.right >= RIGHT_PANEL_MIN_WIDTH
    && widths.right <= RIGHT_PANEL_MAX_WIDTH
  )
}

export function loadPanelWidths(): PanelWidths {
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY)
    if (!raw) return DEFAULT_PANEL_WIDTHS
    const parsed: unknown = JSON.parse(raw)
    return isValidPanelWidths(parsed) ? parsed : DEFAULT_PANEL_WIDTHS
  } catch {
    return DEFAULT_PANEL_WIDTHS
  }
}

export function savePanelWidths(widths: PanelWidths) {
  try {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify(widths))
  } catch {
    // Width persistence is optional; the current session remains usable.
  }
}

type ResolvePanelLayoutInput = {
  containerWidth: number
  leftVisible: boolean
  rightVisible: boolean
  requested: PanelWidths
}

export function resolvePanelLayout({
  containerWidth,
  leftVisible,
  rightVisible,
  requested,
}: ResolvePanelLayoutInput) {
  let left = leftVisible ? clamp(requested.left, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_MAX_WIDTH) : 0
  let right = rightVisible ? clamp(requested.right, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH) : 0

  if (containerWidth > 0) {
    let overflow = Math.max(0, left + right + DRAFT_PANEL_MIN_WIDTH - containerWidth)
    const rightReduction = Math.min(overflow, Math.max(0, right - RIGHT_PANEL_MIN_WIDTH))
    right -= rightReduction
    overflow -= rightReduction
    const leftReduction = Math.min(overflow, Math.max(0, left - LEFT_PANEL_MIN_WIDTH))
    left -= leftReduction
  }

  return {
    left,
    right,
    leftMax: leftVisible
      ? Math.max(LEFT_PANEL_MIN_WIDTH, Math.min(LEFT_PANEL_MAX_WIDTH, containerWidth > 0 ? containerWidth - right - DRAFT_PANEL_MIN_WIDTH : LEFT_PANEL_MAX_WIDTH))
      : 0,
    rightMax: rightVisible
      ? Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, containerWidth > 0 ? containerWidth - left - DRAFT_PANEL_MIN_WIDTH : RIGHT_PANEL_MAX_WIDTH))
      : 0,
  }
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```powershell
corepack.cmd pnpm --filter @typedance/web test panelLayout.test.ts
```

Expected: PASS，4 个测试全部通过。

- [ ] **Step 5: 提交纯逻辑**

```powershell
git add -- apps/web/src/features/revision/panelLayout.ts apps/web/src/features/revision/panelLayout.test.ts
git commit -m "feat(workbench): 新增面板宽度约束与持久化"
```

### Task 2: 实现可访问的拖拽分隔条

**Files:**
- Create: `apps/web/src/features/revision/PanelResizeHandle.tsx`
- Create: `apps/web/src/features/revision/PanelResizeHandle.test.tsx`

- [ ] **Step 1: 写入失败的交互测试**

```tsx
import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PanelResizeHandle } from "./PanelResizeHandle"

describe("PanelResizeHandle", () => {
  it("resizes in the configured pointer direction and commits on release", () => {
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()
    render(
      <PanelResizeHandle
        ariaLabel="调整左侧面板宽度"
        direction={1}
        min={220}
        max={420}
        value={272}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    )

    const separator = screen.getByRole("separator", { name: "调整左侧面板宽度" })
    fireEvent.pointerDown(separator, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 180, pointerId: 1 })
    expect(onResize).toHaveBeenLastCalledWith(352)
    expect(onResizeEnd).not.toHaveBeenCalled()

    fireEvent.pointerUp(window, { clientX: 180, pointerId: 1 })
    expect(onResizeEnd).toHaveBeenCalledWith(352)
    expect(document.body.style.userSelect).toBe("")
  })

  it("clamps right-panel dragging and supports keyboard steps", () => {
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()
    render(
      <PanelResizeHandle
        ariaLabel="调整 AI 面板宽度"
        direction={-1}
        min={320}
        max={560}
        value={384}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    )

    const separator = screen.getByRole("separator", { name: "调整 AI 面板宽度" })
    fireEvent.pointerDown(separator, { clientX: 500, pointerId: 2 })
    fireEvent.pointerMove(window, { clientX: 200, pointerId: 2 })
    expect(onResize).toHaveBeenLastCalledWith(560)
    fireEvent.pointerCancel(window, { pointerId: 2 })

    fireEvent.keyDown(separator, { key: "ArrowLeft" })
    expect(onResize).toHaveBeenLastCalledWith(400)
    expect(onResizeEnd).toHaveBeenLastCalledWith(400)
    fireEvent.keyDown(separator, { key: "ArrowRight", shiftKey: true })
    expect(onResize).toHaveBeenLastCalledWith(336)
    expect(onResizeEnd).toHaveBeenLastCalledWith(336)
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
corepack.cmd pnpm --filter @typedance/web test PanelResizeHandle.test.tsx
```

Expected: FAIL，提示无法解析 `./PanelResizeHandle`。

- [ ] **Step 3: 实现分隔条**

```tsx
import { useCallback, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

type PanelResizeHandleProps = {
  ariaLabel: string
  direction: 1 | -1
  min: number
  max: number
  value: number
  onResize: (width: number) => void
  onResizeEnd: (width: number) => void
  className?: string
}

const KEYBOARD_STEP = 16
const KEYBOARD_LARGE_STEP = 48

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function PanelResizeHandle({
  ariaLabel,
  direction,
  min,
  max,
  value,
  onResize,
  onResizeEnd,
  className,
}: PanelResizeHandleProps) {
  const dragRef = useRef<{ startX: number; startValue: number; latestValue: number } | null>(null)
  const previousUserSelectRef = useRef("")

  const finishDrag = useCallback((commit: boolean) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    document.body.style.userSelect = previousUserSelectRef.current
    if (commit) onResizeEnd(drag.latestValue)
  }, [onResizeEnd])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const nextValue = clamp(drag.startValue + direction * (event.clientX - drag.startX), min, max)
      drag.latestValue = nextValue
      onResize(nextValue)
    }
    const handlePointerUp = () => finishDrag(true)
    const handlePointerCancel = () => finishDrag(false)
    const handleBlur = () => finishDrag(true)
    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("pointercancel", handlePointerCancel)
    window.addEventListener("blur", handleBlur)
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerCancel)
      window.removeEventListener("blur", handleBlur)
      finishDrag(false)
    }
  }, [direction, finishDrag, max, min, onResize])

  return (
    <div className={cn("relative z-20 w-0 shrink-0", className)}>
      <div
        role="separator"
        aria-label={ariaLabel}
        aria-orientation="vertical"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value)}
        tabIndex={0}
        className="group absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none"
        onPointerDown={(event) => {
          event.preventDefault()
          previousUserSelectRef.current = document.body.style.userSelect
          document.body.style.userSelect = "none"
          dragRef.current = { startX: event.clientX, startValue: value, latestValue: value }
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
          event.preventDefault()
          const visualDirection = event.key === "ArrowRight" ? 1 : -1
          const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP
          const nextValue = clamp(value + direction * visualDirection * step, min, max)
          onResize(nextValue)
          onResizeEnd(nextValue)
        }}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary group-active:bg-primary" />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```powershell
corepack.cmd pnpm --filter @typedance/web test PanelResizeHandle.test.tsx
```

Expected: PASS，2 个测试全部通过。

- [ ] **Step 5: 提交分隔条**

```powershell
git add -- apps/web/src/features/revision/PanelResizeHandle.tsx apps/web/src/features/revision/PanelResizeHandle.test.tsx
git commit -m "feat(workbench): 新增面板拖拽分隔条"
```

### Task 3: 集成工作台布局并补回归测试

**Files:**
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
- Modify: `apps/web/src/features/revision/WorkbenchSidebar.tsx`
- Modify: `apps/web/src/features/revision/AgentChatPanel.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`

- [ ] **Step 1: 更新页面测试，先表达新的布局契约**

在 `beforeEach` 中加入：

```ts
localStorage.clear()
```

把固定 Tailwind grid class 断言改为内联模板断言：

```tsx
const workspaceGrid = screen.getByTestId("revision-workspace-grid")
expect(workspaceGrid).toHaveStyle({
  gridTemplateColumns: "minmax(0, 1fr) 0px 384px",
})
expect(screen.getByRole("separator", { name: "调整左侧面板宽度" })).toHaveAttribute("aria-valuenow", "272")
expect(screen.getByRole("separator", { name: "调整 AI 面板宽度" })).toHaveAttribute("aria-valuenow", "384")
```

新增持久化恢复测试：

```tsx
it("restores persisted panel widths and keeps them after hiding the assistant", async () => {
  localStorage.setItem(
    "typedance.revision-workspace.panel-widths.v1",
    JSON.stringify({ left: 320, right: 460 }),
  )
  renderPage()

  const workspaceGrid = await screen.findByTestId("revision-workspace-grid")
  expect(screen.getByRole("separator", { name: "调整左侧面板宽度" })).toHaveAttribute("aria-valuenow", "320")
  expect(screen.getByRole("separator", { name: "调整 AI 面板宽度" })).toHaveAttribute("aria-valuenow", "460")
  expect(workspaceGrid).toHaveStyle({
    gridTemplateColumns: "minmax(0, 1fr) 0px 460px",
  })

  fireEvent.click(screen.getByRole("button", { name: "隐藏 AI 面板" }))
  expect(screen.queryByRole("separator", { name: "调整 AI 面板宽度" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "显示 AI 面板" }))
  expect(screen.getByRole("separator", { name: "调整 AI 面板宽度" })).toHaveAttribute("aria-valuenow", "460")
})
```

在左侧隐藏测试中增加：

```tsx
expect(screen.queryByRole("separator", { name: "调整左侧面板宽度" })).not.toBeInTheDocument()
```

- [ ] **Step 2: 运行页面测试并确认失败**

Run:

```powershell
corepack.cmd pnpm --filter @typedance/web test RevisionWorkspacePage.test.tsx
```

Expected: FAIL，页面仍使用固定 `17rem` / `24rem`，且没有 separator。

- [ ] **Step 3: 将两个内容面板改为填满父级**

`WorkbenchSidebar.tsx`：

```tsx
<aside className="flex h-full w-full min-w-0 flex-col bg-sidebar text-sidebar-foreground">
```

`AgentChatPanel.tsx`：

```tsx
<aside className="flex min-h-0 w-full min-w-0 flex-col border-l border-border bg-background">
```

- [ ] **Step 4: 在页面接入尺寸状态、容器观察和分隔条**

在 `RevisionWorkspacePage.tsx` 导入：

```tsx
import { PanelResizeHandle } from "./PanelResizeHandle"
import {
  LEFT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  loadPanelWidths,
  resolvePanelLayout,
  savePanelWidths,
} from "./panelLayout"
```

在页面状态区加入：

```tsx
const workspaceLayoutRef = useRef<HTMLDivElement>(null)
const [containerWidth, setContainerWidth] = useState(0)
const [requestedPanelWidths, setRequestedPanelWidths] = useState(loadPanelWidths)
```

加入容器观察：

```tsx
useEffect(() => {
  const container = workspaceLayoutRef.current
  if (!container) return
  const updateWidth = () => setContainerWidth(container.getBoundingClientRect().width)
  updateWidth()
  const observer = new ResizeObserver(updateWidth)
  observer.observe(container)
  return () => observer.disconnect()
}, [workspace?.document.id])
```

在返回 JSX 前计算布局：

```tsx
const panelLayout = resolvePanelLayout({
  containerWidth,
  leftVisible: workbenchSidebarVisible,
  rightVisible: assistantPanelVisible,
  requested: requestedPanelWidths,
})

const updateLeftPanelWidth = useCallback((left: number) => {
  setRequestedPanelWidths((current) => ({ ...current, left }))
}, [])
const updateRightPanelWidth = useCallback((right: number) => {
  setRequestedPanelWidths((current) => ({ ...current, right }))
}, [])
const persistLeftPanelWidth = useCallback((left: number) => {
  setRequestedPanelWidths((current) => {
    const next = { ...current, left }
    savePanelWidths(next)
    return next
  })
}, [])
const persistRightPanelWidth = useCallback((right: number) => {
  setRequestedPanelWidths((current) => {
    const next = { ...current, right }
    savePanelWidths(next)
    return next
  })
}, [])
```

把页面根元素、左侧区域和 `main` grid 改为：

```tsx
<div ref={workspaceLayoutRef} className="flex h-full min-h-0 overflow-hidden bg-background">
  {workbenchSidebarVisible ? (
    <>
      <div className="h-full shrink-0" style={{ width: panelLayout.left }}>
        <WorkbenchSidebar
          workspaceId={workspace.document.id}
          activeConversationId={activeConversationId}
          conversationRefreshToken={conversationRefreshToken}
          onSelectConversation={handleSelectConversation}
          onStartNewConversation={handleStartNewConversation}
          onContextSourcesChange={setContextSources}
          onConversationsChange={handleConversationsChange}
        />
      </div>
      <PanelResizeHandle
        ariaLabel="调整左侧面板宽度"
        direction={1}
        min={LEFT_PANEL_MIN_WIDTH}
        max={panelLayout.leftMax}
        value={panelLayout.left}
        onResize={updateLeftPanelWidth}
        onResizeEnd={persistLeftPanelWidth}
      />
    </>
  ) : null}
  <main
    data-testid="revision-workspace-grid"
    className="relative mr-1 mb-1 grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background"
    style={{
      gridTemplateColumns: assistantPanelVisible
        ? `minmax(0, 1fr) 0px ${panelLayout.right}px`
        : "minmax(0, 1fr)",
    }}
  >
```

在 `revision-draft-column` 与 `AgentChatPanel` 之间加入：

```tsx
{assistantPanelVisible ? (
  <PanelResizeHandle
    ariaLabel="调整 AI 面板宽度"
    direction={-1}
    min={RIGHT_PANEL_MIN_WIDTH}
    max={panelLayout.rightMax}
    value={panelLayout.right}
    onResize={updateRightPanelWidth}
    onResizeEnd={persistRightPanelWidth}
  />
) : null}
```

- [ ] **Step 5: 运行全部相关测试**

Run:

```powershell
corepack.cmd pnpm --filter @typedance/web test panelLayout.test.ts PanelResizeHandle.test.tsx RevisionWorkspacePage.test.tsx WorkbenchSidebar.test.tsx AgentChatPanel.test.tsx
```

Expected: PASS，相关测试全部通过；不存在 act warning 或未清理 pointer listener。

- [ ] **Step 6: 提交页面集成**

```powershell
git add -- apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx apps/web/src/features/revision/WorkbenchSidebar.tsx apps/web/src/features/revision/AgentChatPanel.tsx
git commit -m "feat(workbench): 支持左右面板拖拽调整宽度"
```

### Task 4: 完整验证与交付检查

**Files:**
- Verify only

- [ ] **Step 1: 运行完整 Web 测试**

Run:

```powershell
corepack.cmd pnpm --filter @typedance/web test
```

Expected: PASS，所有 Vitest 文件与测试通过。

- [ ] **Step 2: 运行 Web 构建**

Run:

```powershell
corepack.cmd pnpm --filter @typedance/web build
```

Expected: PASS，TypeScript 与 Vite 构建成功。

- [ ] **Step 3: 检查变更范围和空白错误**

Run:

```powershell
git diff --check HEAD~3
git status --short
git log -6 --oneline
```

Expected: `git diff --check` 无输出；工作树没有未提交的本次功能文件；最近提交包含设计、计划、纯逻辑、分隔条和页面集成。
