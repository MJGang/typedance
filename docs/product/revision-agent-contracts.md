# Revision Agent 契约设计

> 状态：终局 Agent 合约  
> 适用范围：TypeDance Revision Engine 中所有 Agent 的输入、输出、校验、失败处理和领域对象落库规则。  
> 重要说明：Agent 不是聊天机器人。Agent 是结构化改稿系统里的能力节点，必须输出可校验、可追踪、可落库的对象。

## 1. 核心原则

TypeDance 中的 Agent 不直接改最终文档。

Agent 只能产生：

```text
ParsedBlock
DocumentModule
DocumentClaim
EvidenceLink
RevisionIssue
RevisionProposal
DraftPatch
RenderPlan
QualityGateResult
```

不能产生：

```text
一段直接写入最终简历的自然语言回复
```

自然语言可以作为解释存在，但必须依附于结构化对象。

## 2. Agent 运行上下文

每次 Agent 调用都必须有统一上下文。

```ts
AgentInvocationContext {
  invocation_id: string
  run_id: string
  document_id: string
  pack_id: string
  agent_name: string
  schema_version: string
  input_refs: AgentInputRef[]
  user_locale?: "zh-CN" | "en-US"
  target_language?: "zh-CN" | "en-US"
  created_at: string
}
```

`input_refs` 指向已保存的领域对象：

```text
SourceDocument
ParsedBlock
DraftVersion
DocumentModule
DocumentClaim
RevisionIssue
RevisionProposal
OpportunityContext
UserInputNote
```

Agent 输入不应是前端临时拼出来的一大段字符串。

## 3. Agent 输出信封

所有 Agent 输出必须使用统一信封。

```ts
AgentOutputEnvelope<T> {
  invocation_id: string
  run_id: string
  document_id: string
  pack_id: string
  agent_name: string
  output_type: string
  schema_version: string
  confidence: number
  warnings: AgentWarning[]
  payload: T
}
```

校验规则：

1. `payload` 必须符合对应 `output_type` 的 schema。
2. `confidence` 必须在 `0` 到 `1` 之间。
3. `warnings` 不得作为唯一风险承载，高风险必须转为 `RevisionIssue`。
4. 校验失败时不能写入 Draft、Issue、Proposal、Evidence。

## 4. HarnessEvent 状态

每次 Agent 调用都必须记录为 `HarnessEvent`。

```ts
HarnessEvent {
  id: string
  run_id: string
  agent_name: string
  status:
    | "pending"
    | "running"
    | "completed"
    | "failed_schema"
    | "failed_tool"
    | "failed_model"
    | "failed_policy"
    | "skipped"
  input_refs: string[]
  output_refs: string[]
  error?: AgentError
  started_at?: string
  finished_at?: string
}
```

失败分类必须明确。

不能用一个笼统的 `failed` 让前端和用户无法理解发生了什么。

## 5. Parser Agent

### 5.1 职责

Parser Agent 负责把来源文档转为可引用的文本块。

输入：

```text
SourceDocument
```

输出：

```ts
ParsedDocumentOutput {
  source_document_id: string
  blocks: ParsedBlockDraft[]
  detected_language?: "zh-CN" | "en-US" | "mixed" | "unknown"
  parse_warnings: AgentWarning[]
}
```

### 5.2 `ParsedBlockDraft`

```ts
ParsedBlockDraft {
  type: "heading" | "paragraph" | "list" | "table" | "contact" | "date_range" | "unknown"
  text: string
  order: number
  page?: number
  source_span?: {
    start?: number
    end?: number
    bbox?: number[]
  }
  confidence: number
}
```

### 5.3 禁止行为

Parser Agent 不能重写用户经历。

它只做解析和切块。

## 6. Resume Structurer

### 6.1 职责

Resume Structurer 负责把 ParsedBlock 转为 Resume Pack 模块。

输入：

```text
ParsedBlock[]
Resume Pack module specs
```

输出：

```ts
StructuredResumeOutput {
  modules: DocumentModuleDraft[]
  claims: DocumentClaimDraft[]
  unresolved_blocks: ParsedBlockRef[]
  structure_warnings: AgentWarning[]
}
```

### 6.2 模块草稿

```ts
DocumentModuleDraft {
  type: ResumeModuleType
  title: string
  order: number
  visibility: "visible" | "hidden"
  status: "clean" | "needs_review" | "needs_confirmation" | "weak" | "hidden"
  data: Record<string, unknown>
  source_block_refs: string[]
  confidence: number
}
```

### 6.3 主张草稿

```ts
DocumentClaimDraft {
  module_temp_id: string
  item_temp_id?: string
  text: string
  claim_type:
    | "responsibility"
    | "achievement"
    | "skill"
    | "summary"
    | "education"
    | "certificate"
    | "intent"
  source_block_refs: string[]
  confidence: "supported" | "inferred" | "unsupported"
  risk_flags: string[]
}
```

### 6.4 禁止行为

Structurer 不能把不确定事实当成确定事实。

不确定的字段必须进入：

```text
needs_confirmation
```

## 7. Resume Reviewer

### 7.1 职责

Resume Reviewer 负责发现问题。

输入：

```text
DraftVersion
DocumentModule[]
DocumentClaim[]
EvidenceLink[]
Resume Pack quality rules
```

输出：

```ts
ResumeReviewOutput {
  issues: RevisionIssueDraft[]
  quality_summary: QualitySummary
}
```

### 7.2 问题草稿

```ts
RevisionIssueDraft {
  type: ResumeIssueType
  severity: "info" | "warning" | "blocking"
  title: string
  message: string
  reason: string
  target: RevisionTarget
  original_text?: string
  suggested_direction?: string
  evidence_link_refs: string[]
  action_templates: RevisionActionTemplate[]
}
```

### 7.3 最低问题类型

```text
missing_info
vague_expression
missing_result
missing_evidence
timeline_conflict
skill_without_support
duplicate_content
too_long
tone_inconsistent
hr_unfriendly
overclaim_risk
layout_risk
```

### 7.4 禁止行为

Reviewer 不能只输出“整体建议”。

必须生成可定位、可处理的问题卡。

## 8. Resume Rewriter

### 8.1 职责

Resume Rewriter 负责生成修改建议。

输入：

```text
RevisionIssue
DraftVersion
target module / claim
EvidenceLink[]
UserInputNote?
```

输出：

```ts
ResumeRewriteOutput {
  proposals: RevisionProposalDraft[]
  follow_up_questions: UserInputRequest[]
}
```

### 8.2 Proposal 草稿

```ts
RevisionProposalDraft {
  target: RevisionTarget
  operation:
    | "replace_claim"
    | "insert_claim"
    | "remove_claim"
    | "rewrite_module"
    | "reorder_module"
    | "hide_module"
    | "update_field"
  before?: unknown
  after: unknown
  summary: string
  rationale: string
  evidence_link_refs: string[]
  confidence: number
  risk_level: "low" | "medium" | "high"
  requires_user_confirmation: boolean
  related_issue_refs: string[]
}
```

### 8.3 跟进问题

当缺少事实时，Rewriter 不应编造。

它应输出：

```ts
UserInputRequest {
  target: RevisionTarget
  question: string
  expected_answer_type:
    | "short_text"
    | "number"
    | "date"
    | "choice"
    | "long_text"
  reason: string
  blocking: boolean
}
```

### 8.4 禁止行为

Rewriter 不能直接生成最终简历全文并覆盖 Draft。

它必须输出 Proposal 或跟进问题。

## 9. Evidence Verifier

### 9.1 职责

Evidence Verifier 负责判断主张是否有来源支撑。

输入：

```text
DocumentClaim[]
SourceDocument[]
ParsedBlock[]
UserConfirmation[]
```

输出：

```ts
EvidenceVerificationOutput {
  evidence_links: EvidenceLinkDraft[]
  claim_updates: ClaimConfidenceUpdate[]
  issues: RevisionIssueDraft[]
}
```

### 9.2 EvidenceLink 草稿

```ts
EvidenceLinkDraft {
  claim_ref: string
  source_document_ref?: string
  parsed_block_refs: string[]
  support_level: "direct" | "partial" | "inferred" | "contradicted" | "none"
  extracted_text?: string
  normalized_fact?: string
  confidence: number
  requires_user_confirmation: boolean
}
```

### 9.3 禁止行为

Evidence Verifier 不能为了让简历更好看而提高证据等级。

找不到证据时，必须返回：

```text
support_level = "none"
```

或要求用户确认。

## 10. Opportunity Calibrator

### 10.1 职责

Opportunity Calibrator 负责根据目标岗位生成岗位版本建议。

输入：

```text
Base DraftVersion
OpportunityContext
EvidenceLink[]
```

输出：

```ts
OpportunityCalibrationOutput {
  opportunity_requirements: OpportunityRequirement[]
  match_summary: MatchSummary
  issues: RevisionIssueDraft[]
  proposals: RevisionProposalDraft[]
  variant_plan: DraftVariantPlan
}
```

### 10.2 岗位要求

```ts
OpportunityRequirement {
  type: "skill" | "experience" | "domain" | "seniority" | "language" | "education" | "soft_skill"
  text: string
  importance: "required" | "preferred" | "nice_to_have"
  evidence_status: "matched" | "partially_matched" | "missing" | "unknown"
}
```

### 10.3 禁止行为

Opportunity Calibrator 不能把岗位需求硬塞进用户简历。

无证据匹配必须生成缺口或风险，而不是生成虚假经历。

## 11. Render Planner

### 11.1 职责

Render Planner 负责把结构化 Draft 映射到默认模板。

输入：

```text
DraftVersion
DocumentModule[]
DocumentClaim[]
Template profile
```

输出：

```ts
RenderPlanOutput {
  render_projection: RenderProjectionDraft
  layout_warnings: LayoutWarning[]
  compression_suggestions: RevisionIssueDraft[]
}
```

### 11.2 禁止行为

Render Planner 不应改变事实含义。

篇幅压缩必须通过 Proposal 或 Issue，而不是静默删除内容。

## 12. Coach Narrator

### 12.1 职责

Coach Narrator 负责把系统状态转成用户可理解的说明。

它可以让产品感觉更有人味，但不能替代结构化对象。

输入：

```text
RevisionIssue[]
RevisionProposal[]
EvidenceSummary
Run status
```

输出：

```ts
CoachNarrationOutput {
  summary: string
  next_best_actions: ContextualAction[]
  tone: "calm" | "encouraging" | "warning" | "direct"
}
```

### 12.2 语言原则

Coach 的文字应该像有人在帮用户改稿：

- 具体。
- 克制。
- 不吓唬。
- 不假装比用户更懂他的经历。
- 不说空泛的“建议优化一下”。

示例：

```text
这段项目经历现在能看出你做了什么，但还看不出结果。可以补一个上线后指标、覆盖用户量，或你负责的范围。没有数字也没关系，我们可以先改成更保守的版本。
```

## 13. Agent 链路

### 13.1 导入旧简历

```text
Parser Agent
-> Resume Structurer
-> Evidence Verifier
-> Resume Reviewer
-> Resume Rewriter
-> Render Planner
-> Coach Narrator
```

### 13.2 空白创建

```text
Guided Intake Agent
-> Resume Structurer
-> Resume Rewriter
-> Evidence Verifier
-> Resume Reviewer
-> Render Planner
-> Coach Narrator
```

### 13.3 基础质量改稿

```text
Resume Reviewer
-> Resume Rewriter
-> Evidence Verifier
-> Render Planner
-> Coach Narrator
```

### 13.4 机会校准

```text
Opportunity Parser
-> Opportunity Calibrator
-> Resume Reviewer
-> Resume Rewriter
-> Evidence Verifier
-> Render Planner
-> Coach Narrator
```

## 14. Schema 校验和落库

Agent 输出落库前必须经过：

```text
raw model output
-> parse JSON
-> validate AgentOutputEnvelope
-> validate payload schema
-> normalize refs
-> domain policy check
-> write domain objects
-> update HarnessEvent
-> emit events
```

如果任何一步失败：

```text
不写 Draft
不应用 Proposal
不更新 accepted 状态
记录 HarnessEvent error
HarnessRun status = failed
```

## 15. Policy Guard

Agent 输出还必须经过领域策略检查。

### 15.1 简历真实性策略

以下内容必须要证据或用户确认：

- 数字成果。
- 团队规模。
- 预算规模。
- 职级。
- 管理人数。
- 业务影响。
- 获奖认证。
- 技术深度强主张。

### 15.2 导出策略

以下情况阻塞导出：

- 缺少联系方式。
- blocking issue 未处理。
- 强主张无证据且未确认。
- PDF 渲染失败。

### 15.3 JD 过拟合策略

以下情况必须提示风险：

- JD 关键词大量出现但经历中无支撑。
- 岗位要求被改写成用户已经具备。
- 用户没有确认的能力被强化成核心卖点。

## 16. 完成定义

Agent 层达到目标形态时，应满足：

1. 每个 Agent 有明确输入对象。
2. 每个 Agent 有明确输出 schema。
3. 每次 Agent 调用都有 HarnessEvent。
4. Agent 输出不能绕过领域服务落库。
5. Agent 不能直接写 accepted Draft。
6. 强主张必须走 Evidence 或 Confirmation。
7. 前端永远消费 WorkspaceView，而不是 Agent 原始输出。

如果 Agent 输出还需要前端用自然语言解析，说明设计失败。

