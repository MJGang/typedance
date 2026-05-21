# Revision API 目标契约

> 状态：终局 API 契约  
> 适用范围：Revision Engine、Resume Pack、Revision Workspace 的前后端交互边界。  
> 重要说明：本文定义目标 API 面，不代表当前 sidecar 已实现。现有 `resume-versions` API 属于 legacy compatibility。

## 1. API 设计原则

1. 前端主页面读取 `WorkspaceView`，不自行拼 Agent 输出。
2. 用户动作围绕 Issue、Proposal、Claim、Draft，而不是 prompt。
3. 所有 AI 运行通过 `RevisionRun` 追踪。
4. 所有导出基于 Draft，而不是直接基于编辑器 `doc_json`。
5. legacy `resume-versions` API 只用于兼容，不再作为新体验主 API。

## 2. 通用约定

### 2.1 ID 前缀

```text
doc_      Document
src_      SourceDocument
blk_      ParsedBlock
draft_    DraftVersion
mod_      DocumentModule
claim_    DocumentClaim
ev_       EvidenceLink
run_      RevisionRun
step_     AgentStep
issue_    RevisionIssue
prop_     RevisionProposal
act_      RevisionAction
render_   RenderProjection
export_   ExportArtifact
```

### 2.2 时间

所有时间字段使用 ISO datetime 字符串。

```text
2026-05-21T10:30:00Z
```

### 2.3 错误响应

```ts
ApiError {
  code: string
  message: string
  details?: unknown
  retryable: boolean
}
```

### 2.4 语言字段

```ts
Language = "zh-CN" | "en-US"
```

UI 语言、目标简历语言、Agent 解释语言必须分开。

## 3. Documents

### 3.1 创建文档项目

```text
POST /documents
```

请求：

```ts
CreateDocumentRequest {
  pack_id: "resume"
  title: string
  target_language: Language
  initial_mode:
    | "import_old_resume"
    | "blank_guided"
    | "base_resume"
    | "opportunity_variant"
}
```

响应：

```ts
Document {
  id: string
  pack_id: string
  title: string
  status: "active" | "archived"
  target_language: Language
  current_draft_id?: string
  accepted_draft_id?: string
  created_at: string
  updated_at: string
}
```

### 3.2 获取文档

```text
GET /documents/{document_id}
```

返回 `Document`。

### 3.3 列出文档

```text
GET /documents
```

查询参数：

```text
pack_id?
status?
```

响应：

```ts
DocumentListItem[] {
  id: string
  pack_id: string
  title: string
  target_language: Language
  status: "active" | "archived"
  current_draft_id?: string
  updated_at: string
  quality_state?: "unknown" | "needs_review" | "ready" | "blocked"
}
```

## 4. Sources

### 4.1 添加来源

```text
POST /documents/{document_id}/sources
```

请求：

```ts
CreateSourceRequest {
  source_type:
    | "old_resume"
    | "uploaded_file"
    | "pasted_text"
    | "manual_user_input"
    | "project_material"
    | "work_summary"
    | "external_context"
  title: string
  raw_text?: string
  file_token?: string
  mime_type?: string
  related_issue_id?: string
  related_module_id?: string
}
```

响应：

```ts
SourceDocument {
  id: string
  document_id: string
  source_type: string
  title: string
  mime_type?: string
  raw_text?: string
  file_path?: string
  parse_status: "pending" | "parsed" | "failed"
  created_at: string
}
```

### 4.2 获取来源和解析块

```text
GET /documents/{document_id}/sources
GET /sources/{source_id}
GET /sources/{source_id}/parsed-blocks
```

## 5. Revision Runs

### 5.1 创建运行

```text
POST /documents/{document_id}/revision-runs
```

请求：

```ts
CreateRevisionRunRequest {
  run_type:
    | "import_reconstruct"
    | "blank_guided_generate"
    | "quality_review"
    | "issue_action"
    | "module_rewrite"
    | "evidence_check"
    | "opportunity_calibrate"
    | "review_gate"
  source_document_ids?: string[]
  base_draft_id?: string
  selected_module_id?: string
  selected_issue_id?: string
  selected_action_id?: string
  user_intent?: string
  opportunity_context_id?: string
}
```

响应：

```ts
RevisionRun {
  id: string
  document_id: string
  pack_id: string
  run_type: string
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
  output_summary?: string
  created_at: string
  updated_at: string
}
```

### 5.2 获取运行

```text
GET /revision-runs/{run_id}
GET /documents/{document_id}/revision-runs
```

### 5.3 取消或重试

```text
POST /revision-runs/{run_id}/cancel
POST /revision-runs/{run_id}/retry
```

## 6. Workspace View

### 6.1 获取主工作台视图

```text
GET /documents/{document_id}/workspace-view
```

响应：

```ts
WorkspaceView {
  document: DocumentSummary
  current_draft?: DraftVersion
  modules: DocumentModule[]
  claims: DocumentClaim[]
  issues: RevisionIssue[]
  proposals: RevisionProposal[]
  evidence: EvidenceLink[]
  source_summaries: SourceDocumentSummary[]
  render_projection?: RenderProjection
  quality_gate?: QualityGateResult
  run_status?: RevisionRunStatusSummary
  coach_summary?: CoachSummary
  available_actions: ContextualAction[]
}
```

前端主页面必须优先消费该接口。

## 7. Drafts

### 7.1 获取草稿

```text
GET /drafts/{draft_id}
GET /documents/{document_id}/drafts
```

### 7.2 接受草稿

```text
POST /drafts/{draft_id}/accept
```

请求：

```ts
AcceptDraftRequest {
  note?: string
  force_with_risks?: boolean
}
```

响应：

```ts
AcceptDraftResponse {
  draft: DraftVersion
  blocking_issues: RevisionIssue[]
  accepted: boolean
}
```

默认不能接受带 blocking issue 的草稿。

### 7.3 渲染草稿

```text
POST /drafts/{draft_id}/render
```

请求：

```ts
RenderDraftRequest {
  render_profile: "default-a4" | "ats" | "compact-a4"
  target_format?: "html" | "doc_json" | "pdf_input"
}
```

响应：

```ts
RenderProjection {
  id: string
  draft_id: string
  render_profile: string
  html?: string
  doc_json?: unknown
  layout_warnings: LayoutWarning[]
  created_at: string
}
```

## 8. Issues

### 8.1 获取问题

```text
GET /drafts/{draft_id}/issues
GET /issues/{issue_id}
```

### 8.2 执行动作

```text
POST /issues/{issue_id}/actions/{action_id}
```

请求：

```ts
ExecuteIssueActionRequest {
  user_note?: string
  selected_option_id?: string
}
```

响应：

```ts
IssueActionResponse {
  issue: RevisionIssue
  created_run?: RevisionRun
  created_proposals: RevisionProposal[]
  requested_input?: UserInputRequest
  workspace_view?: WorkspaceView
}
```

### 8.3 忽略问题

```text
POST /issues/{issue_id}/dismiss
```

请求：

```ts
DismissIssueRequest {
  reason?: string
}
```

blocking issue 默认不允许无理由忽略。

## 9. Proposals

### 9.1 获取 Proposal

```text
GET /proposals/{proposal_id}
```

### 9.2 接受 Proposal

```text
POST /proposals/{proposal_id}/accept
```

请求：

```ts
AcceptProposalRequest {
  note?: string
}
```

响应：

```ts
ProposalDecisionResponse {
  proposal: RevisionProposal
  draft: DraftVersion
  affected_issues: RevisionIssue[]
  render_projection?: RenderProjection
  workspace_view?: WorkspaceView
}
```

### 9.3 拒绝 Proposal

```text
POST /proposals/{proposal_id}/reject
```

请求：

```ts
RejectProposalRequest {
  reason?: string
}
```

### 9.4 要求修改 Proposal

```text
POST /proposals/{proposal_id}/revise
```

请求：

```ts
ReviseProposalRequest {
  instruction:
    | "make_more_conservative"
    | "make_more_specific"
    | "shorten"
    | "change_tone"
    | "custom"
  custom_instruction?: string
}
```

响应创建新的 RevisionRun 或新的 Proposal。

## 10. Claims and Evidence

### 10.1 获取 Claim 证据

```text
GET /claims/{claim_id}/evidence
```

响应：

```ts
EvidenceLink[]
```

### 10.2 确认 Claim

```text
POST /claims/{claim_id}/confirm
```

请求：

```ts
ConfirmClaimRequest {
  confirmation_type:
    | "truth_confirmed"
    | "risk_accepted"
    | "source_verified"
  note?: string
}
```

响应：

```ts
UserConfirmation {
  id: string
  document_id: string
  claim_id?: string
  evidence_link_id?: string
  issue_id?: string
  confirmation_type: string
  note?: string
  created_at: string
}
```

### 10.3 确认证据

```text
POST /evidence-links/{evidence_link_id}/confirm
```

## 11. Contextual Input

### 11.1 提交上下文输入

```text
POST /documents/{document_id}/contextual-inputs
```

请求：

```ts
CreateContextualInputRequest {
  input_type: "fact" | "preference" | "instruction" | "clarification"
  text: string
  target?: RevisionTarget
  related_issue_id?: string
  related_proposal_id?: string
  related_module_id?: string
}
```

响应：

```ts
ContextualInputResponse {
  source_document?: SourceDocument
  created_run?: RevisionRun
  workspace_view?: WorkspaceView
}
```

上下文输入不直接改最终稿。

## 12. Opportunity Calibration

### 12.1 创建机会上下文

```text
POST /documents/{document_id}/opportunities
```

请求：

```ts
CreateOpportunityRequest {
  title?: string
  company?: string
  raw_text?: string
  url?: string
  target_role?: string
}
```

响应：

```ts
OpportunityContext {
  id: string
  document_id: string
  title?: string
  company?: string
  raw_text?: string
  requirements: OpportunityRequirement[]
  created_at: string
}
```

### 12.2 启动机会校准

使用：

```text
POST /documents/{document_id}/revision-runs
run_type = "opportunity_calibrate"
```

## 13. Export

### 13.1 导出 PDF

```text
POST /drafts/{draft_id}/export/pdf
```

请求：

```ts
ExportDraftRequest {
  output_path?: string
  force_with_risks?: boolean
}
```

响应：

```ts
ExportArtifact {
  id: string
  document_id: string
  draft_id: string
  format: "pdf"
  file_path?: string
  review_status: "passed" | "forced_with_risk" | "blocked"
  created_at: string
}
```

## 14. Legacy API

以下 API 可以保留，但必须标注为 legacy：

```text
GET /resume-versions
POST /resume-versions
GET /resume-versions/{resume_id}
PATCH /resume-versions/{resume_id}
DELETE /resume-versions/{resume_id}
GET /template-styles
PUT /template-styles/{template_id}
POST /exports/pdf/{resume_id}
POST /exports/html/{resume_id}
```

新工作台不应依赖 legacy API 作为主数据源。

## 15. API 完成定义

API 层达到目标形态时，应满足：

1. 首页创建的是 `Document`。
2. 导入旧简历创建 `SourceDocument` 和 `RevisionRun`。
3. 主工作台读取 `WorkspaceView`。
4. 问题处理走 `IssueAction`。
5. AI 修改走 `RevisionProposal`。
6. 用户确认走 `Claim` 或 `EvidenceLink`。
7. 导出走 `Draft`。
8. `resume-versions` 只作为兼容层存在。

