# WP3 Revision Services 实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 按任务推进，并在每个任务完成后更新状态。

## 目标

在 WP2 repository 之上建立 Revision Engine 服务边界，让后续 FastAPI 路由和 Agent Runtime 不直接操作 SQLite/repository。

服务层不负责调用 LLM，也不负责渲染页面；它负责领域动作、状态流转、对象聚合和基础一致性。例如：

- 接受一个 `DraftVersion` 时，同步更新 `Document.current_draft_id` 与 `Document.accepted_draft_id`。
- 接受一个 `RevisionProposal` 时，同步更新 proposal 状态、draft 已应用建议列表，以及相关 issue 状态。
- 生成 `WorkspaceView` 时，将 document、current draft、modules、claims、issues、proposals、evidence、sources、render projection 和 quality gate 聚合成前端可消费对象。

## 文件结构

新增：

- `services/sidecar/src/typedance_sidecar/revision_services.py`
  - Revision Engine 服务层。
- `services/sidecar/tests/test_revision_services.py`
  - 服务层行为测试。

修改：

- `services/sidecar/src/typedance_sidecar/revision_models.py`
  - 增加 `WorkspaceView`、`QualityGateResult` 聚合模型。
- `services/sidecar/src/typedance_sidecar/revision_repository.py`
  - 增加按 id 获取 draft、issue、proposal、evidence 的方法，供服务层使用。

## Task 1: 增加服务模型和 Repository Getters

验收：

- `WorkspaceView` 能表达 document、current draft、modules、claims、issues、proposals、evidence、sources、render projection、quality gate。
- repository 能按 id 获取 draft、issue、proposal、evidence。

## Task 2: 增加 Revision Services

验收：

- `SourceService` 能保存来源和解析块。
- `DraftService` 能创建 draft、接受 draft，并更新 document。
- `IssueService` 能创建、列出、dismiss issue。
- `ProposalService` 能创建、接受、拒绝 proposal；接受 proposal 时更新 draft applied ids 和相关 issue 状态。
- `EvidenceService` 能确认 claim 或 evidence link。
- `WorkspaceService` 能聚合当前 document 的 `WorkspaceView`。
- `RenderService` 和 `ExportService` 能封装投影与导出记录。

## Task 3: 验证

运行：

```bash
corepack pnpm --filter @typedance/sidecar test -- tests/test_revision_services.py
corepack pnpm --filter @typedance/sidecar test
corepack pnpm test
```

提交：

```bash
git add services/sidecar/src/typedance_sidecar/revision_models.py services/sidecar/src/typedance_sidecar/revision_repository.py services/sidecar/src/typedance_sidecar/revision_services.py services/sidecar/tests/test_revision_services.py docs/superpowers/plans/2026-05-21-wp3-revision-services.md
git commit -m "feat(sidecar): 新增 Revision Engine 服务层"
```
