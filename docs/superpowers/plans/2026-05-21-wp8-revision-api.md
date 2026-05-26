# WP8 Revision API 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 WP2-WP7 的 Revision Engine 后端能力暴露为 FastAPI API，让前端可以开始消费新 Document / WorkspaceView / Draft / Issue / Proposal 边界。

**Architecture:** 新增 `revision_api.py` 提供 `APIRouter`，由 `main.py` 注入 repository dependency 并 `include_router()`。API 层只做请求解析、错误转 HTTP、调用 service/repository，不直接写复杂业务状态。

**Tech Stack:** FastAPI, Pydantic v2, SQLite repository, pytest TestClient.

---

## File Structure

新增：

- `services/sidecar/src/typedance_sidecar/revision_api.py`
  - Revision API router、请求模型和错误映射。
- `services/sidecar/tests/test_revision_api.py`
  - Revision API 行为测试。

修改：

- `services/sidecar/src/typedance_sidecar/main.py`
  - 增加 `revision_repository()` dependency，并挂载 router。
- `docs/README.md`
  - 登记 WP8 计划。

## Task 1: Router and Request Models

- [x] 新增 `CreateDocumentRequest`。
- [x] 新增 `CreateSourceRequest`。
- [x] 新增 `CreateRevisionRunRequest`。
- [x] 新增 `RenderDraftRequest`。
- [x] 新增 `ConfirmClaimRequest`。
- [x] 新增 `create_revision_router(repository_dependency)`。

## Task 2: API Endpoints

- [x] `POST /documents`
- [x] `GET /documents`
- [x] `GET /documents/{document_id}`
- [x] `POST /documents/{document_id}/sources`
- [x] `GET /documents/{document_id}/sources`
- [x] `POST /documents/{document_id}/revision-runs`
- [x] `GET /revision-runs/{run_id}`
- [x] `GET /documents/{document_id}/workspace-view`
- [x] `GET /documents/{document_id}/drafts`
- [x] `GET /drafts/{draft_id}`
- [x] `POST /drafts/{draft_id}/render`
- [x] `POST /drafts/{draft_id}/accept`
- [x] `GET /drafts/{draft_id}/issues`
- [x] `POST /issues/{issue_id}/dismiss`
- [x] `GET /proposals/{proposal_id}`
- [x] `POST /proposals/{proposal_id}/accept`
- [x] `POST /proposals/{proposal_id}/reject`
- [x] `POST /claims/{claim_id}/confirm`
- [x] `POST /evidence-links/{evidence_link_id}/confirm`

## Task 3: Tests

- [x] 测试 Document 和 Source API。
- [x] 测试 RevisionRun 创建和读取。
- [x] 测试 WorkspaceView 读取。
- [x] 测试 Draft render / accept。
- [x] 测试 Issue dismiss 和 Proposal accept。
- [x] 测试 claim/evidence confirm。
- [x] 运行：

```bash
corepack pnpm --filter @typedance/sidecar test -- tests/test_revision_api.py
corepack pnpm --filter @typedance/sidecar test
corepack pnpm test
```

## Completion

提交：

```bash
git add docs/README.md docs/superpowers/plans/2026-05-21-wp8-revision-api.md services/sidecar/src/typedance_sidecar/main.py services/sidecar/src/typedance_sidecar/revision_api.py services/sidecar/tests/test_revision_api.py
git commit -m "feat(sidecar): 新增 Revision API"
```
