# 画布分页与右侧面板布局修复设计

## 问题

1. 画布分页器点击第 N 页时，实际滚动到第 N+1 页。
2. 工作区宽度不足时，右侧 AI 面板被挤出可视区域，右侧控件无法完整展示。

## 根因

`tiptap-pagination-plus@3.1.0` 生成的 `.page` 元素位于每页内容之后，用来撑开页面高度并衔接分页区域，不是页面顶部。当前实现直接把每个 `.page` 的顶部作为同序号页面的滚动位置，因此整体错后一页。

工作区在 AI 面板打开时使用 `minmax(48rem, 1fr) 24rem`。当可用宽度小于 `72rem` 时，网格仍坚持该最小总宽度，而外层又设置了 `overflow-hidden`，最终裁掉右侧面板。

## 设计

### 分页跳转

- 页数仍以渲染出的 `.page` 数量为准。
- 第一页的目标位置取 `.rm-with-pagination` 的顶部。
- 第 N 页（N > 1）的目标位置取第 N-1 个分页断点的顶部。
- 继续直接滚动 `.td-editor-print-wrapper`，不修改编辑器内容或持久化数据。
- 当前页判断与按钮高亮继续复用统一的页面顶部数组。

### 右侧面板

- AI 面板打开时，将画布列改为 `minmax(0, 1fr)`，右侧面板继续保持 `24rem`。
- 允许画布列在窄窗口中收缩；画布内部已有独立的最小宽度与裁切边界，不让它反向撑宽整个工作区。
- 不改动 `AgentChatPanel` 内部结构，也不引入横向页面滚动。

## 测试

- 调整 `DraftCanvas` 测试中的分页 DOM 几何，使 `.page` 与真实库一致地表示页尾断点。
- 新增/强化回归断言：从后续页点击第一页后，滚动位置回到第一页，而不是第二页。
- 在 `RevisionWorkspacePage` 测试中断言 AI 面板打开时画布列允许收缩，避免恢复 `48rem` 固定最小宽度。
- 运行相关 Vitest 测试和 `pnpm --filter @typedance/web build`。

## 范围

改动仅属于 Frontend：`DraftCanvas` 负责分页 DOM 测量与滚动，`RevisionWorkspacePage` 负责工作区网格布局。Harness Core、TS Agent Host 和 Python Sidecar 均不变。
