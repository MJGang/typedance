# TypeDance 文档索引

> 最后更新: 2026-05-21

---

## 当前主文档

- `product/ai-native-revision-system.md`
  - TypeDance 终局产品定义。
  - 将产品从“AI 简历编辑器”重新定义为“AI-native 职业文档改稿系统”。
  - 后续产品、Agent、后端和工作台设计应优先回读此文档。

- `product/document-pack-protocol.md`
  - Document Pack 通用协议。
  - 定义模块、问题、动作、证据、改稿任务、Agent 合约和服务边界。
  - 简历、博客、作文、小说、述职等文档类型都应通过 Pack 扩展，而不是散落 prompt。

- `product/resume-pack-design.md`
  - Resume Pack 终局设计。
  - 定义简历模块、Claim、EvidenceLink、问题卡、动作清单和 Resume Agent 编排。
  - WPS 式模块管理在本系统中升级为 AI 可操作的简历语义模块。

- `product/resume-pack-prd.md`
  - Resume Pack 终局 PRD。
  - 将基础简历、旧简历导入、空白创建、质量改稿、机会校准、模块管理、Agent 能力和验收标准收束为产品需求。
  - 明确 JD 是机会校准场景，不是简历系统的唯一默认起点。

- `product/resume-pack-requirements-matrix.md`
  - Resume Pack 需求验收矩阵。
  - 将终局 PRD、Revision Workspace 和 Revision Engine 转换为 R1-R12 的可检查要求。
  - 用于后续判断一个功能是否真的进入 AI-native Resume Pack，而不是停留在编辑器润色。

- `product/current-to-target-gap-map.md`
  - 当前系统到终局系统差距图。
  - 明确现有编辑器、默认模板、PDF 导出、sidecar 哪些应保留，哪些应降级，哪些必须重做。
  - 防止后续继续把 `ResumeVersion + doc_json + AI 聊天框` 固化为产品核心。

- `product/target-engineering-blueprint.md`
  - TypeDance 目标工程蓝图。
  - 将终局产品形态映射到 `packages/contracts`、`packages/resume-renderer`、`services/sidecar`、`apps/web` 的目标边界。
  - 定义目标目录、数据流、API 面、WorkspaceView 合约、兼容层和工程完成定义。

- `product/target-work-package-map.md`
  - 目标工程工作包地图。
  - 将终局系统拆成 Contracts、Storage、Revision Services、Pack Runtime、Agent Runtime、Resume Agents、Workspace UI、Import Flow、Export Gate 等完整工作包。
  - 用于后续拆 PR 和验收，强调不是降低目标的 MVP 路线。

- `product/revision-workspace-design.md`
  - Revision Workspace 终局前端体验协议。
  - 定义前端如何消费 Draft、Issue、Proposal、Evidence，并映射为新版草稿、问题卡、局部对比、来源抽屉和补充输入。
  - 明确“新稿是主角、问题卡引导、旧稿按需对比、聊天输入退到第二层”的交互原则。

- `product/revision-workspace-state-contract.md`
  - Revision Workspace 状态契约。
  - 定义前端如何围绕 WorkspaceView、Selection、Panel、PendingAction、ContextualInput 组织状态。
  - 明确现有 `docJson/styleConfig/AiTab` 不能继续作为工作台主状态。

- `product/revision-engine-architecture.md`
  - Revision Engine 目标工程架构。
  - 定义后端领域模型、数据库表、服务边界、RevisionRun 编排、Agent Runtime、事件与现有系统取舍。
  - 明确 `doc_json` 只是渲染投影，Draft、Issue、Proposal、Evidence 才是 AI-native 改稿系统核心。

- `product/revision-agent-contracts.md`
  - Revision Agent 契约设计。
  - 定义 Parser、Structurer、Reviewer、Rewriter、Evidence Verifier、Opportunity Calibrator、Render Planner、Coach Narrator 的输入输出边界。
  - 明确 Agent 不能直接写最终稿，所有输出必须落到结构化对象并经过 schema 校验。

- `product/revision-api-contract.md`
  - Revision API 目标契约。
  - 定义 Document、Source、RevisionRun、WorkspaceView、Draft、Issue、Proposal、Evidence、Opportunity、Export 的目标接口。
  - 明确现有 `resume-versions` 接口属于 legacy compatibility，新工作台不应以它为主数据源。

- `product/agent-handoff-brief.md`
  - AI-native Resume Pack Agent 交接说明。
  - 给后续 AI agent、研发者和产品协作者提供阅读顺序、核心结论、禁区和后续工作包。
  - 避免后续工作重新走回“富文本编辑器 + AI 聊天框 + 模板库”的旧方向。

- `requirements.md`
  - V1 需求规格说明书。
  - 聚焦“基于个人资料库和目标岗位的 AI 简历优化工具”。
  - 该文档代表旧 V1 范围基线；后续应结合 `product/` 下的 AI-native 改稿系统终局文档修订。

- `product-vision.md`
  - 长期产品愿景。
  - 描述从简历切入，逐步扩展到求职闭环、职场文档、类 PPT、邮件、插件和职业文档平台。
- `page-design.md`
  - V1 页面设计方案。
  - 将需求文档中的简历闭环、证据链、权限确认和 Review Gate 转换为可执行的工作台页面设计。

## 归档文档

- `archive/requirements-v3.1-vision-draft-2026-05-07.md`
  - 原始完整需求文档。
  - 包含通用 AI 写作编辑器、插件系统、多 Agent、模板系统等更宽泛设想。
  - 不废弃，但不再作为 V1 范围依据。

## 文档管理原则

1. 产品终局、底层协议和 Pack 设计写入 `product/`。
2. 当前要实现的范围写入 `requirements.md`。
3. 暂不实现但方向正确的想法写入 `product-vision.md`。
4. 被替换的历史文档移入 `archive/`，不要删除。
5. 新增重要产品方向前，先判断属于终局产品协议、V1 需求、后续路线，还是长期愿景。

## 当前实施计划

- `superpowers/plans/2026-05-21-wp1-contracts.md`
  - WP1 Contracts 工程实施计划。
  - 目标是把 Revision Engine 的核心对象先落到 `packages/contracts`，包括 Document、Source、Draft、Module、Claim、Evidence、Issue、Proposal、Run、Render、WorkspaceView 和 ResumePack。
  - 已在 `codex/wp1-contracts` 分支完成代码落地与验证。

- `superpowers/plans/2026-05-21-wp2-storage.md`
  - WP2 Storage 工程实施计划。
  - 目标是让 sidecar 保存 Revision Engine 的核心领域对象，包括分表、Pydantic 模型和 repository roundtrip。
  - 已在 `codex/wp2-storage` 分支完成首批存储层落地与验证。

- `superpowers/plans/2026-05-08-typedance-foundation-slice-1.md`
  - Slice 0 + Slice 1 工程落地计划。
  - 目标是先完成可运行的本地优先简历编辑、A4 预览、sidecar 持久化和 PDF 导出闭环。

## Slice 1 本地运行

1. `corepack pnpm install`
2. `cd services/sidecar && python -m pip install -e ".[dev]"`
3. `corepack pnpm --filter @typedance/sidecar dev`
4. `corepack pnpm --filter @typedance/web dev`
5. 打开 `http://127.0.0.1:5173`

验收命令：

- `corepack pnpm test`
- `corepack pnpm --filter @typedance/web test:e2e`
