# Revision Engine 目标工程架构

> 状态：目标架构草案  
> 目标：定义 TypeDance AI-native 改稿系统的业务领域模型、存储结构、API、TS Agent Host / Harness Core 边界和现有系统取舍。
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
Agent Host
  |
  +--> Pack Registry
  +--> Harness Runtime
  +--> Schema Validator
  +--> Harness Event Store
  |
  v
Storage Layer
  |
  +--> Source Documents
  +--> Modules / Claims / Evidence
  +--> Drafts / Proposals / Issues
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

HarnessRun (TS Harness / Agent Host)
  └─ 通过 run_id 关联 Draft / Issue / Proposal / Evidence 的来源
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
- `HarnessRun` 是 TS Harness / Agent Host 的运行对象，sidecar 只在业务对象里保存其 `run_id` 作为来源引用。

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

### Harness runs and events

HarnessRun 和 HarnessEvent 属于 `@typedance/harness-contracts` 与 TS Harness Runtime。Sidecar 不建 AI run/step 表；Draft、Issue、Proposal、Evidence 只保存外部 `run_id` 作为来源引用。

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

### Agent Host / Harness Runtime

职责：

- TS Agent Host 根据当前 pack 加载对应 plugins，并创建 HarnessRun。
- Harness Runtime 执行模型循环、工具调用、权限确认、上下文管理和事件流。
- plugin 通过 MCP/HTTP 调用 Sidecar 暴露的业务能力。
- Agent 输出必须经过结构化校验后，才写入 Draft、Issue、Proposal、Evidence 等业务表。
- Sidecar 不持有模型调用、agent 编排、skill 选择或 plugin 调度逻辑。

核心接口：

```text
POST /packs/{pack_id}/runs
GET /runs/{run_id}
GET /runs/{run_id}/events
POST /runs/{run_id}/input
POST /runs/{run_id}/cancel
POST /permissions/{request_id}/resolve
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

## 6. HarnessRun 编排流程

### import_reconstruct

适用于导入旧简历、旧文档并生成新版草稿。

```text
queued
-> running
   plugin parses source through sidecar MCP / HTTP tools
   plugin generates structured draft, issues, proposals, evidence
   plugin validates output schema
   plugin writes business objects through sidecar APIs
-> completed
```

### issue_action

适用于用户点击某个问题卡动作。

```text
queued
-> running
   根据 action 选择当前 pack plugin 内的 skill/tool/agent
   生成 Proposal 或用户输入请求
   校验新内容和证据状态
   通过 sidecar API 更新 Issue / Proposal / Draft
-> completed
```

## 7. Harness Runtime

Harness Runtime 必须提供：

- 输入对象组装。
- Prompt / tool 调用。
- JSON schema 校验。
- 输出引用写入。
- 错误分类。
- 重试策略。

Agent 输出必须通过对应 Pack 的 `output_schema`。

如果输出无法校验：

```text
HarnessEvent 记录失败原因
HarnessRun status = failed
不得写入 DraftVersion
```

## 8. 事件与状态同步

前端需要看到真实进度，而不是单一 loading。

TS Harness Runtime 应产生事件：

```text
run.created
run.status_changed
model.delta
tool.call.started
tool.call.completed
draft.created
issue.created
proposal.created
evidence.created
render_projection.created
run.completed
run.failed
```

前端通过 Agent Host SSE 订阅事件流；Sidecar workspace view 不携带 run 状态。

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
  -> PDF Export
```

保留：

- TipTap 编辑能力。
- 默认 A4 模板。
- HTML / PDF 渲染管线。

重建：

- 文档来源层。
- 模块 / Claim / Evidence 数据层。
- TS Agent Host / Harness Core。
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

Harness lifecycle 测试
确保运行、事件、权限和失败路径正确。

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

