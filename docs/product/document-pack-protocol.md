# Document Pack 协议设计

> 状态：产品与工程协议草案  
> 目标：定义 TypeDance 如何通过不同 Document Pack 支持简历、博客、作文、小说、述职等不同文档类型的 AI-native 改稿。

## 1. Pack 的意义

不同文档类型的“好”完全不同。

```text
简历：可信、清晰、可扫读、能获得面试机会。
博客：观点清楚、结构顺畅、开头有钩子、读者愿意读完。
作文：立意明确、论证完整、语言规范。
小说：人物动机、冲突、节奏、对白、伏笔。
述职：贡献边界、业务结果、影响力、证据充分。
```

因此，Document Pack 不是一组 prompt，而是一套文档类型规则包。

```text
Document Pack =
- 文档目标
- 模块结构
- 质量标准
- 问题类型
- 可执行修改动作
- 证据要求
- 输出格式
- 语气策略
- 渲染映射
```

AI 编排能力不写入 Python Pack manifest。TS Agent Host 通过独立插件配置把当前 pack 映射为可加载的 plugin 集合和 Harness `capability_policy`。

## 2. Pack 顶层结构

```ts
DocumentPack {
  id: string
  name: string
  description: string

  module_specs: ModuleSpec[]
  issue_specs: IssueSpec[]
  action_specs: ActionSpec[]
  quality_rules: QualityRule[]
  evidence_rules: EvidenceRule[]
  render_mapping: RenderMapping
}
```

## 3. ModuleSpec

`ModuleSpec` 定义某个文档类型有哪些语义模块，以及每个模块如何被 AI 理解、生成和审核。

```ts
ModuleSpec {
  type: string
  title: string
  description: string
  required: boolean
  repeatable: boolean
  item_schema: object
  quality_rule_ids: string[]
  allowed_action_ids: string[]
}
```

模块不是视觉区块，而是 AI 可操作对象。

## 4. IssueSpec

`IssueSpec` 定义系统能发现哪些问题。

```ts
IssueSpec {
  type: string
  title: string
  description: string
  default_severity: "info" | "warning" | "blocking"
  applicable_module_types: string[]
  allowed_action_ids: string[]
}
```

问题必须满足：

- 有明确位置。
- 有用户能理解的原因。
- 有可执行动作。
- 能被解决、忽略或保留为风险。

## 5. ActionSpec

`ActionSpec` 定义用户可以执行的动作。

```ts
ActionSpec {
  type: string
  label: string
  description: string
  requires_input: boolean
  resolves_issue: boolean
  creates_new_run: boolean
  payload_schema?: object
}
```

动作不是按钮文案，而是后端流程入口。

例如用户点击“改成保守表达”：

```text
TS Agent Host 创建 HarnessRun(action = issue_action)
-> Harness Runtime 在当前 pack 的 plugin 边界内选择工具/agent
-> 通过 MCP/HTTP 调用 Python 业务能力
-> 生成新的 RevisionProposal
-> 更新 DraftVersion
-> 关闭或更新 RevisionIssue
```

## 6. QualityRule

```ts
QualityRule {
  id: string
  name: string
  description: string
  severity: "info" | "warning" | "blocking"
  check_target: "document" | "module" | "item" | "claim"
}
```

质量规则必须由 Pack 声明，不能散落在 prompt 里。

## 7. EvidenceRule

```ts
EvidenceRule {
  id: string
  description: string
  applies_to_claim_types: string[]
  required_support_level:
    | "direct"
    | "partial"
    | "inferred"
    | "user_confirmed"
  export_policy:
    | "allow"
    | "warn"
    | "block_until_confirmed"
}
```

不同 Pack 对证据要求不同。

简历、述职、晋升材料需要强证据；小说、博客创意改写则不一定要求事实来源。

## 8. TS Plugin Binding

```ts
PluginBinding {
  plugin_id: string
  actions: string[]
  scopes: string[]
  tools?: string[]
  agents?: string[]
  skills?: string[]
}
```

PluginBinding 不写入 Python Pack manifest，而是由 TS Agent Host 维护。Pack 只定义业务语义，TS plugin 决定某个 action 可使用哪些 skill、MCP tool 或 agent。

Agent / skill 必须输出结构化对象。

禁止把下面这种内容作为主要输出：

```text
我建议你优化这一段。
```

应该输出：

```json
{
  "issue_type": "vague_expression",
  "target": {
    "module_id": "project_experience",
    "claim_id": "claim_123"
  },
  "message": "这条表达过于空泛。",
  "actions": ["rewrite_stronger", "keep_original"]
}
```

## 9. 通用 Revision 对象

### RevisionIssue

```ts
RevisionIssue {
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

### RevisionProposal

```ts
RevisionProposal {
  id: string
  run_id: string

  target: RevisionTarget
  operation:
    | "replace_text"
    | "insert_text"
    | "delete_text"
    | "rewrite_claim"
    | "rewrite_module"
    | "reorder_module"
    | "hide_module"
    | "split_module"
    | "merge_module"
    | "create_module"
    | "compress_module"
    | "expand_module"

  original_snapshot?: unknown
  proposed_snapshot: unknown

  summary: string
  rationale: string

  related_issue_ids: string[]
  evidence_link_ids: string[]

  confidence: number
  risk_level: "low" | "medium" | "high"
  requires_user_confirmation: boolean

  status:
    | "pending"
    | "applied"
    | "rejected"
    | "edited"
    | "superseded"

  created_by_agent: string
  created_at: string
}
```

### DraftVersion

```ts
DraftVersion {
  id: string
  document_id: string
  run_id: string
  pack_id: string

  modules: DocumentModule[]
  summary: string

  applied_proposal_ids: string[]
  unresolved_issue_ids: string[]

  render_projection?: {
    doc_json?: unknown
    html?: string
  }

  status:
    | "generated"
    | "in_review"
    | "accepted"
    | "exported"

  created_at: string
  updated_at: string
}
```

## 10. HarnessRun 生命周期

```ts
HarnessRun {
  id: string
  status: "queued" | "running" | "awaiting_input" | "completed" | "failed" | "canceled"
  capability_policy: CapabilityPolicy
  created_at: string
  updated_at: string
}
```

HarnessRun 属于 TS Harness Runtime。Pack 协议不定义 run 状态机，只允许业务对象通过 `run_id` 引用外部运行来源。

## 11. 服务边界

```text
Pack Registry
保存 Document Pack 定义。

Source Service
导入、解析、保存来源材料。

Understanding Service
拆分模块、事实、主张。

Agent Host
管理 pack 到 plugin 的绑定，并调用 Harness Runtime。

Harness Runtime
管理 HarnessRun 生命周期、工具调用、权限、上下文和事件流。

Draft Service
保存 DraftVersion，应用 RevisionProposal。

Evidence Service
管理 EvidenceLink 和用户确认。

Issue Service
管理 RevisionIssue 和 RevisionAction。

Render Service
把 DraftVersion 投影成 HTML、doc_json、PDF。

Export Service
导出 accepted DraftVersion。
```

## 12. 系统原则

1. Pack 定义文档类型的质量标准，Agent 负责执行，不反过来。
2. Agent 不能直接修改 accepted Draft。
3. 高风险 Proposal 不能自动应用。
4. Issue 关闭必须有动作记录。
5. 导出必须基于 accepted DraftVersion。
6. 渲染投影不是事实源。

