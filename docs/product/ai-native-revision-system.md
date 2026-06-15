# TypeDance AI-native 改稿系统终局设计

> 状态：产品终局蓝图  
> 适用范围：TypeDance 长期产品方向、后端架构、Agent 编排、前端工作台设计  
> 当前结论：TypeDance 不是 AI 简历编辑器，而是 AI-native 职业文档改稿系统；简历是第一个高痛点 Document Pack。

## 1. 核心定义

TypeDance 的核心对象不是“文档”，而是“改稿任务”。

文档是输入和输出，改稿任务才是系统的运行中心：

```text
导入旧文档或材料
-> 理解文档结构、受众、目的和关键主张
-> 发现问题、风险和缺失信息
-> 生成新版草稿和修改方案
-> 用户逐条确认、补充、接受或回退
-> 导出正式版本
```

这意味着 TypeDance 不应该被设计成：

```text
富文本编辑器 + AI 聊天框
```

而应该被设计成：

```text
Revision Engine + Document Pack + Revision Workspace + Renderer
```

## 2. 产品主张

TypeDance 不让用户从空白开始，也不要求用户学会 prompt。

它把已有文档或零散材料变成可处理的改稿任务，并生成用户可确认、可追溯、可导出的新版本。

一句话：

> TypeDance 是一个会理解文档、提出修改、解释理由、追踪证据，并陪用户完成正式稿件的 AI-native 改稿系统。

## 3. 为什么不是聊天式 AI

用户面对空白聊天框时，经常不知道该怎么问：

```text
帮我优化一下
写得专业一点
帮我改简历
```

这些 prompt 太泛，容易把产品降级为普通 AI 润色工具。

TypeDance 的 AI 应该无声无息地融合在工作流里：

- 入口即意图：用户点击“导入旧简历”，系统就知道要解析、重构、诊断和生成草稿。
- 建议即任务：AI 的建议不是聊天回复，而是可点击、可确认、可回退的问题卡。
- 修改即对象：每次改动都对应 `RevisionProposal`、`RevisionIssue`、`EvidenceLink` 和 `DraftVersion`。
- 输入框是补充入口，不是主交互：用户可以随时补充事实或偏好，但系统最终仍产出结构化修改方案。

## 4. 终局产品形态

主体验是“改稿工作台”，不是传统编辑器。

默认布局原则：

```text
主稿件优先
任务卡引导
旧版按需对比
来源可追溯
```

默认界面：

```text
顶部：文档名称 / 当前版本 / 导出 / 模式切换

主体：
- 新版草稿为主画布
- 待处理事项作为侧边任务区
- 旧版文档和来源材料默认收起，需要核对时打开
```

用户点击某个问题卡后，进入局部对比：

```text
旧版片段
新版片段
修改原因
证据状态
可执行动作
```

小屏幕不强行三栏，而使用：

```text
[新版草稿] [待处理] [来源]
```

## 5. 通用能力分层

```text
1. Source Layer
旧文档、PDF、Markdown、粘贴文本、项目材料、手动补充。

2. Understanding Layer
识别文档类型、模块、段落意图、关键主张、事实和受众。

3. Revision Layer
生成修改方案、问题卡、风险提示、证据状态和新版草稿。

4. Workspace Layer
用户处理修改任务：接受、回退、补充事实、确认真实性、删除、保守改写。

5. Export Layer
把 accepted DraftVersion 导出为 PDF、HTML、Markdown、DOCX 等正式交付物。
```

## 6. 核心对象

```text
Document
一份原始或生成后的文档。

SourceDocument
用户导入的旧文档或材料。

DocumentPack
文档类型规则包，例如 resume、blog、essay、fiction。

DocumentModule
文档中的语义模块。

DocumentClaim
文档中的关键主张、成果、观点或表达。

EvidenceLink
主张与来源之间的证据关系。

HarnessRun
一次可追踪、可恢复、可解释的改稿任务。

RevisionIssue
系统发现的问题卡或待处理事项。

RevisionProposal
AI 提出的具体修改方案。

RevisionAction
用户可以执行的动作。

DraftVersion
某一次生成的新稿。

ExportArtifact
最终导出记录。
```

## 7. 与简历场景的关系

简历不是全部产品，而是第一个 Document Pack。

Resume Pack 负责声明：

- 简历有哪些模块。
- 什么叫好的简历表达。
- 哪些问题需要标记。
- 哪些主张需要证据或用户确认。
- 如何把结构化草稿渲染成默认 A4 简历。

后续扩展到求职信、述职、晋升材料、博客、作文、小说时，不应重做整个系统，而是新增不同的 Document Pack。

## 8. 现有系统取舍

保留：

- 富文本编辑能力。
- 默认 A4 渲染能力。
- PDF / HTML 导出能力。
- 基础模板样式配置。

降级：

- 主题库。
- 多模板市场。
- 复杂块级样式编辑面板。

重做：

- 文档语义结构。
- 改稿任务系统。
- 证据链。
- Agent 编排。
- Revision Workspace。

关键定位变化：

```text
现在：doc_json 是核心，AI 只是附加能力。
未来：结构化 Draft / Claim / Evidence / Issue 是核心，doc_json 只是渲染投影。
```

## 9. 不可妥协原则

1. AI 输出必须落到结构化对象，不允许只返回一段自然语言建议。
2. 高风险主张不能静默进入最终文档。
3. 缺证据的强表达必须被标记、降级或等待用户确认。
4. 用户不需要会 prompt，系统必须通过按钮、问题卡、批注和下一步动作引导。
5. 文档类型差异由 Document Pack 处理，不通过散落 prompt 临时拼接。
6. accepted DraftVersion 才能导出正式版本。

