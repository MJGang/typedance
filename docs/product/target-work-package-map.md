# 目标工程工作包地图

> 状态：终局工程工作包  
> 适用范围：把 AI-native Resume Pack 的终局形态拆成可研发、可验收、可并行的工程工作包。  
> 重要说明：本文不是降低目标的 MVP 路线，也不是“先做个简单版”。这里列出的工作包共同构成最终系统，只是为了工程管理而拆分。

## 1. 总体依赖图

```text
WP1 Contracts
  -> WP2 Storage
  -> WP3 Revision Services
  -> WP4 Pack Runtime
  -> WP5 Agent Runtime
  -> WP6 Resume Agents
  -> WP7 Render Projection
  -> WP8 Revision API
  -> WP9 Workspace View
  -> WP10 Revision Workspace UI
  -> WP11 Import Flow
  -> WP12 Blank Guided Flow
  -> WP13 Quality Review
  -> WP14 Opportunity Calibration
  -> WP15 Export Gate
  -> WP16 Legacy Compatibility
  -> WP17 Test System
```

并行原则：

- Contracts 先稳定，否则前后端和 Agent 会反复漂移。
- Storage、Pack Runtime、Agent Runtime 可以并行设计，但必须依赖同一套 schema。
- UI 不应等待所有 Agent 真实可用才开始，但 UI 消费的必须是目标 `WorkspaceView`，可以用 mock 数据。
- Legacy Compatibility 只服务过渡，不定义新产品方向。

## 2. WP1 Contracts

目标：

```text
建立 Revision Engine 的跨端事实 schema。
```

产物：

- `Document` schema。
- `SourceDocument` schema。
- `ParsedBlock` schema。
- `DraftVersion` schema。
- `DocumentModule` schema。
- `DocumentClaim` schema。
- `EvidenceLink` schema。
- `RevisionIssue` schema。
- `RevisionProposal` schema。
- `RevisionRun` schema。
- `AgentStep` schema。
- `RenderProjection` schema。
- `WorkspaceView` schema。
- `ExportArtifact` schema。
- `DocumentPack` schema。
- `ResumePack` schema。

验收：

1. TypeScript 类型和 zod schema 一致。
2. Python Pydantic model 与 contracts 对齐。
3. `ResumeVersion` 被标记为 legacy projection。
4. 所有新增对象都有 schema 测试。

实现入口：

- `packages/contracts/src/shared.ts`
- `packages/contracts/src/legacy/*`
- `packages/contracts/src/revision/*`
- `packages/contracts/src/packs/*`

完成后，`ResumeVersion` 应只作为 legacy projection 保留；新系统的事实源从 `Document`、`DraftVersion`、`RevisionIssue`、`RevisionProposal`、`EvidenceLink` 和 `WorkspaceView` 开始。

## 3. WP2 Storage

目标：

```text
让 sidecar 能保存 Revision Engine 的核心领域对象。
```

产物：

- SQLite 表。
- Repository 层。
- migration 策略。
- 数据版本字段。
- legacy 数据兼容读取。

必需表：

```text
documents
source_documents
parsed_blocks
draft_versions
document_modules
document_claims
evidence_links
revision_runs
agent_steps
revision_issues
revision_proposals
revision_actions
user_confirmations
render_projections
export_artifacts
```

验收：

1. 每个对象能创建、读取、更新、关联查询。
2. `Document` 能查询当前 Draft、Issue、Source。
3. 删除 Document 不丢失审计所需的已导出记录，除非用户明确清理。
4. 旧 `resume-versions` 数据仍可读取。

## 4. WP3 Revision Services

目标：

```text
把领域对象封装成稳定服务，不让 API 和 Agent 直接操作数据库。
```

服务：

- `SourceService`
- `ParseService`
- `DraftService`
- `IssueService`
- `ProposalService`
- `EvidenceService`
- `WorkspaceService`
- `RenderService`
- `ExportService`

验收：

1. API 层只调用 service。
2. Agent Runtime 只通过 service 写领域对象。
3. Proposal 应用由 `DraftService` 执行。
4. Evidence 确认由 `EvidenceService` 执行。
5. WorkspaceView 由 `WorkspaceService` 聚合。

## 5. WP4 Pack Runtime

目标：

```text
把 Resume Pack 变成可加载、可校验、可执行的规则包。
```

产物：

- `DocumentPack` 定义。
- `ResumePack` 定义。
- ModuleSpec。
- IssueTypeSpec。
- ActionSpec。
- QualityRule。
- EvidenceRule。
- RenderMapping。
- AgentContract。

验收：

1. Resume Pack 声明所有简历模块。
2. Resume Pack 声明所有问题类型。
3. Resume Pack 声明动作模板。
4. Pack schema 可测试。
5. 组件和 prompt 中不散落 pack 规则。

## 6. WP5 Agent Runtime

目标：

```text
让所有 Agent 调用都可追踪、可校验、可失败恢复。
```

产物：

- Agent invocation context。
- Agent output envelope。
- AgentStep 记录。
- schema validator。
- policy guard。
- retry strategy。
- error taxonomy。

验收：

1. Agent 输出校验失败不能写 Draft。
2. 每次调用都有 AgentStep。
3. 每个输出都有 run_id 和 schema_version。
4. failed_schema、failed_tool、failed_model、failed_policy 能区分。
5. Policy Guard 能阻止无证据强主张静默进入 accepted Draft。

## 7. WP6 Resume Agents

目标：

```text
实现 Resume Pack 所需 Agent 能力。
```

Agent：

- Parser Agent。
- Resume Structurer。
- Resume Reviewer。
- Resume Rewriter。
- Evidence Verifier。
- Opportunity Calibrator。
- Render Planner。
- Coach Narrator。

验收：

1. Parser 只解析，不重写。
2. Structurer 输出模块和 Claim。
3. Reviewer 输出 Issue。
4. Rewriter 输出 Proposal 或 Follow-up Question。
5. Evidence Verifier 输出 EvidenceLink 和 Claim confidence。
6. Opportunity Calibrator 不虚构经历。
7. Coach Narrator 只负责说明和 next action，不替代结构化对象。

## 8. WP7 Render Projection

目标：

```text
把结构化 Draft 稳定投影为默认模板渲染输入。
```

产物：

- Draft to HTML。
- Draft to doc_json。
- Draft to PDF input。
- layout warning。
- compact suggestion issue。
- legacy `ResumeVersion` projection adapter。

验收：

1. `doc_json` 可从 Draft 重新生成。
2. 中文和英文默认模板正常。
3. layout risk 生成 Issue 或 warning。
4. 预览和导出不漂移。
5. Renderer 不读取 Agent 原始输出。

## 9. WP8 Revision API

目标：

```text
提供终局 API 面。
```

接口组：

- Documents。
- Sources。
- RevisionRuns。
- Drafts。
- Issues。
- Proposals。
- Claims / Evidence。
- Contextual Inputs。
- Opportunities。
- WorkspaceView。
- Export。

验收：

1. 首页创建 Document。
2. 导入创建 Source 和 RevisionRun。
3. 工作台读取 WorkspaceView。
4. 用户动作通过 Issue / Proposal / Claim API。
5. 导出通过 Draft API。
6. `resume-versions` 标记为 legacy。

## 10. WP9 Workspace View

目标：

```text
为前端提供稳定、完整、可直接渲染的工作台视图。
```

产物：

- WorkspaceView composer。
- Issue grouping。
- Module summary。
- Evidence summary。
- QualityGate summary。
- CoachSummary。
- available actions。

验收：

1. 前端不需要读取 Agent 输出。
2. 前端不需要自行拼多接口形成主页面。
3. Issue 能定位 Module / Claim / Proposal。
4. Evidence 能定位 Source snippet。
5. QualityGate 能判断导出状态。

## 11. WP10 Revision Workspace UI

目标：

```text
实现 AI-native 改稿工作台。
```

组件：

- `RevisionWorkspacePage`
- `DraftCanvas`
- `ModuleNavigator`
- `IssueQueue`
- `IssueDetail`
- `ProposalDiff`
- `EvidenceDrawer`
- `SourceDrawer`
- `ContextualInput`
- `QualityGatePanel`
- `ExportPanel`

验收：

1. 默认主角是新版草稿。
2. 默认右侧是问题卡。
3. 旧稿和来源按需查看。
4. 点击 Issue 展示局部对比。
5. 输入框绑定上下文。
6. 小屏不强行三栏。
7. 样式和主题不作为主流程。

## 12. WP11 Import Flow

目标：

```text
导入旧简历后自动形成完整改稿任务。
```

流程：

```text
Create Document
-> Add Source
-> Run import_reconstruct
-> Generate Draft
-> Generate Issues
-> Generate Proposals
-> Generate Evidence
-> Render Projection
-> WorkspaceView
```

验收：

1. 上传或粘贴旧简历后不进入空白编辑器。
2. 系统生成新版草稿。
3. 系统生成问题卡。
4. 用户能看局部对比。
5. 用户能接受或拒绝建议。

## 13. WP12 Blank Guided Flow

目标：

```text
用户从空白开始时，系统通过模块和问题引导生成初稿。
```

流程：

```text
选择身份状态
-> 填基本信息
-> 按模块追问经历
-> 生成 Draft
-> 标记缺失和待确认
-> 进入 Workspace
```

验收：

1. 用户不会面对空白 A4。
2. 工作经历、项目经历、技能等难写模块有引导。
3. 用户回答进入 Source 或 UserInputNote。
4. 初稿生成后有 Issue 和 Proposal。

## 14. WP13 Quality Review

目标：

```text
支持无 JD 的基础简历质量改稿。
```

检查：

- 模块完整性。
- 时间线。
- 弱表达。
- 缺成果。
- 缺证据。
- 技能和经历不一致。
- 篇幅。
- 风格。
- HR 可读性。
- 导出风险。

验收：

1. 没有 JD 也能运行。
2. 输出 Issue。
3. 输出 Proposal。
4. 高风险主张进入确认。
5. 导出前能阻塞关键问题。

## 15. WP14 Opportunity Calibration

目标：

```text
在基础简历之上生成岗位版本，而不是把 JD 当唯一起点。
```

流程：

```text
Add Opportunity
-> Parse requirements
-> Compare base Draft
-> Generate variant proposals
-> Mark risks
-> Create opportunity Draft
```

验收：

1. JD 可选。
2. 基础简历和岗位版本并存。
3. 系统不虚构经历。
4. 过度匹配被标记。
5. 岗位版本可导出。

## 16. WP15 Export Gate

目标：

```text
确保导出基于 accepted Draft 和质量检查。
```

产物：

- QualityGate。
- blocking issue 检查。
- PDF export artifact。
- HTML export artifact。
- preview/export consistency。

验收：

1. 缺联系方式阻塞。
2. 未确认强主张阻塞或明确风险导出。
3. layout risk 提示。
4. ExportArtifact 关联 Draft。
5. 导出的 PDF 可投递。

## 17. WP16 Legacy Compatibility

目标：

```text
让旧系统资产可用，但不再定义新主线。
```

产物：

- Legacy ResumeVersion projection。
- Existing resume import adapter。
- Existing PDF renderer adapter。
- Legacy workspace fallback。
- Template style internalization。

验收：

1. 旧简历可打开。
2. 旧 PDF 导出能力可复用。
3. legacy API 不影响新 WorkspaceView。
4. 主题系统降级为渲染配置。

## 18. WP17 Test System

目标：

```text
用测试保护 AI-native 结构不退化。
```

测试组：

- Contract tests。
- Repository tests。
- Service tests。
- Agent output schema tests。
- Policy tests。
- API tests。
- Workspace component tests。
- Import flow tests。
- Export tests。

关键防退化测试：

1. AI 输出字符串不能直接写 Draft。
2. `doc_json` 不能作为唯一事实源。
3. Proposal 接受必须改变 Draft 并保留历史。
4. 缺证据强主张不能进入 accepted Draft。
5. WorkspaceView 必须包含 Issue / Proposal / Evidence。
6. 小屏仍能处理 Issue。

## 19. 并行研发边界

可以并行：

- WP1 Contracts 和 WP4 Pack Runtime 共同设计。
- WP2 Storage 和 WP3 Services。
- WP5 Agent Runtime 和 WP6 Agent mock output。
- WP9 WorkspaceView 和 WP10 UI mock。
- WP7 Render Projection 和 WP15 Export Gate。

不应并行冲突：

- 两个工作流同时改同一套 schema。
- UI 直接绕过 WorkspaceView 调 API。
- Agent 直接写数据库。
- Render 直接依赖 legacy ResumeVersion 成为新核心。

## 20. 完整完成定义

当全部工作包完成时，TypeDance Resume Pack 应具备：

```text
导入旧简历
-> 自动解析和重构
-> 生成新版草稿
-> 生成问题卡
-> 生成可解释修改建议
-> 追踪证据和确认
-> 用户逐条处理
-> 导出默认可投递 PDF
```

以及：

```text
从空白开始
-> 模块化引导
-> 生成基础简历
-> 基础质量改稿
-> 后续机会校准
-> 多版本管理
```

如果这些都成立，系统才从“简历编辑器”进入“AI-native 简历改稿系统”。
