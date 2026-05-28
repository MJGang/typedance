# 第一阶段：旧简历原始画布与结构识别层设计

## 背景

当前工作台已经具备 Revision Workspace、结构化模块、问题处理、质量门禁和渲染结果等能力，但主编辑区仍然偏向“结构化草稿预览”：`RevisionWorkspacePage` 优先展示 `render_projection.html` iframe，缺少用户导入旧简历后“我的简历还在”的第一视觉帧。

本设计采用方案 B：把“用户看到和编辑的原始简历画布”与“系统理解的结构化模块”分离。第一阶段只解决旧简历从死文件变成活模块，不引入第二阶段的智能 Diff、知识库检索或证据系统。

## 产品原则

1. 用户进入工作台后，主编辑区直接展示导入旧简历转换后的原始内容。
2. 原始内容不经过 AI 改写、润色、重排或专业化表达增强。
3. `ResumeRichTextEditor` 作为第一阶段主画布，负责 A4 页面感、默认模板样式和直接文字编辑。
4. 模块识别是叠加在画布上的结构层，用于 hover 边界、大纲跳转和后续交互，不替换画布正文。
5. 知识库不包含本次导入的原始简历；知识库也不在第一阶段解析、预处理或参与画布生成。

## 非目标

第一阶段不做以下内容：

- AI 初版推荐开关。
- 红绿 Diff View。
- 错别字、标点、表达问题的诊断图层。
- 逐条接受或拒绝 AI 建议。
- 知识库实时扫描、RAG 检索、证据匹配。
- PDF 或 Word 的像素级版式还原。
- 将 AI 结构化草稿作为主编辑区内容。

这些能力属于第二阶段或后续阶段，需要在独立方案中讨论。

## 核心分层

```text
旧简历输入
PDF / Word / 粘贴文本 / 新建空白

→ 原始数据转换层
生成 SourceResumeCanvas
尽量保留原文内容、顺序、段落、标题、列表和基础排版意图

→ ResumeRichTextEditor 编辑区
展示 SourceResumeCanvas.docJson
用户在这里直接编辑文字

→ 结构识别层
识别个人信息、职业技能、工作经历、项目经历等模块
为画布节点建立模块锚点、大纲跳转和 hover 边界
```

知识库在第一阶段不进入这条链路。后续阶段如果需要 AI 强化表达或事实验证，再按需实时扫描知识库。

## 关键数据概念

### OldResumeSource

本次工作台的旧简历输入源。它可以来自上传文件、粘贴文本或空白新建，不属于长期知识库。

建议语义上与知识库材料分离，避免把旧简历误当成用户长期资料池的一部分。

### SourceResumeCanvas

旧简历在系统内部的可编辑画布形态。它不是 AI 生成的新简历，而是原始简历转换成 `ResumeRichTextEditor` 可渲染的 `docJson`。

建议字段：

```ts
type SourceResumeCanvas = {
  id: string
  document_id: string
  old_resume_source_id: string
  doc_json: Record<string, unknown>
  node_map: SourceResumeCanvasNode[]
  created_at: string
  updated_at: string
}
```

### SourceResumeCanvasNode

画布中的可定位文本容器。节点粒度是段落、标题、列表项等，不是每个字。

```ts
type SourceResumeCanvasNode = {
  canvas_node_id: string
  node_type: "heading" | "paragraph" | "list_item" | "table_cell" | "unknown"
  text: string
  source_span?: {
    page?: number
    line?: number
    block_index?: number
  }
  module_id?: string
}
```

字词级高亮不需要每个字都有 ID。后续阶段可以用 `canvas_node_id + start_offset + end_offset` 定位到节点里的具体字词。

### ModuleAnchor

模块锚点连接结构识别结果和画布节点。

```ts
type ModuleAnchor = {
  module_id: string
  canvas_node_ids: string[]
  title: string
  order: number
}
```

模块可以解释画布，但不能接管或重写画布正文。

## 与现有概念的关系

### render_projection

`render_projection` 仍可用于后续导出、AI 改稿版本或正式草稿预览，但第一阶段不再作为工作台主编辑区的数据源。

当前 `DraftProjectionBuilder` 会从结构化模块生成 `render_projection.doc_json`。这份数据是结构化草稿渲染结果，不应替代原始画布。

### ParsedBlock

旧简历可以被解析成基础块，用于生成 `SourceResumeCanvas` 和模块锚点。这里的解析只针对本次旧简历输入，不代表解析知识库。

### DocumentModule / DocumentClaim

模块和主张来自对旧简历画布的结构识别。第一阶段只需要模块能定位到画布节点，支持边界和大纲。

`DocumentClaim`、证据关系和 AI 建议可以后续继续扩展，但不进入第一阶段交付范围。

## 前端交互

第一阶段工作台主区建议拆成：

```text
DraftCanvas
├─ ResumeRichTextEditor
├─ ModuleBoundaryLayer
└─ CollapsibleOutline
```

`DraftCanvas` 的职责：

1. 使用 `SourceResumeCanvas.doc_json` 渲染 A4 编辑区。
2. 允许用户直接点击文字编辑。
3. 根据 `ModuleAnchor` 在 hover 时显示淡蓝色模块边界。
4. 在右上角展示可折叠大纲。
5. 点击大纲条目时滚动到对应模块起始节点。

大纲使用模块层级和顺序展示。缩进表达模块关系，但不在第一阶段提供复杂拖拽管理。

## 编辑行为

用户编辑画布正文时，系统更新 `SourceResumeCanvas.doc_json`。旧简历原始文件本身不被反向修改。

如果编辑发生在已有 `canvas_node_id` 内，节点 ID 应尽量保持稳定。若用户把一个节点拆分或合并，系统可以在保存时重新计算 `node_map`，并把模块锚点标记为需要刷新。

第一阶段不要求编辑后自动重新运行全部 AI 分析，但需要避免静默使用过期锚点造成错误定位。

## 第二阶段预留点

第一阶段只预留，不实现：

- `canvas_node_id + offset` 可定位字词级问题。
- 模块锚点可作为 Diff 和诊断的挂载点。
- 知识库作为实时检索源，不在第一阶段预处理。
- AI Suggested 模式将来应作为叠加视图，不覆盖 Original 画布。

## 验收标准

1. 用户导入旧简历进入工作台后，主编辑区显示 `ResumeRichTextEditor` A4 画布，而不是 iframe 或结构化模块列表。
2. 画布内容来自旧简历原始转换结果，不使用 AI 重写后的结构化草稿。
3. 画布支持直接文字编辑。
4. 鼠标悬停模块区域时显示轻量淡蓝边界。
5. 编辑区右上角有可折叠大纲。
6. 点击大纲模块时，画布滚动到对应内容位置。
7. 第一阶段不解析知识库，不把旧简历放入知识库概念，不展示 AI Diff 或诊断图层。

## 决策记录

- 采用方案 B：原始画布数据与结构识别层分离。
- 第一阶段选择 `ResumeRichTextEditor` 作为主画布。
- 原始数据转换层必须保留稳定节点 ID 和模块锚点，便于第二阶段扩展。
- 知识库能力隔离到后续阶段，不进入第一阶段实现。
