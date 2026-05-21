# AI-native Resume Pack Agent 交接说明

> 状态：协作交接文档  
> 适用范围：后续任何 AI agent、研发者、产品协作者进入 TypeDance Resume Pack 工作前的快速定向。  
> 目的：避免后续工作重新走回“富文本编辑器 + AI 聊天框 + 模板库”的旧方向。

## 1. 先读什么

进入本项目后，先读：

1. `docs/README.md`
2. `docs/product/ai-native-revision-system.md`
3. `docs/product/resume-pack-prd.md`
4. `docs/product/current-to-target-gap-map.md`
5. `docs/product/target-engineering-blueprint.md`
6. `docs/product/target-work-package-map.md`

如果要做后端：

1. `docs/product/revision-engine-architecture.md`
2. `docs/product/revision-api-contract.md`
3. `docs/product/revision-agent-contracts.md`

如果要做前端：

1. `docs/product/revision-workspace-design.md`
2. `docs/product/revision-workspace-state-contract.md`

如果要判断功能是否合格：

1. `docs/product/resume-pack-requirements-matrix.md`

## 2. 当前最重要的产品结论

TypeDance 不是：

```text
AI 简历编辑器
富文本编辑器
模板库
AI 聊天框
WPS 简历功能复刻
```

TypeDance 的目标是：

```text
AI-native 职业文档改稿系统
```

Resume Pack 是第一个 Document Pack。

## 3. 不要误解 JD 的地位

JD 不是默认起点。

真实用户常见路径是：

```text
先做基础简历
-> 浏览招聘软件
-> 看到合适岗位
-> 再做岗位版本
```

所以系统默认主线是：

```text
基础简历生成
旧简历重构
基础质量改稿
```

JD 是：

```text
Opportunity Calibration
```

不是全部产品中心。

## 4. 不要误解模板和主题

模板要有，但不是核心。

必须有：

- 一个高质量默认 A4 模板。
- 稳定 PDF 导出。
- 中文和英文基础排版。

不应优先强化：

- 大量模板库。
- 主题市场。
- 花哨样式。
- 复杂样式面板。

主题概念应降级为内部 style token 或默认模板变体。

## 5. 不要把 AI 做成聊天框

用户不应该靠 prompt 驱动系统。

AI 应该融入：

- 导入入口。
- 模块引导。
- 问题卡。
- 修改建议。
- 证据确认。
- 导出检查。

聊天或输入框可以存在，但只能作为：

```text
补充事实
解释背景
表达偏好
追问当前问题
```

聊天输出不能直接写入最终稿。

必须转为：

```text
Issue
Proposal
Claim
Evidence
DraftPatch
```

## 6. 当前系统的问题

当前系统核心仍然接近：

```text
ResumeVersion
+ template_id
+ doc_json
+ plain_text_snapshot
+ PDF export
```

这说明当前产品还有价值，但它只是：

```text
简历编辑和导出底座
```

不等于 AI-native Resume Pack。

后续不能继续围绕 `doc_json` 堆 AI 功能。

## 7. 新事实源是什么

目标事实源是：

```text
Document
SourceDocument
ParsedBlock
DraftVersion
DocumentModule
DocumentClaim
EvidenceLink
RevisionIssue
RevisionProposal
RevisionRun
RenderProjection
ExportArtifact
```

`doc_json` 只是：

```text
RenderProjection 的一种输出
```

不是事实源。

## 8. 后续功能合入前必须回答

任何新功能都必须回答：

1. 它新增或修改哪个结构化对象？
2. 它是否产生 Issue 或 Proposal？
3. 它是否涉及 EvidenceLink 或用户确认？
4. 它是否能进入版本历史？
5. 它是否能被 WorkspaceView 消费？
6. 它是否仍能通过默认模板导出？

如果答案只是：

```text
它会改编辑器里的文字。
```

那它不是核心能力。

## 9. 后续代码工作优先看哪些包

按目标工程包看：

```text
WP1 Contracts
WP2 Storage
WP3 Revision Services
WP4 Pack Runtime
WP5 Agent Runtime
WP6 Resume Agents
WP7 Render Projection
WP8 Revision API
WP9 Workspace View
WP10 Revision Workspace UI
WP11 Import Flow
WP12 Blank Guided Flow
WP13 Quality Review
WP14 Opportunity Calibration
WP15 Export Gate
WP16 Legacy Compatibility
WP17 Test System
```

完整定义在：

```text
docs/product/target-work-package-map.md
```

## 10. 最容易走错的方向

不要做：

1. 一个更大的 AI Chat 面板。
2. 一个更复杂的主题系统。
3. 一个更花哨的模板库。
4. 一个只会替换选中文本的 AI 润色功能。
5. 一个只围绕 JD 的简历系统。
6. 一个让用户从空白 A4 开始写的编辑器。

要做：

1. 导入旧简历后自动重构。
2. 从空白开始时模块化引导。
3. 基础简历质量诊断。
4. 问题卡驱动的改稿。
5. 结构化 Proposal。
6. Evidence 和用户确认。
7. accepted Draft 导出。

## 11. 和用户讨论时的默认立场

用户当前更重视：

- 终局形态。
- 产品是否真正 AI-native。
- 不是渐进式逃避困难。
- 不要让用户学 prompt。
- 不要变成普通聊天框。
- 不要把 JD 当唯一场景。
- 不要把模板和主题放到核心。

因此讨论时不要先说：

```text
可以先做个简单版
```

而应该先明确：

```text
最终系统是什么
这个决策是否朝最终形态收敛
现在的实现是否会把方向锁错
```

## 12. 当前文档状态

截至 2026-05-21，`docs/product/` 下的文档已经形成一套目标蓝图：

- 产品定义。
- Pack 协议。
- Resume Pack PRD。
- 需求验收矩阵。
- 当前到终局差距图。
- 目标工程蓝图。
- 工作包地图。
- Revision Workspace 设计和状态契约。
- Revision Engine 架构。
- Agent 契约。
- API 契约。

后续可以开始进入代码实现计划，但实现计划必须遵守这些文档。

