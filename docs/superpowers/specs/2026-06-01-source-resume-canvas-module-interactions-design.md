# 原始简历画布模块联动交互设计

## 背景

第一阶段已经把 Revision 工作台主编辑区切换为 `ResumeRichTextEditor` 原始简历画布，并提供模块大纲、节点锚点和淡蓝色 hover 提示。

当前交互仍有两个明显问题：

1. 模块反馈停留在段落节点级别。鼠标悬停或编辑时，用户看到的是当前行边界，而不是完整模块区域。
2. 模块大纲固定浮在画布右上角。它可能遮挡正文，且缺少与画布当前模块的同步高亮。

本设计只优化原始简历画布中的模块感知和大纲交互，不引入第二阶段 AI 标注、Diff 或知识库能力。

## 目标

1. 用户点击、键入或选择模块内文字时，完整模块区域进入激活状态。
2. 画布激活模块与模块大纲选中项保持同步。
3. 用户点击大纲条目后，目标模块进入激活状态，并滚动到编辑区可视范围顶部下方。
4. 模块大纲可以隐藏、展开、收起和拖拽，并按工作台记住位置与展开状态。
5. 支持 2-3 张 A4 长简历中的跨页模块反馈和滚动定位。
6. 所有模块交互状态仅存在于 Web 编辑器，不影响正文数据和导出结果。

## 非目标

- 不把交互状态写入 `SourceResumeCanvas.doc_json`。
- 不修改 `render_projection`、HTML 导出或 PDF 导出链路。
- 不引入 Tiptap 模块容器节点。
- 不实现模块拖拽排序、模块增删或复杂大纲层级。
- 不实现 AI 诊断高亮、波浪线、逐条建议或 Diff。
- 不改变结构识别规则和 `ModuleAnchor` 字段协议。

## 方案选择

采用独立的 `ModuleInteractionLayer`。

`ModuleInteractionLayer` 与 `ResumeRichTextEditor` 并列存在于 `DraftCanvas` 中。它读取 `module_anchors` 和编辑器 DOM 节点位置，在编辑画布上绘制纯交互反馈。它不修改 Tiptap 文档结构，不向 sidecar 保存视觉状态。

不采用以下方案：

- 不直接给每个段落节点分别添加激活背景。这样容易形成多行文本分别高亮的视觉效果，跨页和标题行处理也会逐渐堆积补丁。
- 不在 Tiptap schema 中引入模块父容器。该方案会侵入粘贴、拆分、合并、保存和原始数据转换层，本轮没有必要承担这类复杂度。

## 核心状态

交互状态属于前端 UI，不属于简历内容：

```ts
type ModuleOutlineUiState = {
  visible: boolean
  expanded: boolean
  position: { x: number; y: number }
  activeModuleId: string | null
  hoveredModuleId: string | null
}
```

其中：

- `visible` 默认值为 `true`。
- `expanded` 默认值为 `true`。
- `position` 默认值为编辑区右上角的安全位置。
- `activeModuleId` 和 `hoveredModuleId` 只保存在组件运行时状态中。
- `visible`、`expanded` 和 `position` 按 `documentId` 保存到浏览器本地存储。

本地存储只保存界面偏好，不保存简历正文、结构锚点或敏感信息。

本地存储键使用明确命名空间：

```text
typedance:revision-workspace:module-outline:<documentId>
```

## 组件边界

```text
DraftCanvas
├─ OutlineToolbarToggle
├─ ResumeRichTextEditor
├─ ModuleInteractionLayer
└─ DraggableModuleOutline
```

### OutlineToolbarToggle

在编辑器顶部格式工具栏新增“模块大纲”切换按钮：

- 默认选中。
- 关闭时，大纲浮窗完全隐藏。
- 再次开启时，恢复该工作台上次保存的位置与展开状态。
- 关闭大纲不影响画布模块激活反馈。

### ResumeRichTextEditor

编辑器继续渲染 `SourceResumeCanvas.doc_json`。它新增面向 `DraftCanvas` 的交互通知：

- 选区更新时，返回选区起点所在节点的 `moduleId`。
- 用户点击、键入或拖选文字时，使用同一条选区起点规则。
- 选区起点位于未识别区域时，返回 `null`。
- 跨模块拖选文字时，只激活选区起点所在模块。

### 模块标题节点归属

当前结构识别层已经知道模块标题和模块顺序，但生成画布锚点时，标题节点不一定已经纳入模块范围。为了让标题行可以稳定参与点击、选区和整体背景绘制，需要在 `SourceResumeCanvasBuilder` 中完善现有锚点内容：

- 模块标题节点写入与正文相同的 `moduleId`。
- 模块标题节点加入现有 `ModuleAnchor.canvas_node_ids`。
- 标题节点排列在该模块正文节点之前。
- 不新增 `ModuleAnchor` 字段，不改变接口协议。
- 这是模块锚点内容的完善，不是交互视觉状态持久化。

### ModuleInteractionLayer

该图层：

- 读取 `ModuleAnchor.canvas_node_ids`。
- 在编辑器 DOM 中查询对应的 `[data-canvas-node-id]` 节点。
- 根据 A4 页面容器边界计算模块矩形。
- 分别绘制 hover 和 active 反馈。
- 设置 `pointer-events: none`，不拦截正文点击、选区和输入。
- 使用 `@media print { display: none; }` 作为额外导出防线。

### DraggableModuleOutline

大纲浮窗：

- 继续使用现有标题栏和现有上下箭头。
- 标题栏中除箭头按钮以外的区域作为拖拽手柄。
- 上下箭头只负责展开与收起。
- 每个大纲条目对应一个 `ModuleAnchor`。
- 当前 `activeModuleId` 对应条目展示选中状态。
- 点击条目后先激活模块，再触发滚动定位。

## 模块视觉规则

### 激活状态

模块激活时，标题行到模块最后一个节点形成完整视觉区域：

- 使用轻量淡蓝背景。
- 使用清晰但克制的淡蓝边界。
- 大纲中的对应条目同步高亮。
- 激活状态持续保留，直到用户点击、键入或选择另一个模块。
- 用户点击未识别区域时，清除激活状态和大纲高亮。

### Hover 状态

鼠标滑过模块时：

- 使用比激活状态更弱的淡蓝边界。
- 不改变 `activeModuleId`。
- 不切换大纲高亮。
- 即使当前已有激活模块，仍允许预览其他模块的 hover 边界。

### 跨页状态

模块跨越多张 A4 页面时：

- 每张 A4 页面内分别绘制模块矩形。
- 分页间隙保持空白。
- 不使用跨越分页间隙的大矩形。
- 每页矩形共享同一个 `module_id` 和激活状态。

## 测量规则

### 输入

- `SourceResumeCanvas.module_anchors`
- 编辑器 DOM 中的 `[data-canvas-node-id]`
- 编辑器 A4 页面容器
- 编辑区可视容器

### 输出

```ts
type ModuleVisualRegion = {
  moduleId: string
  pageIndex: number
  top: number
  left: number
  width: number
  height: number
}
```

### 合并策略

1. 读取同一模块的所有锚点节点。
2. 按 A4 页面分组。
3. 在每张页面内按 DOM 顺序合并连续节点矩形。
4. 标题节点已经属于模块锚点，因此标题行自然包含在模块矩形中。
5. 对跨页模块生成多个 `ModuleVisualRegion`。

### 重新测量时机

- `module_anchors` 变化。
- 编辑器正文变化。
- Tiptap 分页结果变化。
- 编辑区尺寸变化。
- 浏览器窗口变化。
- 大纲展开、收起或拖拽导致可用区域变化。

优先使用 `ResizeObserver` 和受控的刷新调度，避免在每次鼠标移动时进行完整测量。

### 降级行为

- 找不到某个锚点节点时，仅隐藏该模块图层。
- 不跳转到错误位置。
- 不阻塞正文编辑。
- 不影响保存或导出。

## 大纲拖拽与持久化

### 拖拽范围

- 浮窗只能在编辑区可视范围内移动。
- 不允许拖入右侧问题处理区。
- 不允许拖出可视区域。
- 浏览器窗口、侧栏宽度或分页变化后，如果浮窗超出范围，自动修正回可见区域。

### 持久化

按 `documentId` 保存：

```ts
type PersistedModuleOutlinePreferences = {
  visible: boolean
  expanded: boolean
  position: { x: number; y: number }
}
```

写入策略：

- 切换显隐后保存。
- 展开或收起后保存。
- 拖拽结束后保存。
- 不在拖拽移动过程中频繁写入本地存储。

## 大纲滚动定位

点击大纲条目时：

1. 立即把对应 `module_id` 设为激活模块。
2. 找到模块第一个有效 `canvas_node_id`。
3. 将该节点滚动到编辑区可视范围顶部下方，留出少量阅读间距。
4. 默认使用平滑滚动。
5. 当用户启用 `prefers-reduced-motion` 时，使用即时滚动。
6. 锚点失效时保持画布可编辑，不跳到错误位置。

滚动定位使用编辑区内部滚动容器，不依赖整个页面的偶然滚动位置。

## 导出隔离

模块交互态不能影响导出：

1. `activeModuleId`、`hoveredModuleId`、大纲显隐、展开状态和拖拽位置不写入 `SourceResumeCanvas.doc_json`。
2. `ModuleInteractionLayer` 和 `DraggableModuleOutline` 只存在于 Web 编辑器 DOM 中。
3. 当前导出继续使用独立的 `render_projection` 链路。
4. 交互图层增加 print 隐藏样式，防止未来页面打印误带交互反馈。
5. 导出回归测试必须验证 HTML 和 PDF 中不存在模块背景、边界和大纲浮窗。

## 测试要求

### 单元测试

- 点击、键入和拖选文字时，按选区起点解析当前模块。
- 跨模块拖选时只激活起点模块。
- 点击未识别区域时清除模块激活状态。
- hover 其他模块时不覆盖当前激活状态。
- 大纲按钮默认开启，支持隐藏和恢复。
- 大纲展开、收起状态可以恢复。
- 拖拽结束后按 `documentId` 保存位置。
- 浮窗越界后自动修正回编辑区可视范围。

### 组件测试

- 点击大纲条目后，同步高亮大纲项和画布模块。
- 点击大纲条目后，滚动到目标模块顶部并保留阅读间距。
- 点击未识别区域后，大纲取消高亮。
- 模块标题行包含在激活背景中。
- 浮窗隐藏后，画布模块反馈仍然存在。

### 浏览器测试

使用 2-3 张 A4 的长简历：

- 验证跨页模块在各页内分别绘制背景，分页间隙不被覆盖。
- 验证大纲点击可以跨页滚动并激活目标模块。
- 验证拖拽大纲后不会进入右侧问题处理区或离开可视范围。
- 验证刷新页面后恢复当前工作台的大纲位置、显隐和展开状态。
- 验证另一个工作台拥有独立的大纲偏好。

### 导出回归

- 验证保存后的 `SourceResumeCanvas.doc_json` 不包含模块激活或 hover 状态。
- 验证导出 HTML 不包含 `ModuleInteractionLayer` 或大纲浮窗。
- 验证导出 PDF 不出现模块背景、边界或浮窗。

## 验收标准

1. 点击、键入或选择模块内容后，完整模块区域进入激活状态。
2. 跨模块拖选时，只激活选区起点所在模块。
3. 点击未识别区域时，清除模块激活状态。
4. 激活模块与大纲条目同步高亮。
5. hover 其他模块时，只显示弱提示，不切换激活状态。
6. 点击大纲条目后，激活并滚动到模块顶部下方。
7. 大纲默认显示，可以通过顶部工具栏按钮隐藏和恢复。
8. 大纲可以展开、收起和在编辑区内拖拽。
9. 大纲位置、显隐和展开状态按工作台恢复。
10. 跨页模块按 A4 页面分别绘制反馈，不覆盖分页间隙。
11. 2-3 张 A4 长简历场景通过浏览器测试。
12. 交互图层和大纲浮窗不会进入保存正文或导出结果。
