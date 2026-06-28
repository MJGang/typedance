# 全局内容卡片与画布横向滚动设计

## 目标

1. 所有页面中位于当前左侧导航右边的主内容区统一呈现为一张独立卡片：四角圆角、完整边框，右侧和底部各保留 4px 外部空间。
2. 工作台左侧画布在可用宽度不足时显示横向滚动条，保证固定宽度的简历内容可以完整查看。

## 所有权

- 普通页面由 `SiteLayout` 的 `SidebarInset` 拥有内容卡片的背景、边框、圆角、视口高度和外部留白。
- 工作台左侧导航位于 `SidebarInset` 内部，因此工作台卡片由左侧导航之后的 `revision-workspace-grid` 承担，确保卡片边界与截图标记区域一致。
- `revision-draft-panel` 只负责左侧画布列的横向滚动；右侧 AI 面板保持在工作区网格中，不参与横向滚动。
- 编辑器内部 `.td-editor-print-wrapper` 继续独立负责纵向滚动。

## 布局

- 全局外层背景使用 `bg-sidebar`，内容卡片使用现有 `bg-background`。
- 内容卡片位于 36px 全局标题栏下方，右侧使用 `mr-1`、底部使用 `mb-1`，对应 4px。
- 内容卡片使用 `rounded-xl border border-border overflow-hidden`，由容器裁出完整四角。
- 普通页面内容卡片高度为 `calc(100svh - 2.25rem - 4px)`，与标题栏和底部留白共同占满视口；工作台卡片由弹性布局扣除底部外边距。
- 画布列使用 `overflow-x-auto overflow-y-hidden`；内部现有 `min-w-[56rem]` 保持不变，使滚动条仅在需要时出现。

## 测试

- `App.test.tsx` 验证普通页面使用全局卡片外壳，并验证工作台路由将外框所有权留给内部主内容区。
- `RevisionWorkspacePage.test.tsx` 验证画布列拥有横向滚动，并验证工作区网格拥有完整圆角、边框和 4px 右/底间距。
- 浏览器验证 1080px 视口下：
  - 全局卡片四角圆角可见；
  - 卡片右侧和底部各留 4px；
  - 画布 `scrollWidth > clientWidth` 且 `overflow-x: auto`；
  - 横向滚动画布时 AI 面板位置不变。

## 架构边界

本次改动仅属于 Frontend 全局布局和画布展示层，不涉及 Harness Core、TS Agent Host 或 Python Sidecar。
