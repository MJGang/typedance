# Resume Pack 需求验收矩阵

> 状态：终局需求验收矩阵  
> 适用范围：将 `resume-pack-prd.md`、`revision-workspace-design.md`、`revision-engine-architecture.md` 转换为可检查的产品与工程要求。  
> 重要说明：本文不是阶段计划，不描述先做什么后做什么；它描述目标系统最终必须满足什么。

## 1. 需求分组

Resume Pack 的终局能力分为 12 组：

```text
R1 来源导入
R2 文档解析
R3 结构化草稿
R4 模块管理
R5 问题诊断
R6 修改建议
R7 证据与确认
R8 Revision Workspace
R9 版本与历史
R10 渲染与导出
R11 机会校准
R12 AI 输入与聊天降级
```

## 2. 验收矩阵

| ID | 需求 | 目标对象 | 验收信号 |
| --- | --- | --- | --- |
| R1-01 | 用户可以粘贴旧简历文本作为来源 | `SourceDocument` | 系统保存原始文本、来源类型和创建时间 |
| R1-02 | 用户可以上传旧简历文件 | `SourceDocument` | 文件不会只被转成编辑器文本，而是作为来源保留 |
| R1-03 | 用户可以补充工作总结、项目材料、作品链接等材料 | `SourceDocument` | 每份材料可被单独查看、引用和删除 |
| R1-04 | 来源材料必须保留原始内容 | `SourceDocument` | AI 整理失败时仍可回看原文 |
| R1-05 | 来源材料必须标记类型 | `source_type` | 系统可区分旧简历、项目材料、手动输入、外部上下文 |
| R2-01 | 系统能把旧简历解析为结构化片段 | `ParsedBlock` | 可查看 heading、paragraph、list、contact 等解析块 |
| R2-02 | 系统能识别简历模块 | `DocumentModule` | 至少识别基本信息、经历、项目、技能、教育 |
| R2-03 | 解析结果允许用户修正 | `ParsedBlock` / `DocumentModule` | 用户可纠正模块归类错误 |
| R2-04 | 解析失败必须有可恢复状态 | `parse_status` | 用户能重新解析、重新上传或改用粘贴 |
| R3-01 | 新版简历必须保存为结构化 Draft | `DraftVersion` | Draft 包含模块、主张、证据、问题、渲染投影 |
| R3-02 | `doc_json` 不允许作为唯一事实源 | `RenderProjection` | `doc_json` 可由 Draft 重新生成 |
| R3-03 | 草稿必须记录目标语言 | `DraftVersion` | 中文界面可编辑英文简历，反之亦然 |
| R3-04 | 草稿必须区分 AI 初稿和用户确认稿 | `DraftVersion.status` | 导出只能基于 accepted 或明确确认的 Draft |
| R4-01 | 模块必须有语义类型 | `DocumentModule.type` | 工作经历和项目经历不是普通标题文本 |
| R4-02 | 模块必须有状态 | `DocumentModule.status` | 可显示 clean、needs_review、weak、needs_confirmation、hidden |
| R4-03 | 模块必须支持可见性 | `DocumentModule.visibility` | 用户可保留材料但不进入当前简历 |
| R4-04 | 模块顺序必须可控 | `DocumentModule.order` | 渲染顺序来自结构化模块而非纯 DOM 顺序 |
| R4-05 | 模块管理必须显示质量信息 | `RevisionIssue` | 模块列表能显示问题数量和待确认状态 |
| R5-01 | 系统必须生成具体问题卡 | `RevisionIssue` | 问题卡包含标题、类型、严重程度、影响模块 |
| R5-02 | 问题卡必须关联具体位置 | `RevisionIssue.target` | 点击问题能定位到相关模块或 Claim |
| R5-03 | 问题卡必须有可执行动作 | `RevisionAction` | 用户不需要自己想 prompt |
| R5-04 | 问题卡必须区分阻塞和建议 | `RevisionIssue.blocking` | 导出前能识别阻塞问题 |
| R5-05 | 系统必须支持无 JD 的基础质量诊断 | `RevisionRun` | 没有目标岗位也能生成质量问题 |
| R6-01 | 修改建议必须保存为 Proposal | `RevisionProposal` | 每条建议有 before、after、reason、risk |
| R6-02 | Proposal 必须可接受和拒绝 | `RevisionProposal.status` | 用户决策会改变状态并记录历史 |
| R6-03 | Proposal 必须可局部应用 | `DraftPatch` | 接受一条建议不会覆盖整份简历 |
| R6-04 | Proposal 必须可要求更保守或更具体 | `RevisionAction` | 系统生成新的 Proposal，而不是直接改终稿 |
| R6-05 | AI 不允许只返回自然语言建议 | `RevisionProposal` | Agent 输出必须通过 schema 校验 |
| R7-01 | 强主张必须关联证据或用户确认 | `EvidenceLink` | 缺证据强主张进入 needs_confirmation |
| R7-02 | 证据关系必须有置信度 | `EvidenceLink.confidence` | 用户能区分直接支撑和推断支撑 |
| R7-03 | 用户确认必须被记录 | `ClaimConfirmation` | 记录确认人、时间、确认内容 |
| R7-04 | 缺证据内容必须可降级表达 | `RevisionAction` | 用户可选择“更保守” |
| R7-05 | 来源证据必须可回看 | `SourceSnippet` | 点击证据能看到来源片段 |
| R8-01 | 默认工作台以新版草稿为主 | `WorkspaceView.current_draft` | 用户打开后首先看到可读的新稿 |
| R8-02 | 旧简历按需对比，不常驻抢主空间 | `SourceDrawer` | 旧稿通过抽屉或局部对比查看 |
| R8-03 | 问题卡是主引导 | `WorkspaceView.issues` | 右侧优先显示待处理问题，而不是样式面板 |
| R8-04 | 点击问题卡进入局部对比 | `IssueDetailView` | 显示旧表达、新建议、理由、证据、动作 |
| R8-05 | 小屏不强行三栏 | `ResponsiveWorkspace` | 移动或窄屏使用抽屉、标签、局部弹层 |
| R9-01 | 系统必须保留导入版本 | `DraftVersion` / `SourceDocument` | 可回看最初导入内容 |
| R9-02 | 系统必须保留 AI 初稿版本 | `DraftVersion` | 用户能回退到 AI 初稿 |
| R9-03 | 系统必须保留用户接受记录 | `RevisionDecision` | 每个 Proposal 的决策可追踪 |
| R9-04 | 岗位版本必须与基础简历区分 | `DraftVersion.variant_type` | 针对 JD 的版本不会覆盖基础版本 |
| R9-05 | 导出版本必须可追溯 | `ExportArtifact` | PDF 能关联生成它的 Draft |
| R10-01 | 默认模板必须可投递 | `RenderProjection` | PDF 专业、克制、A4 友好、ATS 友好 |
| R10-02 | 导出前必须运行质量检查 | `QualityGate` | 有阻塞问题时提醒用户 |
| R10-03 | 渲染输入来自 Draft | `RenderProjection` | Renderer 不直接依赖用户编辑器 DOM |
| R10-04 | 预览和导出不能漂移 | `ExportArtifact` | 用户看到的预览与导出的 PDF 一致 |
| R10-05 | 模板和主题不应阻塞核心流程 | `TemplateStyleConfig` | 用户不设置样式也能完成投递 PDF |
| R11-01 | 用户可以在基础简历后进入机会校准 | `OpportunityContext` | JD 不是必填起点 |
| R11-02 | 系统能提取岗位要求 | `OpportunityRequirement` | 输出能力要求、关键词、职责、风险点 |
| R11-03 | 系统能生成岗位版本 | `DraftVersion.variant_type` | 岗位版本与基础版本并存 |
| R11-04 | 系统能提示过度匹配风险 | `RevisionIssue` | 关键词堆砌或虚假贴合会被标记 |
| R11-05 | 岗位定制不能静默编造经历 | `EvidenceLink` | 无证据内容进入确认或降级 |
| R12-01 | 聊天入口不是主界面中心 | `WorkspaceView` | 主流程通过入口、问题卡、动作按钮推进 |
| R12-02 | 聊天用于补充事实和偏好 | `UserInputNote` | 用户输入被结构化为事实、偏好或指令 |
| R12-03 | 聊天输出不能直接进入终稿 | `RevisionProposal` | 聊天结果必须转 Proposal 或 Draft patch |
| R12-04 | 系统应根据用户点击入口生成上下文引导 | `ContextualAction` | 用户点击模块或问题后看到具体下一步 |
| R12-05 | 用户不需要知道 prompt | `RevisionAction` | 常见任务都有显式按钮或卡片动作 |

## 3. 阻塞级验收项

以下能力缺失时，不能宣称 Resume Pack 已经达到 AI-native：

1. 没有结构化 Draft。
2. 没有 RevisionIssue。
3. 没有 RevisionProposal。
4. 没有 EvidenceLink。
5. 没有来源材料保留。
6. 没有用户确认状态。
7. 没有从 Draft 到 RenderProjection 的投影。
8. AI 只能直接改 `doc_json`。
9. 用户仍然主要通过空白聊天框驱动 AI。
10. 用户从空白创建时仍然面对空白编辑器。

## 4. 完成度判断

如果系统只能做到：

```text
编辑简历
+ 导出 PDF
+ AI 润色一段文字
```

它仍然是普通简历编辑器。

如果系统能做到：

```text
导入或补充材料
-> 生成结构化草稿
-> 发现问题
-> 给出可解释修改
-> 追踪证据和确认
-> 形成可导出正式稿
```

它才是 Resume Pack。

