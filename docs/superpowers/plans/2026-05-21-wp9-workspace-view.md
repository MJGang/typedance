# WP9 Workspace View 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Python sidecar 的 `WorkspaceView` 补齐到前端工作台可直接消费的聚合视图。

**Architecture:** 在 `revision_models.py` 中补齐 `RevisionRunStatusSummary`、`CoachSummary`、`ContextualAction`，并增强 `WorkspaceService` 聚合 run status、coach summary 和 available actions。前端读取 `/documents/{document_id}/workspace-view` 后不需要再拼 Agent 原始输出。

**Tech Stack:** Python 3.14 runtime, Pydantic v2, SQLite repository, pytest.

---

## File Structure

修改：

- `services/sidecar/src/typedance_sidecar/revision_models.py`
  - 新增 WorkspaceView 附属聚合模型。
- `services/sidecar/src/typedance_sidecar/revision_repository.py`
  - 新增按 document 查询 revision runs。
- `services/sidecar/src/typedance_sidecar/revision_services.py`
  - 增强 `WorkspaceService`。
- `services/sidecar/tests/test_revision_services.py`
  - 增加 WorkspaceView 聚合断言。
- `services/sidecar/tests/test_revision_api.py`
  - 增加 API 返回字段断言。
- `docs/README.md`
  - 登记 WP9 计划。

## Task 1: Models and Repository

- [x] 定义 `RevisionRunStatusSummary`。
- [x] 定义 `CoachSummary`。
- [x] 定义 `ContextualAction`。
- [x] `WorkspaceView` 增加 `run_status`、`coach_summary`、`available_actions`。
- [x] `RevisionRepository.list_revision_runs(document_id)`。

## Task 2: Workspace Aggregation

- [x] 聚合当前 document 最新 run status。
- [x] 从 run 的 AgentStep 推断 current_step。
- [x] 聚合 issue/proposal/action 可执行动作。
- [x] 根据 quality gate 生成 coach summary。
- [x] 保持现有 draft/modules/claims/issues/proposals/evidence/source/render projection 聚合不变。

## Task 3: Tests

- [x] 测试 WorkspaceView 返回 run_status。
- [x] 测试 WorkspaceView 返回 coach_summary。
- [x] 测试 WorkspaceView 返回 available_actions。
- [x] 测试 API 返回同样字段。
- [x] 运行：

```bash
corepack pnpm --filter @typedance/sidecar test -- tests/test_revision_services.py tests/test_revision_api.py
corepack pnpm --filter @typedance/sidecar test
corepack pnpm test
```

## Completion

提交：

```bash
git add docs/README.md docs/superpowers/plans/2026-05-21-wp9-workspace-view.md services/sidecar/src/typedance_sidecar/revision_models.py services/sidecar/src/typedance_sidecar/revision_repository.py services/sidecar/src/typedance_sidecar/revision_services.py services/sidecar/tests/test_revision_services.py services/sidecar/tests/test_revision_api.py
git commit -m "feat(sidecar): 增强 WorkspaceView 聚合视图"
```
