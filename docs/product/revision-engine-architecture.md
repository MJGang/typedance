# Revision Engine 目标工程架构

> 状态：目标架构草案  
> 目标：定义 TypeDance AI-native 改稿系统的后端领域模型、存储结构、API、Agent Orchestrator 和现有系统取舍。  
> 范围：这是终局架构，不是渐进式实施计划。

## 1. 架构原则

TypeDance 的工程核心不是编辑器，也不是聊天接口，而是 Revision Engine。

Revision Engine 负责：

```text
接收来源文档和材料
-> 调用 Document Pack 规则
-> 编排 Agent 生成结构化理解和改稿结果
-> 保存 Draft、Issue、Proposal、Evidence
-> 提供 Revision Workspace 聚合视图
-> 在用户确认后导出正式版本
```

核心原则：

1. `doc_json` 不是事实源，只是渲染投影。
2. Agent 不直接修改最终文档，只生成结构化对象。
3. 所有高风险修改必须经过 Issue / Proposal / Action 流转。
4. 每个 Document Pack 声明自己的模块、质量规则、问题类型、动作和渲染映射。
5. 前端消费 Workspace View，不直接拼接底层 Agent 输出。

## 2. 目标系统分层

```text
Frontend Revision Workspace
  |
  v
Revision Workspace API
  |
  +--> Draft Service
  +--> Issue Service
  +--> Evidence Service
  +--> Source Service
  +--> Render Service
  |
  v
Revision Orchestrator
  |
  +--> Pack Registry
  +--> Agent Runtime
  +--> Schema Validator
  +--> Run State Store
  |
  v
Storage Layer
  |
  +--> Source Documents
  +--> Modules / Claims / Evidence
  +--> Drafts / Proposals / Issues
  +--> Runs / Agent Steps
  +--> Export Artifacts
```

## 3. 领域模型关系

```text
Document
  ├─ SourceDocument[]
  ├─ DraftVersion[]
  └─ ExportArtifact[]

SourceDocument
  ├─ ParsedBlock[]
  └─ EvidenceLink[]

DraftVersion
  ├─ DocumentModule[]
  │    └─ DocumentClaim[]
  ├─ RevisionIssue[]
  ├─ RevisionProposal[]
  └─ RenderProjection

RevisionRun
  ├─ AgentStep[]
  ├─ RevisionIssue[]
  ├─ RevisionProposal[]
  ├─ EvidenceLink[]
  └─ DraftVersion
```

关键关系：

- 一个 `Document` 是一个用户文档工作对象，例如“一份简历改稿项目”。
- `SourceDocument` 是输入来源，例如旧简历、粘贴文本、项目材料、工作总结。
- `DraftVersion` 是某次生成的新稿。
- `DocumentModule` 是 pack 语义模块，例如简历里的项目经历、技能、工作经历。
- `DocumentClaim` 是文档中的关键主张，例如一条 bullet 或一个成果表达。
- `EvidenceLink` 连接来源和主张。
- `RevisionIssue` 是用户可处理的问题卡。
- `RevisionProposal` 是 AI 的具体修改方案。
- `RevisionRun` 是一次可追踪的改稿任务。

## 4. 核心表结构

### documents

```ts
documents {
  id: string
  owner_id?: string
  pack_id: string
  title: string
  status: "active" | "archived"
  current_draft_id?: string
  accepted_draft_id?: string
  created_at: string
  updated_at: string
}
```

### source_documents

```ts
source_documents {
  id: string
  document_id: string
  source_type:
    | "old_resume"
    | "uploaded_file"
    | "pasted_text"
    | "manual_user_input"
    | "project_material"
    | "work_summary"
    | "external_context"
  title: string
  mime_type?: string
  original_uri?: string
  raw_text?: string
  file_path?: string
  parse_status: "pending" | "parsed" | "failed"
  created_at: string
}
```

### parsed_blocks

```ts
parsed_blocks {
  id: string
  source_document_id: string
  type: "heading" | "paragraph" | "list" | "table" | "contact" | "unknown"
  text: string
  order: number
  page?: number
  source_span: object
}
```

### document_modules

```ts
document_modules {
  id: string
  draft_id: string
  pack_id: string
  type: string
  title: string
  order: number
  visibility: "visible" | "hidden"
  status:
    | "clean"
    | "needs_review"
    | "needs_confirmation"
    | "weak"
    | "hidden"
  data: object
  created_at: string
  updated_at: string
}
```

### document_claims

```ts
document_claims {
  id: string
  draft_id: string
  module_id: string
  item_id?: string
  text: string
  claim_type: string
  confidence:
    | "supported"
    | "user_confirmed"
    | "inferred"
    | "unsupported"
  risk_flags: string[]
  source_span_refs: string[]
  created_at: string
  updated_at: string
}
```

### evidence_links

```ts
evidence_links {
  id: string
  document_id: string
  source_document_id: string
  claim_id?: string
  support_level:
    | "direct"
    | "partial"
    | "inferred"
    | "contradicted"
    | "none"
  extracted_text?: string
  normalized_fact?: string
  confidence: number
  user_confirmed: boolean
  created_at: string
}
```

### revision_runs

```ts
revision_runs {
  id: string
  document_id: string
  pack_id: string
  run_type:
    | "import_reconstruct"
    | "material_generate"
    | "module_rewrite"
    | "issue_action"
    | "evidence_check"
    | "review_gate"
  status:
    | "created"
    | "parsing"
    | "understanding"
    | "planning"
    | "generating"
    | "verifying"
    | "building_tasks"
    | "awaiting_user_confirmation"
    | "ready_for_review"
    | "completed"
    | "failed_retryable"
    | "failed_final"
    | "canceled"
  source_document_ids: string[]
  base_draft_id?: string
  target_draft_id?: string
  user_intent?: string
  selected_module_id?: string
  selected_issue_id?: string
  selected_action_id?: string
  output_summary?: string
  created_at: string
  updated_at: string
}
```

### agent_steps

```ts
agent_steps {
  id: string
  run_id: string
  agent_name: string
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  input_refs: string[]
  output_refs: string[]
  error?: string
  started_at?: string
  finished_at?: string
}
```

### draft_versions

```ts
draft_versions {
  id: string
  document_id: string
  run_id: string
  pack_id: string
  status: "generated" | "in_review" | "accepted" | "exported"
  summary: string
  applied_proposal_ids: string[]
  unresolved_issue_ids: string[]
  render_projection_id?: string
  created_at: string
  updated_at: string
}
```

### revision_issues

```ts
revision_issues {
  id: string
  run_id: string
  document_id: string
  draft_id?: string
  module_id?: string
  item_id?: string
  claim_id?: string
  type: string
  severity: "info" | "warning" | "blocking"
  title: string
  message: string
  reason: string
  original_text?: string
  proposed_text?: string
  evidence_link_ids: string[]
  action_ids: string[]
  status:
    | "open"
    | "resolved"
    | "dismissed"
    | "accepted"
    | "needs_user_input"
  created_by_agent: string
  created_at: string
}
```

### revision_proposals

```ts
revision_proposals {
  id: string
  run_id: string
  document_id: string
  draft_id?: string
  target: object
  operation: string
  original_snapshot?: object
  proposed_snapshot: object
  summary: string
  rationale: string
  related_issue_ids: string[]
  evidence_link_ids: string[]
  confidence: number
  risk_level: "low" | "medium" | "high"
  requires_user_confirmation: boolean
  status: "pending" | "applied" | "rejected" | "edited" | "superseded"
  created_by_agent: string
  created_at: string
}
```

### user_confirmations

```ts
user_confirmations {
  id: string
  document_id: string
  claim_id?: string
  evidence_link_id?: string
  issue_id?: string
  confirmation_type:
    | "truth_confirmed"
    | "risk_accepted"
    | "source_verified"
  note?: string
  created_at: string
}
```

### render_projections

```ts
render_projections {
  id: string
  draft_id: string
  render_profile: string
  html?: string
  doc_json?: object
  layout_warnings: string[]
  created_at: string
}
```

### export_artifacts

```ts
export_artifacts {
  id: string
  document_id: string
  draft_id: string
  format: "pdf" | "html" | "markdown" | "docx"
  file_path?: string
  review_status: "passed" | "forced_with_risk" | "blocked"
  created_at: string
}
```

## 5. 后端服务边界

### Pack Registry

职责：

- 注册 Document Pack。
- 提供模块、问题、动作、质量规则。
- 向 Orchestrator 提供 Agent 合约。

核心接口：

```text
GET /packs
GET /packs/{pack_id}
```

### Source Service

职责：

- 创建 SourceDocument。
- 保存原始文本或文件引用。
- 生成 ParsedBlock。

核心接口：

```text
POST /documents/{document_id}/sources
GET /sources/{source_id}
GET /sources/{source_id}/parsed-blocks
```

### Revision Orchestrator

职责：

- 创建 RevisionRun。
- 执行状态机。
- 按 Pack 合约调用 Agent。
- 校验 Agent 输出。
- 写入 Draft、Issue、Proposal、Evidence。

核心接口：

```text
POST /revision-runs
GET /revision-runs/{run_id}
POST /revision-runs/{run_id}/cancel
POST /revision-runs/{run_id}/retry
```

### Draft Service

职责：

- 保存 DraftVersion。
- 应用 Proposal。
- 管理 accepted Draft。

核心接口：

```text
GET /drafts/{draft_id}
POST /drafts/{draft_id}/apply-proposal
POST /drafts/{draft_id}/accept
```

### Issue Service

职责：

- 提供问题卡。
- 执行动作。
- 更新 Issue 状态。

核心接口：

```text
GET /drafts/{draft_id}/issues
POST /revision-actions/{action_id}/execute
POST /issues/{issue_id}/dismiss
```

### Evidence Service

职责：

- 管理 EvidenceLink。
- 记录用户确认。
- 更新 Claim confidence。

核心接口：

```text
GET /claims/{claim_id}/evidence
POST /claims/{claim_id}/confirm
POST /evidence-links/{evidence_link_id}/confirm
```

### Render Service

职责：

- 把 DraftVersion 投影为 HTML、doc_json、PDF 输入。
- 生成 layout_risk。

核心接口：

```text
POST /drafts/{draft_id}/render
GET /render-projections/{projection_id}
```

### Workspace API

职责：

- 聚合前端需要的 RevisionWorkspaceView。

核心接口：

```text
GET /revision-workspaces/{draft_id}
```

返回：

```ts
RevisionWorkspaceView {
  draft: DraftVersion
  modules: DocumentModule[]
  issues: RevisionIssue[]
  proposals: RevisionProposal[]
  evidence_summary: EvidenceSummary
  render_projection: RenderProjection
  source_refs: SourceDocumentSummary[]
  coach_summary: CoachSummary
}
```

## 6. RevisionRun 编排流程

### import_reconstruct

适用于导入旧简历、旧文档并生成新版草稿。

```text
created
-> parsing
   SourceParserAgent
-> understanding
   PackRouterAgent
   StructureAgent
   FactExtractorAgent
   ClaimExtractorAgent
-> planning
   IssueDetectorAgent
   RevisionPlannerAgent
-> generating
   SectionWriterAgent
   DraftBuilder
-> verifying
   EvidenceVerifierAgent
   RiskCheckerAgent
-> building_tasks
   CoachNarratorAgent
   ActionBuilder
-> ready_for_review
   DraftRenderer
-> completed
```

### issue_action

适用于用户点击某个问题卡动作。

```text
created
-> planning
   根据 action type 选择 agent
-> generating
   生成 Proposal 或用户输入请求
-> verifying
   校验新内容和证据状态
-> building_tasks
   更新 Issue / Proposal / Draft
-> completed
```

## 7. Agent Runtime

Agent Runtime 必须提供：

- 输入对象组装。
- Prompt / tool 调用。
- JSON schema 校验。
- 输出引用写入。
- 错误分类。
- 重试策略。

Agent 输出必须通过对应 Pack 的 `output_schema`。

如果输出无法校验：

```text
AgentStep failed
RevisionRun failed_retryable 或 failed_final
不得写入 DraftVersion
```

## 8. 事件与状态同步

前端需要看到真实进度，而不是单一 loading。

后端应产生事件：

```text
revision_run.created
revision_run.status_changed
agent_step.started
agent_step.completed
draft.created
issue.created
proposal.created
evidence.created
render_projection.created
revision_run.completed
revision_run.failed
```

前端可以通过轮询或事件流订阅。

## 9. 与现有系统的关系

现有系统中的：

```text
ResumeVersion
template_id
doc_json
plain_text_snapshot
PDF export
```

应该逐步降级为 Render / Export 层概念。

目标关系：

```text
DraftVersion
  -> RenderProjection.doc_json
  -> ResumeVersion 兼容投影
  -> PDF Export
```

保留：

- TipTap 编辑能力。
- 默认 A4 模板。
- HTML / PDF 渲染管线。

重建：

- 文档来源层。
- 模块 / Claim / Evidence 数据层。
- RevisionRun 状态机。
- Issue / Proposal / Action 系统。
- Workspace 聚合 API。

冻结或降级：

- 主题库。
- 多模板扩展。
- 块级样式面板。

## 10. 测试边界

目标架构必须支持以下测试：

```text
Pack schema 测试
确保每个 Pack 定义合法。

Agent output schema 测试
确保 Agent 输出不能绕过结构化协议。

RevisionRun 状态机测试
确保每种 run_type 状态流转正确。

Evidence policy 测试
确保缺证据强主张不能静默进入 accepted Draft。

Workspace API 测试
确保前端拿到完整 Draft / Issue / Proposal / Evidence 视图。

Render projection 测试
确保结构化 Draft 能稳定渲染成 doc_json / HTML / PDF。
```

## 11. 不可妥协的工程约束

1. 不新增“AI 回复字符串直接写入编辑器”的路径。
2. 不把 `doc_json` 当作唯一事实源。
3. 不允许 Agent 绕过 Proposal / Issue / Evidence 写最终稿。
4. 不允许 blocking issue 未处理时默认导出。
5. 不把 Pack 规则散落到组件或临时 prompt。
6. 不让前端直接依赖某个 Agent 的私有输出格式。

