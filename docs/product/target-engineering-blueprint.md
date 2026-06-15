# TypeDance 目标工程蓝图

> 状态：终局工程蓝图  
> 适用范围：从当前 `ResumeVersion + doc_json + template_id` 系统，重构为 AI-native Revision Engine + Resume Pack 的目标工程形态。  
> 重要说明：本文不是“先做简单版再慢慢迭代”的路线图，而是最终工程边界。后续任何实现计划都应以本文为目标形态拆解。

## 1. 工程目标

TypeDance 的目标工程形态不是一个更强的富文本编辑器。

目标系统应由五个核心层组成：

```text
Contracts
  定义所有跨前后端的稳定对象和 schema。

Revision Engine
  管理来源、草稿、问题、建议、证据、版本和工作台视图。

Sidecar Business Runtime
  提供确定性的本地业务 API、文件解析、存储和 MCP 工具。

TS Agent Host + Harness Core
  根据当前 pack 加载 AI plugins，并负责 HarnessRun、模型循环、工具调用、权限和事件流。

Revision Workspace
  把结构化对象映射成自然的改稿体验。
```

Renderer 仍然重要，但它不再拥有产品事实源。

```text
DraftVersion -> RenderProjection -> doc_json / HTML / PDF
```

## 2. 目标仓库边界

### 2.1 `packages/contracts`

定位：

```text
跨前端、sidecar、Agent Host 和 Harness Runtime 的事实 schema 层。
```

目标职责：

- 定义 Document、SourceDocument、DraftVersion、DocumentModule。
- 定义 DocumentClaim、EvidenceLink、RevisionIssue、RevisionProposal。
- 定义 RenderProjection、ExportArtifact。
- 通过 `@typedance/harness-contracts` 复用 HarnessRun、HarnessEvent 等通用 run 合约，不在 revision 领域自建 run schema。
- 定义 WorkspaceView 聚合响应。
- 定义 Resume Pack 的 module / issue / action / quality rule 枚举。
- 旧编辑器 `ResumeVersion` 仅属于旧编辑器数据模型，不参与当前 AI 路径。

不应承担：

- UI 状态。
- prompt 文案。
- 具体渲染 CSS。
- Agent 私有中间输出。

### 2.2 `packages/resume-renderer`

定位：

```text
把 RenderProjection 转成可预览和可导出的文档。
```

目标职责：

- 接收结构化 Draft 或 RenderProjection。
- 输出 HTML。
- 输出 TipTap / ProseMirror `doc_json` 渲染投影。
- 输出布局警告。
- 复用默认 A4 模板。

不应承担：

- 简历质量判断。
- 证据判断。
- Issue / Proposal 生成。
- 直接读取来源材料。

### 2.3 `services/sidecar`

定位：

```text
本地优先业务服务。
```

目标职责：

- 本地数据库。
- 来源材料存储。
- 文件解析和 ParsedBlock。
- Draft / Issue / Proposal / Evidence 服务。
- WorkspaceView 聚合。
- Render 和 Export。
- 向 Agent Host 暴露可授权调用的 HTTP API 和 MCP tools。

不应承担：

- 前端布局逻辑。
- UI 文案拼接。
- 模型调用。
- agent/skill/plugin 编排。
- HarnessRun 生命周期管理。
- 无 schema 的 AI 输出透传。

### 2.4 `apps/web`

定位：

```text
Revision Workspace 用户体验层。
```

目标职责：

- 展示新版草稿。
- 展示问题卡。
- 展示局部对比。
- 展示来源证据。
- 收集用户确认、补充事实和选择动作。
- 调用 Workspace API。
- 触发导出。

不应承担：

- 直接拼装 Agent prompt。
- 直接解释 Agent 原始输出。
- 把 AI 字符串直接写入最终稿。
- 把样式面板作为主工作流。

## 3. 目标目录结构

### 3.1 Contracts

```text
packages/contracts/src/
  legacy/
    resume-version.ts
    template-style.ts
  revision/
    document.ts
    source.ts
    draft.ts
    module.ts
    claim.ts
    evidence.ts
    issue.ts
    proposal.ts
    render.ts
    workspace-view.ts
  harness/
    index.ts
  packs/
    document-pack.ts
    resume-pack.ts
  index.ts
```

关键约束：

```text
legacy/* 只能被兼容层和 renderer 使用。
revision/* 是新事实源。
packs/* 定义文档类型规则，不混入 UI。
```

### 3.2 Sidecar

```text
services/sidecar/src/typedance_sidecar/
  legacy/
    resume_versions.py
    template_styles.py
  revision/
    models.py
    repositories.py
    source_service.py
    parse_service.py
    draft_service.py
    issue_service.py
    proposal_service.py
    evidence_service.py
    workspace_service.py
    render_service.py
    export_service.py
  packs/
    registry.py
    resume_pack.py
  mcp/
    resume_tools.py
  api/
    documents.py
    sources.py
    drafts.py
    issues.py
    proposals.py
    claims.py
    exports.py
```

关键约束：

```text
Sidecar API 只能描述业务对象；AI run API 属于 TS Agent Host。
```

### 3.3 Agent Host 与 Harness

```text
packages/agent-host/src/
  index.ts
  plugin-config.ts

packages/harness-contracts/src/
  index.ts
  run.ts
  events.ts
  plugin.ts
  tool.ts
  permission.ts

packages/harness-core/src/
  runtime.ts
  plugin-registry.ts
  permissions.ts
  memory.ts
  verification.ts

packages/harness-server/src/
  server.ts
```

关键约束：

```text
Agent Host 可以理解 pack 与 plugin 的绑定。
Harness Core 不允许出现 TypeDance、resume、pack、Document 等业务概念。
```

### 3.4 Web

```text
apps/web/src/features/revision-workspace/
  api.ts
  types.ts
  RevisionWorkspacePage.tsx
  components/
    DraftCanvas.tsx
    ModuleNavigator.tsx
    IssueQueue.tsx
    IssueDetail.tsx
    ProposalDiff.tsx
    EvidenceDrawer.tsx
    SourceDrawer.tsx
    ContextualInput.tsx
    QualityGatePanel.tsx
    ExportPanel.tsx
  state/
    workspace-view.ts
    issue-selection.ts
    draft-patches.ts
```

现有：

```text
apps/web/src/features/workspace/
```

可作为编辑器能力和导出体验的来源，但终局主页面应迁移到 `revision-workspace`。

## 4. 目标数据流

### 4.1 导入旧简历

```text
Web
  POST /documents
  POST /documents/{document_id}/sources
  POST /packs/resume/runs

Sidecar
  Source Service 保存原始来源
  暴露解析、保存、草稿、问题、证据等业务能力和 MCP 工具

TS Agent Host
  将 resume pack 映射为当前可用 plugins
  创建 HarnessRun(action = import_reconstruct)

Harness Runtime
  在 capability_policy 边界内驱动模型、工具、权限、上下文和事件流
  通过 MCP/HTTP 调用 Sidecar 业务能力

Sidecar
  Draft Service 保存 DraftVersion
  Issue Service 保存 RevisionIssue
  Proposal Service 保存 RevisionProposal
  Evidence Service 保存 EvidenceLink
  Render Service 创建 RenderProjection
  Workspace Service 聚合 WorkspaceView

Web
  GET /documents/{document_id}/workspace-view
  展示新版草稿、问题卡、来源证据和局部对比
```

### 4.2 用户接受修改

```text
Web
  POST /proposals/{proposal_id}/accept

Sidecar
  Proposal Service 校验 proposal 状态
  Draft Service 应用 DraftPatch
  Issue Service 更新关联问题
  Evidence Service 检查确认要求
  Render Service 更新 RenderProjection
  Workspace Service 返回新 WorkspaceView
```

### 4.3 用户补充事实

```text
Web
  POST /documents/{document_id}/sources
    source_type = manual_user_input
    related_issue_id = xxx

Sidecar
  保存为 SourceDocument
  创建 ParsedBlock

TS Agent Host / Harness Runtime
  创建当前 pack 的补充事实处理 run
  必要时调用证据评估、重写和提案生成 plugin

Sidecar
  保存 AI 产出的结构化 Proposal / Evidence 结果
  WorkspaceView 更新
```

### 4.4 导出

```text
Web
  POST /drafts/{draft_id}/export

Sidecar
  QualityGate 检查 blocking issue
  Render Service 生成最终 HTML/PDF 输入
  Export Service 输出 PDF
  ExportArtifact 记录文件和 Draft 关系
```

## 5. API 目标面

### 5.1 Documents

```text
POST /documents
GET /documents
GET /documents/{document_id}
PATCH /documents/{document_id}
DELETE /documents/{document_id}
```

`POST /documents` 创建的是改稿项目，不是简历版本。

### 5.2 Sources

```text
POST /documents/{document_id}/sources
GET /documents/{document_id}/sources
GET /sources/{source_id}
GET /sources/{source_id}/parsed-blocks
DELETE /sources/{source_id}
```

上传文件、粘贴文本、手动补充都进入 Source Service。

### 5.3 Agent Runs

```text
POST /packs/{pack_id}/runs
GET /runs/{run_id}
GET /runs/{run_id}/events
POST /runs/{run_id}/input
POST /runs/{run_id}/cancel
POST /permissions/{request_id}/resolve
```

`action` 由当前 pack 的 TS plugin 配置解释，常见值包括：

```text
import_reconstruct
blank_guided_generate
quality_review
issue_action
module_rewrite
evidence_check
opportunity_calibrate
review_gate
```

### 5.4 Drafts

```text
GET /drafts/{draft_id}
POST /drafts/{draft_id}/accept
POST /drafts/{draft_id}/render
GET /documents/{document_id}/drafts
```

Draft 是结构化草稿，不是 `doc_json`。

### 5.5 Issues

```text
GET /drafts/{draft_id}/issues
GET /issues/{issue_id}
POST /issues/{issue_id}/dismiss
POST /issues/{issue_id}/actions/{action_id}
```

用户处理的是 Issue 和 Action，而不是 prompt。

### 5.6 Proposals

```text
GET /proposals/{proposal_id}
POST /proposals/{proposal_id}/accept
POST /proposals/{proposal_id}/reject
POST /proposals/{proposal_id}/revise
```

Proposal 是 AI 修改的最小可决策单位。

### 5.7 Evidence

```text
GET /claims/{claim_id}/evidence
POST /claims/{claim_id}/confirm
POST /evidence-links/{evidence_link_id}/confirm
```

所有强主张都必须能进入 Evidence 或 Confirmation 流。

### 5.8 Workspace View

```text
GET /documents/{document_id}/workspace-view
```

这是前端主读取接口。

前端不应同时拉一堆底层接口自行拼接主工作台。

### 5.9 Export

```text
POST /drafts/{draft_id}/export/pdf
POST /drafts/{draft_id}/export/html
GET /exports/{export_id}
```

Legacy：

```text
POST /exports/pdf/{resume_id}
POST /exports/html/{resume_id}
```

可保留，但应标注为兼容旧 `ResumeVersion`。

## 6. WorkspaceView 合约

`WorkspaceView` 是前端页面的唯一主数据源。

```ts
type WorkspaceView = {
  document: DocumentSummary
  current_draft: DraftVersion
  modules: DocumentModule[]
  claims: DocumentClaim[]
  issues: RevisionIssue[]
  proposals: RevisionProposal[]
  evidence: EvidenceLink[]
  source_summaries: SourceDocumentSummary[]
  selected_quality_gate: QualityGateResult
  render_projection: RenderProjection
  coach_summary: CoachSummary
  available_actions: ContextualAction[]
}
```

前端状态只能围绕这个视图做局部选择：

```text
selectedIssueId
selectedModuleId
selectedClaimId
openDrawer
pendingActionId
localDraftEditState
```

不能把 Agent 输出、prompt 响应或 `doc_json` 当主状态。

## 7. Agent 输出边界

Harness Runtime 的基本规则：

```text
Agent 可以分析和建议。
Agent 不能直接写 accepted Draft。
Agent 输出必须符合 schema。
Agent 输出必须落入领域对象。
Agent 失败不能污染 Draft。
```

每个 Agent 输出都必须包含：

```text
run_id
agent_name
output_type
schema_version
confidence
warnings
payload
```

典型输出：

```text
ParsedResumeOutput
StructuredResumeOutput
ReviewIssuesOutput
RewriteProposalsOutput
EvidenceVerificationOutput
OpportunityCalibrationOutput
RenderPlanOutput
```

禁止输出：

```text
"这里是我帮你优化后的简历：..."
```

除非它只是附属解释，且核心内容已经结构化。

## 8. Pack Runtime 边界

Resume Pack 不是一组 prompt，而是规则包。

目标结构：

```ts
type DocumentPack = {
  id: "resume"
  version: string
  modules: ModuleSpec[]
  issue_types: IssueTypeSpec[]
  actions: ActionSpec[]
  quality_rules: QualityRule[]
  evidence_rules: EvidenceRule[]
  render_mapping: RenderMapping
}
```

DocumentPack 只描述产品语义和业务规则。AI plugin、agent、skill、MCP 暴露关系由 TS Agent Host 的 pack plugin 配置维护，不能写入 Python Pack manifest。

Pack 负责决定：

- 哪些模块存在。
- 哪些问题需要标记。
- 哪些动作可执行。
- 哪些主张需要证据。
- 哪些字段进入默认模板。

组件和 API 不应散落这些规则。

## 9. 存储目标

本地 SQLite 可以继续作为默认存储。

目标表按领域拆分：

```text
documents
source_documents
parsed_blocks
draft_versions
document_modules
document_claims
evidence_links
revision_issues
revision_proposals
revision_actions
user_confirmations
render_projections
export_artifacts
```

每个表都需要：

- `id`
- 关联外键
- `created_at`
- 必要时 `updated_at`
- schema version 或 payload version

JSON 字段可以存在，但不能让整个系统退化成单表大 JSON。

## 10. 前端页面目标

### 10.1 首页

首页入口应是任务入口，不是模板入口。

关键入口：

- 导入旧简历。
- 新建基础简历。
- 打开已有改稿项目。
- 针对岗位调整。

模板可以作为次级入口或设置项。

### 10.2 Revision Workspace

主页面结构：

```text
TopBar
  文档名 / 版本状态 / 导出 / 运行状态

MainCanvas
  新版草稿
  模块锚点
  Claim 状态标记

TaskRail
  问题卡
  待确认
  导出阻塞

ContextPanel
  局部对比
  Proposal 操作
  Evidence
  来源片段

ContextualInput
  补充事实 / 说明偏好 / 追问当前问题
```

### 10.3 小屏

小屏使用：

```text
Draft tab
Issues tab
Sources drawer
Issue detail sheet
```

不能强制三栏。

### 10.4 样式和模板

样式面板默认不进入主工作台。

默认模板应满足大多数场景。

高级样式能力可以保留为：

- 设置。
- 高级模式。
- 内部调试。
- 模板维护页。

## 11. 旧编辑器数据边界

当前系统中的 `ResumeVersion` 属于旧编辑器数据模型。它可以继续服务旧编辑器页面和渲染器复用，但不能作为新 AI 工作台的事实源，也不能作为 AI run 的投影目标。

允许关系：

```text
DraftVersion -> RenderProjection -> renderer/export
旧 ResumeVersion -> renderer/export
```

旧编辑器数据层职责：

- 让现有 PDF 导出链路可复用。
- 让旧编辑器数据可继续打开。

旧编辑器数据层不能承担：

- Issue 状态。
- Evidence 状态。
- Agent 输出状态。
- Draft 事实源。

## 12. 测试目标

### 12.1 Contract Tests

必须覆盖：

- revision schema。
- resume pack schema。
- workspace view schema。
- 旧编辑器数据 schema 与当前 AI 工作台 schema 的隔离。

### 12.2 Service Tests

必须覆盖：

- 创建 Document。
- 添加 Source。
- 生成 ParsedBlock。
- 创建 HarnessRun。
- 保存 Draft。
- 应用 Proposal。
- 确认 Claim。
- 生成 RenderProjection。
- 导出 ExportArtifact。

### 12.3 Agent Output Tests

必须覆盖：

- Agent 输出 schema 校验失败时不写 Draft。
- 强主张缺证据时生成 blocking 或 confirmation issue。
- Rewriter 输出必须生成 Proposal，而不是直接更新 Draft。

### 12.4 Workspace Tests

必须覆盖：

- WorkspaceView 包含页面所需数据。
- 点击 Issue 能定位模块和 Proposal。
- 接受 Proposal 后 Issue / Draft / RenderProjection 同步更新。
- 小屏布局不丢失问题处理能力。

### 12.5 Render Tests

必须覆盖：

- Draft 到 HTML。
- Draft 到 doc_json。
- Draft 到 PDF。
- layout warning。
- 默认模板中文和英文。

## 13. 工程完成定义

当系统满足以下条件，才算进入目标工程形态：

1. 新建和导入入口创建的是 `Document`，不是单纯 `ResumeVersion`。
2. 用户看到的主页面来自 `WorkspaceView`。
3. 草稿内容以 `DraftVersion + DocumentModule + DocumentClaim` 保存。
4. AI 修改以 `RevisionIssue + RevisionProposal` 呈现。
5. 强主张通过 `EvidenceLink` 或用户确认进入最终稿。
6. `doc_json` 可以从 RenderProjection 重新生成。
7. 导出基于 accepted Draft。
8. 默认模板可以完成可投递 PDF。
9. 聊天输入不会直接写终稿。
10. 模板和主题不再是工作台主线。

## 14. 不合入标准

以下功能即使看起来有用，也不应作为核心方向合入：

1. 只调用 AI 改写选中文本，然后直接替换编辑器内容。
2. 只新增一个全局聊天框。
3. 只增强主题或模板样式。
4. 只让用户手动拖拽模块，但没有模块语义、问题和证据。
5. 只把 JD 作为唯一简历入口。
6. 只保存 AI 回复，不保存 Proposal / Issue / Evidence。
7. 只在前端内存里处理 AI 建议，不进入后端状态。

## 15. 研发阅读顺序

后续任何工程实现前，建议按以下顺序阅读：

1. `docs/product/ai-native-revision-system.md`
2. `docs/product/resume-pack-prd.md`
3. `docs/product/current-to-target-gap-map.md`
4. `docs/product/target-engineering-blueprint.md`
5. `docs/product/revision-engine-architecture.md`
6. `docs/product/revision-workspace-design.md`
7. `docs/product/resume-pack-requirements-matrix.md`

读完后再判断具体代码应该改哪里。

