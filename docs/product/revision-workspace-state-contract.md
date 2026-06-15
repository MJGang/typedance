# Revision Workspace 状态契约

> 状态：终局前端状态契约  
> 适用范围：Revision Workspace 如何消费 `WorkspaceView`，如何组织组件状态，如何把用户操作映射回 Revision API。  
> 重要说明：本文不是视觉稿，而是前端状态和交互对象边界。视觉设计可以调整，但状态模型不能退回 `docJson + AI 聊天框`。

## 1. 核心原则

Revision Workspace 的主状态不是编辑器 JSON。

主状态是：

```text
WorkspaceView
+ UI Selection State
+ Pending Action State
```

前端不持有产品事实源。

前端只持有：

- 当前选中哪个模块。
- 当前选中哪个问题。
- 当前打开哪个来源抽屉。
- 当前哪个动作正在执行。
- 当前局部输入框的临时文本。
- 当前编辑器里的未保存局部修改。

所有会改变文档事实的动作，都必须回到 API。

## 2. 主数据源

```ts
type RevisionWorkspaceState = {
  workspaceView: WorkspaceView | null
  loadingState: WorkspaceLoadingState
  selection: WorkspaceSelection
  panels: WorkspacePanelState
  pendingAction: PendingActionState | null
  localInput: LocalInputState
  localDraftEdit: LocalDraftEditState
}
```

`workspaceView` 来自：

```text
GET /documents/{document_id}/workspace-view
```

它包含页面渲染所需的主要数据：

```text
document
current_draft
modules
claims
issues
proposals
evidence
source_summaries
render_projection
quality_gate
run_status
coach_summary
available_actions
```

## 3. Selection State

```ts
type WorkspaceSelection = {
  selectedModuleId?: string
  selectedClaimId?: string
  selectedIssueId?: string
  selectedProposalId?: string
  selectedSourceId?: string
}
```

选择状态只影响 UI 展示，不直接改变后端数据。

典型行为：

- 点击模块：设置 `selectedModuleId`。
- 点击 Claim 标记：设置 `selectedClaimId`，并筛选相关 Issue / Evidence。
- 点击问题卡：设置 `selectedIssueId`，打开 Issue Detail。
- 点击 Proposal：设置 `selectedProposalId`，展示 before / after。
- 点击证据：设置 `selectedSourceId`，打开 Source Drawer。

## 4. Panel State

```ts
type WorkspacePanelState = {
  rightPanel:
    | "issues"
    | "issue_detail"
    | "evidence"
    | "quality_gate"
    | "export"
    | "contextual_input"
  sourceDrawerOpen: boolean
  comparisonMode: "none" | "issue_local" | "module" | "draft"
  mobileTab: "draft" | "issues" | "sources"
}
```

默认：

```text
rightPanel = "issues"
comparisonMode = "none"
sourceDrawerOpen = false
```

样式面板和主题选择不属于默认右侧主面板。

## 5. Pending Action State

```ts
type PendingActionState = {
  actionKind:
    | "execute_issue_action"
    | "accept_proposal"
    | "reject_proposal"
    | "revise_proposal"
    | "confirm_claim"
    | "add_contextual_input"
    | "accept_draft"
    | "export_draft"
  targetId: string
  status: "idle" | "submitting" | "waiting_run" | "refreshing_workspace" | "failed"
  error?: string
}
```

前端执行动作后，必须刷新 `WorkspaceView`。

不允许只在前端本地模拟领域状态。

## 6. Local Input State

```ts
type LocalInputState = {
  text: string
  inputType: "fact" | "preference" | "instruction" | "clarification"
  target?: RevisionTarget
  relatedIssueId?: string
  relatedProposalId?: string
  relatedModuleId?: string
}
```

输入框不是全局聊天中心。

它必须绑定上下文：

- 当前 Issue。
- 当前 Proposal。
- 当前 Module。
- 当前 Claim。

如果没有上下文，输入框应引导用户选择任务，而不是展示空白聊天。

## 7. Local Draft Edit State

用户可以手动编辑草稿，但手动编辑也不能绕开结构化系统。

```ts
type LocalDraftEditState = {
  dirty: boolean
  editedModuleIds: string[]
  editedClaimIds: string[]
  pendingPatch?: DraftPatch
  lastSavedAt?: string
}
```

手动编辑保存时，应调用：

```text
POST /drafts/{draft_id}/patch
```

或等价的结构化 patch API。

不能直接：

```text
PATCH /resume-versions/{id} doc_json
```

除非处于 legacy 兼容模式。

## 8. 组件边界

### 8.1 `RevisionWorkspacePage`

职责：

- 拉取 WorkspaceView。
- 维护 selection / panels / pendingAction。
- 处理全局刷新。
- 分发数据到子组件。

不负责：

- 渲染具体模块内容细节。
- 解释 Agent 输出。
- 拼 prompt。

### 8.2 `DraftCanvas`

职责：

- 展示当前 Draft。
- 显示模块边界。
- 显示 Claim 状态。
- 响应模块、Claim、Issue 高亮。
- 提供局部编辑入口。

输入：

```ts
DraftCanvasProps {
  draft: DraftVersion
  modules: DocumentModule[]
  claims: DocumentClaim[]
  issues: RevisionIssue[]
  evidence: EvidenceLink[]
  renderProjection: RenderProjection
  selection: WorkspaceSelection
}
```

输出事件：

```text
onSelectModule
onSelectClaim
onRequestLocalEdit
onOpenEvidence
```

### 8.3 `IssueQueue`

职责：

- 展示问题卡列表。
- 按 severity、module、status 筛选。
- 显示导出阻塞。

输入：

```ts
IssueQueueProps {
  issues: RevisionIssue[]
  modules: DocumentModule[]
  selectedIssueId?: string
}
```

输出事件：

```text
onSelectIssue
onDismissIssue
onExecuteAction
```

### 8.4 `IssueDetail`

职责：

- 展示问题详情。
- 展示相关 Proposal。
- 展示证据摘要。
- 提供动作按钮。

必须展示：

- 问题是什么。
- 为什么是问题。
- 影响哪段内容。
- 建议怎么改。
- 是否阻塞导出。
- 需要用户补什么。

### 8.5 `ProposalDiff`

职责：

- 展示 before / after。
- 显示修改理由。
- 显示风险。
- 显示证据。
- 提供接受、拒绝、重写动作。

禁止：

```text
只展示一段“AI 建议如下”的文本。
```

### 8.6 `EvidenceDrawer`

职责：

- 展示来源片段。
- 展示 support_level。
- 展示 confidence。
- 提供用户确认入口。

### 8.7 `ContextualInput`

职责：

- 根据当前上下文收集补充信息。
- 提交到 Contextual Input API。
- 不直接改 Draft。

输入框文案应根据上下文变化。

例如：

```text
当前是缺少成果问题：
“补充一个结果、范围或影响。没有数字也可以描述变化。”

当前是证据确认：
“这条经历是否真实发生？你可以补充更准确的范围。”
```

## 9. 用户动作到 API 映射

| 用户动作 | API | 结果 |
| --- | --- | --- |
| 导入旧简历 | `POST /documents` + `POST /sources` + `POST /packs/resume/runs` | 创建 Document、Source，并由 TS Agent Host 启动 HarnessRun |
| 点击问题卡 | 无 API | 更新本地 selection |
| 接受建议 | `POST /proposals/{id}/accept` | 更新 Draft / Issue / RenderProjection |
| 拒绝建议 | `POST /proposals/{id}/reject` | 更新 Proposal 状态 |
| 要求更保守 | `POST /packs/resume/runs` | 当前 pack plugin 生成新 Proposal |
| 补充事实 | `POST /contextual-inputs` 或 `POST /packs/resume/runs` | 创建 Source，必要时由当前 pack plugin 继续生成 Proposal |
| 确认主张 | `POST /claims/{id}/confirm` | 更新 Claim / Evidence / Issue |
| 忽略问题 | `POST /issues/{id}/dismiss` | 更新 Issue 状态 |
| 导出 PDF | `POST /drafts/{id}/export/pdf` | 创建 ExportArtifact |

## 10. 页面状态

### 10.1 空状态

没有 Document 时，页面展示任务入口：

- 导入旧简历。
- 新建基础简历。
- 打开已有项目。

不展示空白 A4 编辑器。

### 10.2 运行中

HarnessRun 运行中时，页面展示分阶段进度：

```text
解析来源
理解结构
生成草稿
检查证据
生成问题卡
准备预览
```

不只展示一个泛泛的 loading。

### 10.3 需要用户输入

当 run 进入 `awaiting_user_confirmation`：

- 高亮对应 Issue。
- 打开 ContextualInput。
- 明确用户需要补什么。

### 10.4 可审阅

当 run 进入 `ready_for_review`：

- 主画布显示 Draft。
- 右侧显示 IssueQueue。
- CoachSummary 给出简短总结。

### 10.5 可导出

当 QualityGate 通过：

- 导出按钮可用。
- 仍可提示非阻塞建议。

### 10.6 阻塞导出

当存在 blocking issue：

- 导出按钮进入受限状态。
- 展示阻塞原因。
- 提供处理动作。

## 11. 响应式布局

### 11.1 宽屏

```text
DraftCanvas + TaskRail + ContextPanel
```

DraftCanvas 是主角。

### 11.2 中屏

```text
DraftCanvas + collapsible TaskRail
ContextPanel 作为抽屉
```

### 11.3 小屏

```text
Tabs:
  Draft
  Issues
  Sources

IssueDetail / ProposalDiff 使用 bottom sheet
```

小屏不能丢失：

- 问题处理。
- Proposal 决策。
- Evidence 查看。
- 导出检查。

## 12. 与现有 Workspace 的关系

现有 `WorkspacePage` 的核心状态：

```text
resume
docJson
styleConfig
selectedThemeId
activeBlock
exportStatus
```

终局 `RevisionWorkspacePage` 的核心状态：

```text
workspaceView
selection
panels
pendingAction
localInput
localDraftEdit
```

现有 `ResumeRichTextEditor` 可以被复用为 `DraftCanvas` 的局部编辑能力。

但不能继续让它拥有产品主状态。

## 13. 完成定义

Revision Workspace 达到目标形态时，应满足：

1. 页面主数据来自 `WorkspaceView`。
2. 默认右侧面板是问题队列，不是样式或聊天。
3. 点击 Issue 可以看到 Proposal、Evidence 和动作。
4. 输入框绑定上下文，不是空白全局聊天。
5. 接受 Proposal 后刷新 WorkspaceView。
6. 手动编辑以 DraftPatch 进入系统。
7. 导出基于 Draft 和 QualityGate。
8. 小屏仍能完成问题处理和导出。

