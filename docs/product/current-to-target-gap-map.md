# 当前系统到终局系统差距图

> 状态：工程边界说明  
> 适用范围：TypeDance 从当前简历编辑器形态迁移到 AI-native Resume Pack 的产品和工程决策  
> 重要说明：本文不是阶段路线图，而是终局约束。任何后续实现都应避免把当前临时模型继续固化为产品核心。

## 1. 一句话结论

当前系统已经具备“简历编辑和导出”的可用基础，但它的核心模型仍然是：

```text
ResumeVersion
+ template_id
+ doc_json
+ plain_text_snapshot
+ PDF export
```

这更接近：

```text
富文本简历编辑器 + 模板样式 + 导出
```

而终局系统应当是：

```text
Document
+ SourceDocument
+ DraftVersion
+ DocumentModule
+ DocumentClaim
+ EvidenceLink
+ RevisionIssue
+ RevisionProposal
+ RenderProjection
+ ExportArtifact
```

也就是：

```text
AI-native 改稿系统 + Resume Pack + 默认渲染器
```

## 2. 当前系统可保留资产

### 2.1 编辑器基础

当前 `ResumeRichTextEditor` 提供了 TipTap 编辑能力。

可保留价值：

- 文本编辑。
- 基础格式。
- 选区感知。
- A4 编辑体验实验。
- 局部手动修正能力。

终局定位：

```text
编辑器是 Draft 的局部编辑和修正工具，不再是简历事实源。
```

### 2.2 A4 渲染和 PDF 导出

当前系统已有 HTML / PDF 渲染链路。

可保留价值：

- 默认模板渲染。
- PDF 导出。
- 预览和导出复用。
- 样式生成经验。

终局定位：

```text
Renderer 接收 RenderProjection，而不是直接把 ResumeVersion.doc_json 当作唯一输入。
```

### 2.3 默认模板和样式引擎

当前 `classic-a4`、`TemplateStyleConfig`、block style、CSS generator 可以作为默认模板资产继续使用。

但它们应被降级为：

```text
默认渲染能力
```

而不是产品主线。

### 2.4 本地优先 sidecar

当前 sidecar 已承担本地存储、渲染、导出等能力。

终局可以继续让 sidecar 承担：

- 本地文档存储。
- 来源材料保存。
- 文件解析。
- 渲染导出。
- 本地任务状态。

但需要新增 Revision Engine 所需的数据对象和服务边界。

## 3. 当前系统需要降级的部分

### 3.1 模板库

模板库不应继续作为核心增长方向。

保留：

- 一个高质量默认模板。
- 必要的模板预览。
- 基础模板元信息。

暂停强化：

- 多模板市场。
- 模板样式自由编辑。
- 复杂模板切换。
- 用户自定义主题体系。

原因：

```text
简历产品的核心竞争力不在花哨模板，而在结构化理解、可信改稿和可投递结果。
```

### 3.2 主题概念

当前系统有 `selectedThemeId`、主题选择和样式配置。

终局中主题应降级为内部样式 token 或默认模板变体。

用户不应被迫理解：

- 主题。
- 样式 preset。
- block style。
- 模板 fork。

这些能力可以保留给内部渲染，不作为主线产品概念暴露。

### 3.3 AI Tab / 聊天式入口

当前工作台中的 AI 面板不能成为终局交互中心。

终局中 AI 输入应该退到第二层：

- 补充事实。
- 解释背景。
- 追问某个建议。
- 修改某个 Proposal。

AI 输出不能直接写入最终简历，必须转为结构化对象：

```text
Issue
Proposal
Claim
Evidence
Draft patch
```

## 4. 当前系统必须重做的核心

### 4.1 数据事实源

当前事实源：

```text
ResumeVersion.doc_json
```

终局事实源：

```text
DraftVersion
+ DocumentModule
+ DocumentClaim
+ EvidenceLink
+ RevisionIssue
+ RevisionProposal
```

`doc_json` 必须降级为渲染投影：

```text
DraftVersion -> RenderProjection -> doc_json / HTML / PDF
```

不能继续围绕 `doc_json` 扩展 AI 能力，否则系统会被锁死在富文本编辑器模型里。

### 4.2 导入旧简历

当前“新建简历 / 模板样张”本质是创建一个 `ResumeVersion`。

终局导入旧简历应创建：

```text
Document
+ SourceDocument
+ ParsedBlock
+ HarnessRun
+ DraftVersion
+ RevisionIssue
+ RevisionProposal
```

导入动作不是“把旧文本塞进编辑器”，而是“启动一次改稿任务”。

### 4.3 从空白开始

当前从模板开始容易把用户带进空白编辑。

终局空白创建必须由 Resume Pack 模块驱动：

```text
身份状态选择
-> 模块引导
-> 事实补充
-> 初稿生成
-> 问题卡确认
```

用户不应面对一个空白 A4 页面后自己想怎么写。

### 4.4 模块管理

当前模块主要来自富文本结构或模板块。

终局模块必须是 Resume Pack 语义模块：

```text
BasicInfo
CareerSummary
CoreSkills
WorkExperience
ProjectExperience
Education
Certificates
Portfolio
CustomModule
```

每个模块必须带状态：

```text
clean
needs_review
needs_confirmation
weak
hidden
```

模块管理不是拖拽区块那么简单，而是：

```text
模块质量
+ 模块证据
+ 模块问题
+ 模块动作
+ 当前版本可见性
```

### 4.5 改稿对象

当前系统如果增加 AI，很容易变成：

```text
选中文本
-> AI 返回一段新文本
-> 替换 doc_json
```

终局必须是：

```text
选中或系统发现问题
-> RevisionIssue
-> RevisionProposal
-> 用户决策
-> Draft patch
-> RenderProjection 更新
```

每次重要改动都应可追踪、可回退、可解释。

## 5. 当前对象到终局对象映射

| 当前对象 | 终局定位 | 处理方式 |
| --- | --- | --- |
| `ResumeVersion` | 兼容层 / 导出版本摘要 | 不再作为核心事实源 |
| `template_id` | 默认渲染模板引用 | 保留，但不作为主线产品能力 |
| `doc_json` | RenderProjection 的一种输出 | 降级为渲染投影 |
| `plain_text_snapshot` | 搜索和兼容快照 | 保留为派生数据 |
| `TemplateStyleConfig` | 默认模板样式 token | 内部化，减少用户感知 |
| `StylePanel` | 高级样式工具 | 从主线工作台移除或折叠 |
| `AiTab` | 补充沟通入口 | 不能作为主交互中心 |
| `ResumeRichTextEditor` | Draft 局部编辑器 | 作为工作台子组件保留 |
| PDF export | 正式导出能力 | 保留，但输入改为 accepted Draft |

## 6. 新增目标对象

终局需要新增以下对象。

### 6.1 `Document`

一份简历改稿项目。

它不是 PDF，也不是编辑器 JSON。

### 6.2 `SourceDocument`

用户导入或补充的来源材料。

例如旧简历、工作总结、项目材料、粘贴文本。

### 6.3 `ParsedBlock`

来源材料解析后的片段。

用于证据定位和模块识别。

### 6.4 `DraftVersion`

一次结构化新稿。

它包含模块、主张、证据、问题和渲染投影。

### 6.5 `DocumentModule`

Resume Pack 的语义模块。

模块是 AI 处理和用户理解的共同边界。

### 6.6 `DocumentClaim`

简历里的关键主张。

例如一条成果 bullet、一个技能主张、一句职业摘要。

### 6.7 `EvidenceLink`

主张和来源之间的证据关系。

用于判断可信度和是否需要用户确认。

### 6.8 `RevisionIssue`

问题卡。

用户处理的是 Issue，而不是 prompt。

### 6.9 `RevisionProposal`

AI 的具体修改建议。

Proposal 必须包含 before / after / reason / evidence / risk。

### 6.10 `RenderProjection`

把结构化 Draft 转成可渲染内容。

包括 HTML、doc_json、PDF 输入、分页提示等。

## 7. 前端目标边界

当前 `WorkspacePage` 主要围绕：

```text
resume
docJson
styleConfig
selectedThemeId
activeBlock
exportStatus
```

终局 `RevisionWorkspace` 应围绕：

```text
WorkspaceView
currentDraft
issues
selectedIssue
proposals
sourceSnippets
renderProjection
qualityGate
```

### 7.1 主画布

主画布显示新版草稿。

它不只是可编辑文本，还要知道：

- 每段属于哪个模块。
- 哪些 Claim 有问题。
- 哪些 Claim 有证据。
- 哪些 Claim 需要确认。
- 哪些 Proposal 可接受。

### 7.2 任务侧栏

右侧不应优先是样式面板或聊天面板，而应是：

- 问题卡。
- 待确认事实。
- 缺失信息。
- 导出前阻塞项。
- 可执行动作。

### 7.3 来源抽屉

旧简历和材料默认收起。

用户处理 Issue 时，可打开来源抽屉查看对应证据。

### 7.4 输入入口

输入入口是上下文相关的：

- 在模块里补充事实。
- 在 Issue 里解释背景。
- 在 Proposal 里要求更保守或更具体。

不应只有一个全局聊天框。

## 8. 后端目标边界

当前 sidecar 服务围绕简历版本、模板样式和导出。

终局需要新增：

- Source Service。
- Parse Service。
- Draft Service。
- Issue Service。
- Proposal Service。
- Evidence Service。
- Agent Host。
- Pack Registry。
- Render Service。
- Export Service。

关键要求：

```text
Agent 原始输出不能直接给前端当产品状态。
```

Agent 输出必须经过：

```text
Schema Validator
-> Domain Service
-> Workspace View Composer
```

前端消费的是稳定的 Workspace View。

## 9. API 目标边界

当前 API 类似：

```text
GET /resume-versions
PATCH /resume-versions/:id
POST /resume-versions
POST /pdf-export
GET /template-styles
PUT /template-styles/:id
```

终局 API 应扩展为：

```text
Python Sidecar 业务 API：
POST /documents
POST /documents/:id/sources
GET  /documents/:id/workspace-view
POST /issues/:id/actions
POST /proposals/:id/accept
POST /proposals/:id/reject
POST /claims/:id/confirm
POST /drafts/:id/render
POST /drafts/:id/export

TS Agent Host AI API：
POST /packs/:packId/runs
GET  /runs/:runId
GET  /runs/:runId/events
POST /runs/:runId/input
POST /runs/:runId/cancel
```

`resume-versions` 不再作为终局 API 保留；改稿状态必须收敛到 Document、Source、Draft、Issue、Proposal、Evidence、ExportArtifact 等当前业务模型。

## 10. 必须避免的错误方向

### 10.1 继续增强主题系统

这会把产品带向模板工具，而不是 AI-native 改稿系统。

### 10.2 把 AI 做成底部聊天框

这会让用户仍然不知道该怎么问，也无法形成结构化修改历史。

### 10.3 让 AI 直接改 `doc_json`

这会让证据链、确认状态、版本追踪、问题卡都变得很难补。

### 10.4 把 JD 当作唯一入口

这会偏离大多数用户先做基础简历的真实行为。

### 10.5 把 WPS 模块照搬成区块管理

WPS 模块服务手动编辑。

TypeDance 模块必须服务 AI 理解、诊断、改稿和证据追踪。

## 11. 目标实现完成时的判断

当用户导入旧简历后，如果系统只是把内容放进编辑器，并让用户自己找问题，说明还停留在当前系统。

当用户导入旧简历后，系统能自动生成：

```text
新版草稿
+ 模块结构
+ 问题卡
+ 修改建议
+ 证据状态
+ 待确认事项
+ 可导出版本
```

才说明进入了 AI-native Resume Pack。

当用户从空白开始时，如果系统展示空白 A4 页面，说明方向错误。

当系统能通过问题引导用户补充事实，再生成结构化初稿，说明方向正确。

当 AI 输出只是一段聊天回复，说明方向错误。

当 AI 输出被转换为 Issue、Proposal、Claim、Evidence 和 Draft patch，说明方向正确。

## 12. 后续研发的硬约束

后续任何简历 AI 功能，都必须回答以下问题：

1. 它新增或修改了哪个结构化对象？
2. 它是否产生 Issue 或 Proposal？
3. 它是否涉及 EvidenceLink 或用户确认？
4. 它是否能进入版本历史？
5. 它是否能被 Workspace View 消费？
6. 它是否仍能通过默认模板导出？

如果一个功能只能回答：

```text
它会改编辑器里的文字。
```

那么它不应该作为核心能力合入。

