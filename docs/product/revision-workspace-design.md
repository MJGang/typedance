# Revision Workspace 终局设计

> 状态：产品与前端体验协议草案  
> 目标：定义前端如何消费 `DraftVersion`、`RevisionIssue`、`RevisionProposal`、`EvidenceLink` 等对象，并把它们映射成用户自然的改稿体验。

## 1. 核心定位

Revision Workspace 不是富文本编辑器，也不是聊天窗口。

它是用户处理改稿任务的工作台：

```text
新版草稿为主
问题卡引导下一步
旧版按需对比
来源可追溯
输入框只用于补充事实或表达偏好
```

用户不需要知道后端有多少 Agent，也不需要会写 prompt。

页面应该让用户自然感到：

```text
系统已经理解了我的旧文档。
系统已经生成了一版新稿。
系统知道哪些地方需要我确认。
我只需要逐步处理这些修改点。
```

## 2. Workspace View Model

前端不应该直接拼各种后端接口，而应该消费一个聚合视图。

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

### CoachSummary

```ts
CoachSummary {
  title: string
  message: string
  next_best_actions: RevisionAction[]
  tone: "calm" | "direct" | "warning"
}
```

`CoachSummary` 不是聊天消息，而是当前改稿状态的简短说明。

例如：

```text
我已经把旧简历整理成一版基础投递草稿。建议先确认 3 个成果数据，再处理技能模块的无证据技能。
```

## 3. 默认布局

默认布局不使用固定三栏。

原因：

- 简历或正式文档需要足够宽度阅读。
- 13 寸或 1366 宽屏强行三栏会拥挤。
- 旧版文档是参照，不应该长期抢占主视线。

推荐默认布局：

```text
┌──────────────────────────────────────────────┐
│ 顶部栏：文档名 / 状态 / 版本 / 导出 / 视图切换 │
├──────────────────────────────┬───────────────┤
│                              │               │
│ 新版草稿主画布                │ 待处理事项      │
│ render_projection             │ issues         │
│ 可编辑 / 可选中               │ proposals       │
│                              │ next actions   │
└──────────────────────────────┴───────────────┘
```

旧版和来源材料放入按需打开的抽屉：

```text
[旧版文档]
[来源材料]
[证据片段]
[识别出的事实]
```

## 4. 小屏布局

窄屏或移动端使用标签页：

```text
[新版草稿] [待处理] [来源]
```

用户点击某个问题卡时，可以切到局部处理视图：

```text
当前问题
旧版片段
新版片段
修改原因
操作按钮
```

小屏不应强行展示完整旧版和新版对照。

## 5. 主画布：新版草稿

主画布渲染 `render_projection`。

对于 Resume Pack：

```text
默认显示 A4 简历草稿。
模块区域可以被高亮。
Claim 可以显示风险标记。
用户点击模块或 Claim 时，右侧任务区同步定位。
```

主画布职责：

- 展示新稿。
- 承接 AI 修改结果。
- 允许用户手动微调。
- 标出问题位置。
- 支持局部对比入口。

主画布不应该承担：

- 全局聊天。
- 模板市场。
- 复杂主题编辑。
- 让用户从零规划文档。

## 6. 待处理事项区

待处理事项区消费 `RevisionIssue[]` 和 `RevisionProposal[]`。

推荐分组：

```text
待确认
需要用户确认真实性、数字、时间、贡献边界。

建议优化
可以接受或拒绝的改稿建议。

风险提示
隐私、夸大、证据不足、排版或导出风险。

已处理
用户已经接受、忽略、确认或回退的事项。
```

每张问题卡必须包含：

```ts
IssueCardView {
  issue_id: string
  title: string
  message: string
  target_label: string
  severity: "info" | "warning" | "blocking"
  status: string
  actions: RevisionAction[]
}
```

用户不应该只看到“建议优化一下”，而应该看到明确动作：

```text
这条成果缺少依据
“页面加载速度提升 35%”没有来源支撑。

[确认真实] [改成保守表达] [从材料中查找] [删除]
```

## 7. 局部对比视图

用户点击问题卡或修改标记时，进入局部对比。

局部对比由 `RevisionIssue` + `RevisionProposal` + `EvidenceLink` 组成。

```ts
ComparisonView {
  target_label: string
  original_text?: string
  proposed_text?: string
  rationale: string
  evidence_links: EvidenceLink[]
  actions: RevisionAction[]
}
```

示例：

```text
项目经历 · TypeDance 项目 · 第 2 条

旧版：
负责多个后台功能开发。

新版：
负责 B 端后台审批流模块开发，使用 React 与 TypeScript 重构核心页面，提升配置效率。

为什么这样改：
原文太泛，没有体现业务场景、技术栈和个人贡献。

[接受新版] [改得保守一点] [我补充更多事实] [保留旧版]
```

局部对比比整页双栏更重要，因为用户通常只需要判断某一个改动是否合理。

## 8. 来源抽屉

来源抽屉消费 `SourceDocumentSummary[]` 和 `EvidenceLink[]`。

它用于：

- 查看旧文档。
- 查看材料来源。
- 查看某条 Claim 的证据。
- 处理“从材料中查找”动作。

来源抽屉不应该成为默认主界面。

用户需要确认时才打开。

## 9. 输入框的角色

输入框可以存在，但不常驻为主角。

它的入口应该是：

```text
[补充一句我的想法]
[告诉系统更多背景]
[我想这样改]
```

用户输入后，系统不应该只回复聊天文本，而应该生成新的结构化结果：

```text
新的 RevisionRun
新的 RevisionProposal
更新后的 DraftVersion
更新后的 Issue 状态
```

例如用户输入：

```text
这个项目真正难点是权限系统，不是审批流。
```

系统输出应该是：

```text
已根据你的补充生成新的项目描述。
[查看改动] [应用] [继续调整]
```

## 10. 页面状态

### Processing

```text
系统正在解析文档、生成新稿、构建问题卡。
```

页面应展示具体阶段，而不是一个笼统 loading：

```text
正在识别文档结构
正在提取关键主张
正在生成新版草稿
正在检查证据和风险
```

### Ready For Review

```text
新稿已生成，问题卡已就绪。
```

用户开始处理任务。

### Awaiting User Input

某个动作需要用户补充：

```text
请确认这个数字是否真实。
请补充项目的真实上线时间。
```

### Export Blocked

存在 blocking issue。

页面应明确：

```text
还有 2 个导出前必须处理的问题。
```

并提供处理入口。

## 11. 操作流

### 接受建议

```text
用户点击 accept_proposal
-> 前端调用 execute action
-> 后端应用 Proposal
-> DraftVersion 更新
-> Issue 状态更新
-> 主画布刷新
```

### 用户确认事实

```text
用户点击 confirm_truth
-> 记录 user_confirmation
-> EvidenceLink.user_confirmed = true
-> Claim.confidence = user_confirmed
-> 相关 issue resolved
```

### 保守改写

```text
用户点击 rewrite_conservative
-> 创建 issue_action RevisionRun
-> 后端生成新 Proposal
-> 前端展示局部对比
```

### 补充想法

```text
用户输入自然语言
-> 创建 module_rewrite 或 issue_action RevisionRun
-> 系统输出结构化修改结果
-> 前端展示为 Proposal / Issue / Draft 更新
```

## 12. 视觉和语气原则

AI 的存在感来自：

- 改稿说明。
- 问题卡。
- 下一步按钮。
- 局部对比。
- 证据状态。

不来自：

- 强行拟人头像。
- 大聊天窗口。
- 连续气泡对话。

文案应该像专业改稿人在旁边说明：

```text
我把项目经历提前了，因为它比自我评价更能证明你的工程能力。
```

避免：

```text
我是你的 AI 助手，请问有什么可以帮您？
```

## 13. 与现有编辑器的关系

现有富文本编辑器可保留，但角色改变：

```text
过去：编辑器是产品主体。
未来：编辑器是 DraftVersion 的人工校准层。
```

用户仍然可以直接编辑新稿，但系统需要追踪：

- 用户手动改了哪个模块。
- 哪些 Claim 被改动。
- 原有证据状态是否仍然有效。
- 是否产生新的 issue。

## 14. 前端不可妥协原则

1. 新稿是主角，旧稿是参照。
2. 问题卡必须有动作，不能只给建议。
3. 聊天输入不能成为默认主入口。
4. 每个 AI 修改必须能定位到模块、条目或 Claim。
5. 用户每次点击都应该让文档状态前进。
6. 导出前必须明确 unresolved blocking issue。

