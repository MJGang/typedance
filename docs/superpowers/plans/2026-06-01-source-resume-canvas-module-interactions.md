# 原始简历画布模块联动交互 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在原始简历 A4 编辑画布中加入完整模块激活反馈、画布与大纲双向联动、可拖拽且按工作台持久化的大纲浮窗，并确保所有交互态与保存正文、HTML 导出和 PDF 导出严格隔离。

**Architecture:** 保持 `SourceResumeCanvas.doc_json` 为原始简历正文唯一编辑数据。sidecar 只完善现有模块锚点，把相邻标题节点纳入已有 `ModuleAnchor.canvas_node_ids`；Web 侧在 `DraftCanvas` 中增加独立的 `ModuleInteractionLayer` 和 `DraggableModuleOutline`。交互图层通过编辑器 DOM 中的 `[data-canvas-node-id]` 与 PaginationPlus 生成的 `.rm-pagination-gap` 计算每页矩形，不改写 Tiptap JSON。导出继续只走 `render_projection`。

**Tech Stack:** Python 3.11、FastAPI sidecar、React 19、TypeScript、Tiptap 3、PaginationPlus、Tailwind CSS、Vitest、Testing Library、Playwright、pytest。

---

## 实施前约束

- 本轮只实现第一阶段模块联动，不引入 AI 标注、Diff、知识库扫描或 RAG。
- 不新增 `ModuleAnchor` 字段，不增加旧逻辑兼容分支，不把交互态写入 `SourceResumeCanvas.doc_json`。
- `ResumeRichTextEditor` 仍是原始画布唯一编辑器。
- 当前 PaginationPlus 的真实 DOM 结构是在同一个 ProseMirror 流中生成 `.rm-page-break` 和 `.rm-pagination-gap`，不是把每页正文包进独立内容容器。跨页矩形必须按 gap 垂直区间切分。
- Tiptap 当前文档确认 `onSelectionUpdate` 可用于监听选区变化；模块选择解析使用 `editor.state.selection.$anchor`，保证反向拖选时仍以用户开始拖选的位置为准。
- 仓库要求 React 变更使用 `build-web-apps:react-best-practices`，但当前会话没有安装该 skill。执行时记录这一点，并遵循仓库既有 React 组件边界和测试风格。

## Task 1: 将相邻模块标题纳入现有画布锚点

**Files:**
- Modify: `services/sidecar/tests/test_revision_source_canvas.py`
- Modify: `services/sidecar/src/typedance_sidecar/revision_source_canvas.py`
- Modify: `services/sidecar/tests/test_revision_import_flow.py`

### Step 1: 写入失败测试，证明正文锚点前的标题会自动归属同一模块

- [ ] 在 `services/sidecar/tests/test_revision_source_canvas.py` 新增测试。模块来源引用只传正文 `block_3`，不提前传标题 `block_2`：

```py
def test_builder_includes_adjacent_heading_before_module_body():
    now = utc_now()
    source = SourceDocument(
        id="src_1",
        document_id="doc_1",
        source_type="old_resume",
        title="旧简历",
        raw_text="张三\n工作经历\n负责订单系统重构",
        parse_status="parsed",
        created_at=now,
    )
    blocks = [
        ParsedBlock(id="block_1", source_document_id=source.id, type="paragraph", text="张三", order=0, source_span={"line": 1}),
        ParsedBlock(id="block_2", source_document_id=source.id, type="heading", text="工作经历", order=1, source_span={"line": 2}),
        ParsedBlock(id="block_3", source_document_id=source.id, type="paragraph", text="负责订单系统重构", order=2, source_span={"line": 3}),
    ]
    module = DocumentModule(
        id="mod_work",
        draft_id="draft_1",
        pack_id="resume",
        type="WorkExperience",
        title="工作经历",
        order=1,
        visibility="visible",
        status="needs_review",
        data={},
        created_at=now,
        updated_at=now,
    )

    canvas = SourceResumeCanvasBuilder().build(
        source=source,
        parsed_blocks=blocks,
        modules=[module],
        module_source_refs={"mod_work": ["block_3"]},
    )

    assert canvas.node_map[1].module_id == "mod_work"
    assert canvas.doc_json["content"][1]["attrs"]["moduleId"] == "mod_work"
    assert canvas.module_anchors[0].canvas_node_ids == ["node_block_2", "node_block_3"]
```

### Step 2: 运行失败测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/sidecar exec pytest tests/test_revision_source_canvas.py -q
```

- [ ] Expected: 新测试失败，因为当前 builder 只信任 `module_source_refs`，不会补充相邻 heading。

### Step 3: 实现单一标题归属规则

- [ ] 在 `SourceResumeCanvasBuilder.build()` 中先构造增强后的 refs，再统一交给 `_module_by_block()` 和 `_module_anchors()`：

```py
module_source_refs = self._include_adjacent_module_headings(
    sorted_blocks,
    module_source_refs,
)
module_by_block = self._module_by_block(module_source_refs)
```

- [ ] 新增 `_include_adjacent_module_headings()`。规则保持克制：
  - 复制输入，不原地修改调用方字典。
  - 找到模块第一个有效来源块。
  - 如果它紧邻的前一个块是 `heading` 且尚未归属任何模块，则把 heading 插到该模块 refs 最前面。
  - 已经显式包含 heading 时不重复插入。
  - 不根据标题文本再次猜测模块语义，不引入 regex fallback。

```py
def _include_adjacent_module_headings(
    self,
    sorted_blocks: list[ParsedBlock],
    module_source_refs: dict[str, list[str]],
) -> dict[str, list[str]]:
    block_index = {block.id: index for index, block in enumerate(sorted_blocks)}
    enriched = {module_id: list(block_ids) for module_id, block_ids in module_source_refs.items()}
    claimed_block_ids = {block_id for block_ids in enriched.values() for block_id in block_ids}

    for module_id, block_ids in enriched.items():
        valid_block_ids = [block_id for block_id in block_ids if block_id in block_index]
        if not valid_block_ids:
            continue
        first_block_id = min(valid_block_ids, key=block_index.__getitem__)
        first_index = block_index[first_block_id]
        if first_index == 0:
            continue
        heading = sorted_blocks[first_index - 1]
        if heading.type == "heading" and heading.id not in claimed_block_ids:
            enriched[module_id] = [heading.id, *block_ids]
            claimed_block_ids.add(heading.id)

    return enriched
```

### Step 4: 增加 import-flow 集成断言

- [ ] 在 `test_import_flow_recognizes_common_career_skills_heading()` 中保留现有语义断言，并追加：

```py
skills_anchor = next(
    anchor
    for anchor in workspace.source_resume_canvas.module_anchors
    if anchor.title == "专业技能"
)
first_node_id = skills_anchor.canvas_node_ids[0]
first_node = next(
    node
    for node in workspace.source_resume_canvas.node_map
    if node.canvas_node_id == first_node_id
)
assert first_node.text == "职业技能"
assert first_node.node_type == "heading"
assert first_node.module_id == skills_anchor.module_id
```

### Step 5: 运行 sidecar 聚焦测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/sidecar exec pytest tests/test_revision_source_canvas.py tests/test_revision_import_flow.py -q
```

- [ ] Expected: PASS。

### Step 6: 提交

- [ ] Run:

```powershell
git add services/sidecar/src/typedance_sidecar/revision_source_canvas.py services/sidecar/tests/test_revision_source_canvas.py services/sidecar/tests/test_revision_import_flow.py
git commit -m "feat(canvas): 将模块标题纳入原始画布锚点"
```

## Task 2: 扩展编辑器选区通知、顶部大纲开关和顶部偏移滚动

**Files:**
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`

### Step 1: 写入选区起点解析测试

- [ ] 在 `ResumeRichTextEditor.toolbar.test.tsx` 新增：
  - 光标位于模块节点时，`onSourceCanvasModuleChange("mod_1")`。
  - 光标位于无 `moduleId` 节点时，回调 `null`。
  - 从后一个模块反向拖选到前一个模块时，仍返回 `$anchor` 所在的后一个模块。
  - 列表项的 `moduleId` 位于祖先 `listItem` 时也能被找到。

- [ ] 使用 `createRef<ResumeRichTextEditorHandle>()` 和新增 handle 方法设置选区，避免依赖 jsdom 鼠标选区细节：

```ts
ref.current?.setTextSelection({ anchor: secondModulePos, head: firstModulePos })
expect(onSourceCanvasModuleChange).toHaveBeenLastCalledWith("mod_2")
```

### Step 2: 写入顶部大纲开关测试

- [ ] 新增测试：
  - 未传 `onModuleOutlineVisibleChange` 时，普通编辑器不显示“模块大纲”按钮。
  - 传入回调时显示 `ListTree` 图标按钮。
  - `moduleOutlineVisible=true` 时按钮带 `data-active`。
  - 点击后调用 `onModuleOutlineVisibleChange(false)`。

### Step 3: 写入带阅读间距的内部滚动测试

- [ ] 保留现有默认 `scrollIntoView({ behavior, block: "center" })` 测试，确保 legacy 调用不变。
- [ ] 新增测试，调用：

```ts
ref.current?.scrollToCanvasNode("node_1", { topOffset: 16 })
```

- [ ] mock `.td-editor-print-wrapper.scrollTo()`、viewport rect 和目标节点 rect，断言滚动位置：

```ts
expect(scrollTo).toHaveBeenCalledWith({ top: 184, behavior: "smooth" })
```

### Step 4: 运行失败测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx
```

- [ ] Expected: 新增 props 和 handle 方法不存在，测试失败。

### Step 5: 扩展编辑器公开接口

- [ ] 在 `ResumeRichTextEditor.tsx` 增加：

```ts
type ResumeRichTextEditorProps = {
  // existing props
  moduleOutlineVisible?: boolean
  onModuleOutlineVisibleChange?: (visible: boolean) => void
  onSourceCanvasModuleChange?: (moduleId: string | null) => void
}

export type ResumeRichTextEditorHandle = {
  // existing methods
  setTextSelection: (selection: { anchor: number; head: number }) => void
  scrollToCanvasNode: (
    canvasNodeId: string,
    options?: { topOffset?: number },
  ) => void
}
```

- [ ] `setTextSelection` 只用于现有编辑器命令封装和组件测试，不写入正文。

### Step 6: 用 `$anchor` 解析模块

- [ ] 新增纯函数：

```ts
function getSelectionAnchorModuleId(editor: Editor): string | null {
  const { $anchor } = editor.state.selection
  for (let depth = $anchor.depth; depth >= 0; depth -= 1) {
    const moduleId = $anchor.node(depth).attrs.moduleId
    if (typeof moduleId === "string" && moduleId) return moduleId
  }
  return null
}
```

- [ ] 在当前 `onSelectionUpdate` 中先通知模块变化，再保留已有文本块通知：

```ts
onSourceCanvasModuleChangeRef.current?.(getSelectionAnchorModuleId(editor))
```

### Step 7: 添加顶部模块大纲按钮

- [ ] 导入 `ListTree`，在格式工具栏末尾增加可选按钮。只有传入 `onModuleOutlineVisibleChange` 时才渲染：

```tsx
<ToolbarIconButton
  label="模块大纲"
  icon={ListTree}
  isActive={moduleOutlineVisible}
  onClick={() => onModuleOutlineVisibleChange(!moduleOutlineVisible)}
/>
```

- [ ] 复用现有 `ToolbarIconButton` 和 `Button`，不修改 `apps/web/src/components/ui/*`。

### Step 8: 支持 outline 专用顶部偏移滚动

- [ ] 当 `options.topOffset` 未传入时，保留当前居中滚动行为。
- [ ] 当传入时，找到 `.td-editor-print-wrapper`，使用目标 rect 相对 viewport rect 计算内部滚动：

```ts
viewport.scrollTo({
  top: Math.max(0, viewport.scrollTop + targetRect.top - viewportRect.top - options.topOffset),
  behavior,
})
```

### Step 9: 运行聚焦测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx
```

- [ ] Expected: PASS。

### Step 10: 提交

- [ ] Run:

```powershell
git add apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx
git commit -m "feat(editor): 暴露原始画布模块选区联动"
```

## Task 3: 增加模块矩形与大纲偏好纯函数

**Files:**
- Create: `apps/web/src/features/revision/moduleInteractions.ts`
- Create: `apps/web/src/features/revision/moduleInteractions.test.ts`

### Step 1: 写入矩形切分测试

- [ ] 新建 `moduleInteractions.test.ts`，覆盖：
  - 同模块同页多个节点合并为一个矩形。
  - 模块跨过一个 `.rm-pagination-gap` 时生成两个 region。
  - 跨页 region 不覆盖 gap。
  - 缺失锚点节点只跳过该节点，不抛异常。

```ts
expect(buildModuleVisualRegions({
  anchors: [{ module_id: "mod_work", canvas_node_ids: ["title", "body"], title: "工作经历", order: 0 }],
  nodes: [
    { canvasNodeId: "title", rect: { top: 80, bottom: 104, left: 20, right: 500 } },
    { canvasNodeId: "body", rect: { top: 104, bottom: 300, left: 20, right: 500 } },
  ],
  gaps: [{ top: 180, bottom: 204 }],
})).toEqual([
  { moduleId: "mod_work", pageIndex: 0, top: 80, left: 20, width: 480, height: 100 },
  { moduleId: "mod_work", pageIndex: 1, top: 204, left: 20, width: 480, height: 96 },
])
```

### Step 2: 写入 clamp 与持久化测试

- [ ] 覆盖：
  - 浮窗拖出左上、右下时被 clamp 回可视区域。
  - `getDefaultModuleOutlinePosition()` 根据 viewport 和 outline 尺寸返回右上角安全位置。
  - localStorage 缺失或 JSON 损坏时返回默认值。
  - `visible`、`expanded`、`position` 按 `documentId` 使用不同 key。
  - 不保存 `activeModuleId` 和 `hoveredModuleId`。

### Step 3: 运行失败测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/features/revision/moduleInteractions.test.ts
```

- [ ] Expected: 文件尚不存在，测试失败。

### Step 4: 实现纯函数

- [ ] 在 `moduleInteractions.ts` 定义：

```ts
export type ModuleVisualRegion = {
  moduleId: string
  pageIndex: number
  top: number
  left: number
  width: number
  height: number
}

export type PersistedModuleOutlinePreferences = {
  visible: boolean
  expanded: boolean
  position: { x: number; y: number }
}
```

- [ ] 实现：
  - `moduleOutlineStorageKey(documentId)`
  - `loadModuleOutlinePreferences(documentId)`
  - `saveModuleOutlinePreferences(documentId, preferences)`
  - `getDefaultModuleOutlinePosition(viewportSize, outlineSize)`
  - `clampOutlinePosition(position, viewportSize, outlineSize)`
  - `buildModuleVisualRegions({ anchors, nodes, gaps })`

- [ ] `getDefaultModuleOutlinePosition()` 使用 12px 右侧安全间距和 48px 顶部安全间距；首次渲染没有已保存位置时，在测得 viewport 和 outline 尺寸后再计算，不把未测量占位值写入 localStorage。
- [ ] `buildModuleVisualRegions()` 先按 gap 切分每个节点 rect，再按 `moduleId + pageIndex` 合并 envelope。使用相对编辑区坐标，不读取 window 全局布局。

### Step 5: 运行测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/features/revision/moduleInteractions.test.ts
```

- [ ] Expected: PASS。

### Step 6: 提交

- [ ] Run:

```powershell
git add apps/web/src/features/revision/moduleInteractions.ts apps/web/src/features/revision/moduleInteractions.test.ts
git commit -m "feat(canvas): 增加模块矩形与大纲偏好计算"
```

## Task 4: 实现不拦截编辑的模块交互图层

**Files:**
- Create: `apps/web/src/features/revision/ModuleInteractionLayer.tsx`
- Create: `apps/web/src/features/revision/ModuleInteractionLayer.test.tsx`
- Modify: `apps/web/src/styles.css`

### Step 1: 写入图层组件测试

- [ ] 覆盖：
  - active region 输出淡蓝背景和边界。
  - hovered region 只输出更弱边界，不覆盖 active 状态。
  - 同一模块跨页时渲染两个 region。
  - 根图层具有 `pointer-events-none` 和 `td-module-interaction-only`。

```tsx
render(
  <ModuleInteractionLayer
    regions={[
      { moduleId: "mod_work", pageIndex: 0, top: 20, left: 16, width: 500, height: 120 },
      { moduleId: "mod_work", pageIndex: 1, top: 188, left: 16, width: 500, height: 90 },
    ]}
    activeModuleId="mod_work"
    hoveredModuleId={null}
  />,
)
expect(screen.getAllByTestId("module-region-mod_work")).toHaveLength(2)
```

### Step 2: 运行失败测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/features/revision/ModuleInteractionLayer.test.tsx
```

- [ ] Expected: 文件尚不存在，测试失败。

### Step 3: 实现纯视觉组件

- [ ] `ModuleInteractionLayer` 只接收已测量 regions 与两个运行时状态。每个矩形使用 absolute positioning，添加：

```tsx
data-state={region.moduleId === activeModuleId ? "active" : region.moduleId === hoveredModuleId ? "hovered" : undefined}
```

- [ ] 不增加点击事件，不读写 editor JSON，不使用 `dangerouslySetInnerHTML`。

### Step 4: 添加局部样式与打印隐藏

- [ ] 在 `apps/web/src/styles.css` 增加：

```css
.td-module-interaction-layer {
  pointer-events: none;
}

.td-module-interaction-region[data-state="active"] {
  outline: 1px solid rgb(59 130 246 / 55%);
  background: rgb(59 130 246 / 9%);
}

.td-module-interaction-region[data-state="hovered"] {
  outline: 1px solid rgb(59 130 246 / 35%);
  background: rgb(59 130 246 / 3%);
}

@media print {
  .td-module-interaction-only {
    display: none !important;
  }
}
```

- [ ] 删除旧的 `.td-source-resume-canvas [data-module-id]:hover` 节点级背景规则，避免出现逐行高亮与整体图层叠加。

### Step 5: 运行测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/features/revision/ModuleInteractionLayer.test.tsx
```

- [ ] Expected: PASS。

### Step 6: 提交

- [ ] Run:

```powershell
git add apps/web/src/features/revision/ModuleInteractionLayer.tsx apps/web/src/features/revision/ModuleInteractionLayer.test.tsx apps/web/src/styles.css
git commit -m "feat(canvas): 绘制跨页模块交互图层"
```

## Task 5: 实现可拖拽的大纲浮窗

**Files:**
- Create: `apps/web/src/features/revision/DraggableModuleOutline.tsx`
- Create: `apps/web/src/features/revision/DraggableModuleOutline.test.tsx`

### Step 1: 写入浮窗组件测试

- [ ] 覆盖：
  - 默认展开时显示大纲条目。
  - 点击现有箭头只切换展开状态。
  - active 模块条目带 `aria-current="true"` 或 `data-active`。
  - 点击条目先触发 `onActivateModule(moduleId)`，再触发 `onScrollToAnchor(anchor)`。
  - 标题栏区域可拖拽，箭头按钮 `pointerdown` 不开始拖拽。
  - 拖拽结束时只提交一次 clamp 后的位置。

### Step 2: 运行失败测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/features/revision/DraggableModuleOutline.test.tsx
```

- [ ] Expected: 文件尚不存在，测试失败。

### Step 3: 实现浮窗

- [ ] 从当前 `DraftCanvas.tsx` 搬出已有大纲 UI，保留现有 `ListTree` 标题和 `ChevronDown` 按钮。
- [ ] 新 props：

```ts
type DraggableModuleOutlineProps = {
  anchors: ModuleAnchor[]
  activeModuleId: string | null
  expanded: boolean
  position: { x: number; y: number }
  saveStatus: DraftCanvasSaveStatus
  onRetrySave?: () => void
  onExpandedChange: (expanded: boolean) => void
  onPositionCommit: (position: { x: number; y: number }) => void
  onActivateModule: (moduleId: string) => void
  onScrollToAnchor: (anchor: ModuleAnchor) => void
}
```

- [ ] 使用标题栏作为 drag handle；箭头按钮阻止 pointerdown 冒泡。
- [ ] 使用 Pointer Events 和 pointer capture，移动过程只更新组件本地临时位置，pointerup 时才调用 `onPositionCommit()`。
- [ ] 外层添加 `td-module-interaction-only`，确保打印隐藏。

### Step 4: 运行测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/features/revision/DraggableModuleOutline.test.tsx
```

- [ ] Expected: PASS。

### Step 5: 提交

- [ ] Run:

```powershell
git add apps/web/src/features/revision/DraggableModuleOutline.tsx apps/web/src/features/revision/DraggableModuleOutline.test.tsx
git commit -m "feat(canvas): 增加可拖拽模块大纲"
```

## Task 6: 在 DraftCanvas 中编排测量、状态和双向联动

**Files:**
- Modify: `apps/web/src/features/revision/DraftCanvas.tsx`
- Modify: `apps/web/src/features/revision/DraftCanvas.test.tsx`
- Modify: `apps/web/src/styles.css`

### Step 1: 扩展 DraftCanvas mock editor

- [ ] 在 `DraftCanvas.test.tsx` 的 mock 中暴露：
  - `onSourceCanvasModuleChange`
  - `moduleOutlineVisible`
  - `onModuleOutlineVisibleChange`
  - 可供测试触发的模块变化 callback
  - `scrollToCanvasNode`

### Step 2: 写入双向联动失败测试

- [ ] 覆盖：
  - 编辑器通知 `mod_1` 后，大纲对应条目激活。
  - 编辑器通知 `null` 后，取消大纲高亮。
  - 点击大纲条目后立即激活，并调用：

```ts
expect(editorMocks.scrollToCanvasNode).toHaveBeenCalledWith("node_project", { topOffset: 16 })
```

  - toolbar 关闭大纲后浮窗隐藏，但 `ModuleInteractionLayer` 仍收到 active 模块。
  - hover 另一个模块时不改变 active 大纲条目。

### Step 3: 写入持久化和越界修正失败测试

- [ ] 覆盖：
  - `doc_1` 与 `doc_2` 使用独立 localStorage key。
  - 展开、收起、显隐和 drag commit 后写入偏好。
  - 容器 resize 后重新 clamp 位置。
  - 重开浮窗恢复上次位置和展开状态。

### Step 4: 运行失败测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/features/revision/DraftCanvas.test.tsx
```

- [ ] Expected: 新交互尚未编排，测试失败。

### Step 5: 改造 DraftCanvas

- [ ] 保留 `anchors` 排序。
- [ ] 增加：

```ts
const canvasRootRef = useRef<HTMLDivElement>(null)
const [activeModuleId, setActiveModuleId] = useState<string | null>(null)
const [hoveredModuleId, setHoveredModuleId] = useState<string | null>(null)
const [outlinePreferences, setOutlinePreferences] = useState(
  () => loadModuleOutlinePreferences(canvas.document_id),
)
const [outlinePosition, setOutlinePosition] = useState(
  () => outlinePreferences?.position ?? null,
)
const [regions, setRegions] = useState<ModuleVisualRegion[]>([])
```

- [ ] 当 `canvas.document_id` 改变时重新加载该工作台偏好并清空 active/hover。
- [ ] 如果当前工作台没有已保存位置，在首次测得 viewport 和 outline 尺寸后调用 `getDefaultModuleOutlinePosition()`，得到右上角安全位置。未测量状态不写入 localStorage。
- [ ] `scrollToAnchor()` 先设 active，再调用：

```ts
editorRef.current?.scrollToCanvasNode(firstNodeId, { topOffset: 16 })
```

### Step 6: 测量真实 DOM

- [ ] 在 `DraftCanvas.tsx` 增加受控 `scheduleMeasure()`：
  - 在 `requestAnimationFrame` 中读取 `[data-canvas-node-id]` rect。
  - 读取 `.rm-pagination-gap` rect。
  - 转成相对 `.td-source-resume-canvas` 坐标。
  - 调用 `buildModuleVisualRegions()`。
  - 使用 `ResizeObserver` 观察编辑区、`.td-editor-print-wrapper` 和 ProseMirror root。
  - 正文变化和 `canvas.module_anchors` 变化时重新安排测量。
  - cleanup 时取消待执行 frame 并 disconnect observer。

### Step 7: 增加 hover 委托

- [ ] 在 `.td-source-resume-canvas` wrapper 上使用事件委托：
  - `pointerover` 找最近的 `[data-module-id]`。
  - `pointerleave` 清除 hover。
  - hover 只更新 `hoveredModuleId`，绝不更新 active。

### Step 8: 组合子组件

- [ ] 渲染：

```tsx
<ModuleInteractionLayer
  regions={regions}
  activeModuleId={activeModuleId}
  hoveredModuleId={hoveredModuleId}
/>
```

- [ ] 仅当 `outlinePreferences.visible` 时渲染 `DraggableModuleOutline`。
- [ ] 给 `ResumeRichTextEditor` 传入 toolbar 控制和模块选区回调。
- [ ] 浮窗位置变化、展开变化和显隐变化通过 `saveModuleOutlinePreferences()` 写 localStorage；active/hover 不持久化。

### Step 9: 运行聚焦测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/features/revision/moduleInteractions.test.ts src/features/revision/ModuleInteractionLayer.test.tsx src/features/revision/DraggableModuleOutline.test.tsx src/features/revision/DraftCanvas.test.tsx src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx
```

- [ ] Expected: PASS。

### Step 10: 提交

- [ ] Run:

```powershell
git add apps/web/src/features/revision/DraftCanvas.tsx apps/web/src/features/revision/DraftCanvas.test.tsx apps/web/src/styles.css
git commit -m "feat(canvas): 联动原始画布与模块大纲"
```

## Task 7: 加固保存与导出隔离回归

**Files:**
- Modify: `apps/web/src/features/revision/DraftCanvas.test.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
- Modify: `services/sidecar/tests/test_revision_export_gate.py`

### Step 1: 添加 Web 保存隔离断言

- [ ] 在 `DraftCanvas.test.tsx` 中激活模块、hover 模块、移动大纲后触发编辑器 `onChange`，断言传给上层的 `docJson` 不出现：

```ts
expect(JSON.stringify(docJson)).not.toMatch(/activeModuleId|hoveredModuleId|outline|position/)
```

- [ ] 在 `RevisionWorkspacePage.test.tsx` 现有 autosave 测试中保留 API body 断言，并追加交互态缺失断言。

### Step 2: 添加导出 HTML 隔离断言

- [ ] 在 `test_export_gate_writes_pdf_artifact_and_marks_draft_exported()` 使用记录 HTML 的 fake renderer，断言：

```py
assert "td-module-interaction-layer" not in rendered_html
assert "td-module-interaction-only" not in rendered_html
assert "模块大纲" not in rendered_html
```

- [ ] 该测试明确证明导出仍来自 `render_projection`，不是 Web 编辑 DOM。

### Step 3: 运行隔离回归测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/features/revision/DraftCanvas.test.tsx src/features/revision/RevisionWorkspacePage.test.tsx
corepack pnpm --filter @typedance/sidecar exec pytest tests/test_revision_export_gate.py tests/test_revision_services.py -q
```

- [ ] Expected: PASS。

### Step 4: 提交

- [ ] Run:

```powershell
git add apps/web/src/features/revision/DraftCanvas.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx services/sidecar/tests/test_revision_export_gate.py
git commit -m "test(canvas): 加固模块交互态导出隔离"
```

## Task 8: 增加 2-3 张 A4 的浏览器回归

**Files:**
- Create: `apps/web/e2e/source-resume-canvas-module-interactions.spec.ts`

### Step 1: 构造长简历 workspace fixture

- [ ] 在 Playwright spec 内构造 `doc_long` workspace fixture：
  - 至少 3 个模块。
  - 工作经历模块内容足够长，跨越第 1、2 张 A4。
  - 项目经历模块位于第 3 张 A4。
  - 每个标题节点和正文节点都有 `canvasNodeId` 与 `moduleId`。

- [ ] 使用以下拦截返回 fixture：

```ts
await page.route("http://127.0.0.1:4317/documents/doc_long/workspace-view", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(longWorkspace),
  })
})
await page.route("http://127.0.0.1:4317/documents/doc_long/source-resume-canvas", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(longWorkspace.source_resume_canvas),
  })
})
```

### Step 2: 验证跨页矩形和分页间隙

- [ ] 导航到：

```ts
await page.goto("/packs/resume/workspaces/doc_long")
```

- [ ] 点击“工作经历”大纲项，断言：
  - 大纲项 active。
  - `[data-testid="module-region-mod_work"]` 至少有两个。
  - 每个 region rect 都不与 `.rm-pagination-gap` rect 相交。

### Step 3: 验证跨页滚动与模块激活

- [ ] 点击第 3 页“项目经历”，断言：
  - `mod_project` 大纲项 active。
  - 内部 `.td-editor-print-wrapper.scrollTop` 增加。
  - 第一个项目节点 top 位于编辑区可视顶部下方，允许 8px 测量误差。

### Step 4: 验证拖拽、刷新与工作台隔离

- [ ] 拖拽大纲到左下区域，断言浮窗仍处于 `.td-source-resume-canvas` 可视 bounds 内。
- [ ] 刷新页面，断言位置与展开状态恢复。
- [ ] 再 mock `doc_other` 并打开 `/packs/resume/workspaces/doc_other`，断言使用默认偏好，不继承 `doc_long`。

### Step 5: 验证隐藏大纲不隐藏模块图层

- [ ] 点击顶部“模块大纲”按钮隐藏浮窗，断言：
  - 大纲浮窗不存在。
  - 当前 active module region 仍存在。
- [ ] 再次点击恢复浮窗，断言保存的位置与展开状态不变。

### Step 6: 运行浏览器测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web test:e2e -- source-resume-canvas-module-interactions.spec.ts
```

- [ ] Expected: PASS。

### Step 7: 人工核对导出视觉

- [ ] 启动 sidecar 与 Web：

```powershell
corepack pnpm --filter @typedance/sidecar dev
corepack pnpm --filter @typedance/web dev
```

- [ ] 在真实 2-3 页旧简历工作台中激活模块并拖拽大纲，然后执行导出。
- [ ] 渲染生成 PDF 或直接打开 PDF，确认页面中不存在淡蓝模块背景、边界和大纲浮窗。
- [ ] 记录导出文件路径与核对结果。

### Step 8: 提交

- [ ] Run:

```powershell
git add apps/web/e2e/source-resume-canvas-module-interactions.spec.ts
git commit -m "test(canvas): 覆盖多页模块联动交互"
```

## Task 9: 全量验证与收尾

**Files:**
- Verify only

### Step 1: 运行 Web 聚焦测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web exec vitest run src/features/revision/moduleInteractions.test.ts src/features/revision/ModuleInteractionLayer.test.tsx src/features/revision/DraggableModuleOutline.test.tsx src/features/revision/DraftCanvas.test.tsx src/features/revision/RevisionWorkspacePage.test.tsx src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx
```

- [ ] Expected: PASS。

### Step 2: 运行 sidecar 聚焦测试

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/sidecar exec pytest tests/test_revision_source_canvas.py tests/test_revision_import_flow.py tests/test_revision_services.py tests/test_revision_export_gate.py -q
```

- [ ] Expected: PASS。

### Step 3: 运行多页 Playwright 回归

- [ ] Run:

```powershell
corepack pnpm --filter @typedance/web test:e2e -- source-resume-canvas-module-interactions.spec.ts
```

- [ ] Expected: PASS。

### Step 4: 运行全量质量门禁

- [ ] Run:

```powershell
corepack pnpm lint
corepack pnpm build
corepack pnpm test
```

- [ ] Expected: PASS。

### Step 5: 检查没有交互态进入正文和导出链路

- [ ] Run:

```powershell
rg -n "activeModuleId|hoveredModuleId|td-module-interaction|模块大纲" services/sidecar packages/resume-renderer
```

- [ ] Expected:
  - `services/sidecar/tests/test_revision_export_gate.py` 中允许出现隔离断言。
  - sidecar 生产代码与 `packages/resume-renderer` 不应出现 Web 交互态类名或状态字段。

### Step 6: 检查工作区和提交历史

- [ ] Run:

```powershell
git status --short --branch
git log --oneline --decorate -10
```

- [ ] Expected: 工作区干净，提交均符合 Conventional Commits。

## 验收清单

- [ ] 点击、键入或选择模块内容后，完整模块区域激活。
- [ ] 反向跨模块拖选时，只激活 selection `$anchor` 所在模块。
- [ ] 点击未识别区域后清除激活态和大纲高亮。
- [ ] 模块标题行参与选中反馈。
- [ ] hover 只显示弱边界，不抢占 active 状态。
- [ ] 点击大纲项后立即激活，并滚动到模块顶部下方。
- [ ] 顶部工具栏可以隐藏和恢复大纲。
- [ ] 大纲使用现有箭头展开、收起，标题栏可以拖拽。
- [ ] 大纲位置、显隐和展开状态按 `documentId` 持久化。
- [ ] 跨页模块在每张 A4 内分别绘制 region，gap 不被覆盖。
- [ ] 保存正文不包含任何交互状态。
- [ ] HTML/PDF 导出不包含任何模块交互图层或大纲浮窗。
