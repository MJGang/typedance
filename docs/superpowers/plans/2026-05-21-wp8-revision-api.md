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

- [ ] 新增 `CreateDocumentRequest`。
- [ ] 新增 `CreateSourceRequest`。
- [ ] 新增 `CreateRevisionRunRequest`。
- [ ] 新增 `RenderDraftRequest`。
- [ ] 新增 `ConfirmClaimRequest`。
- [ ] 新增 `create_revision_router(repository_dependency)`。

## Task 2: API Endpoints

- [ ] `POST /documents`
- [ ] `GET /documents`
- [ ] `GET /documents/{document_id}`
- [ ] `POST /documents/{document_id}/sources`
- [ ] `GET /documents/{document_id}/sources`
- [ ] `POST /documents/{document_id}/revision-runs`
- [ ] `GET /revision-runs/{run_id}`
- [ ] `GET /documents/{document_id}/workspace-view`
- [ ] `GET /documents/{document_id}/drafts`
- [ ] `GET /drafts/{draft_id}`
- [ ] `POST /drafts/{draft_id}/render`
- [ ] `POST /drafts/{draft_id}/accept`
- [ ] `GET /drafts/{draft_id}/issues`
- [ ] `POST /issues/{issue_id}/dismiss`
- [ ] `GET /proposals/{proposal_id}`
- [ ] `POST /proposals/{proposal_id}/accept`
- [ ] `POST /proposals/{proposal_id}/reject`
- [ ] `POST /claims/{claim_id}/confirm`
- [ ] `POST /evidence-links/{evidence_link_id}/confirm`

## Task 3: Tests

- [ ] 测试 Document 和 Source API。
- [ ] 测试 RevisionRun 创建和读取。
- [ ] 测试 WorkspaceView 读取。
- [ ] 测试 Draft render / accept。
- [ ] 测试 Issue dismiss 和 Proposal accept。
- [ ] 测试 claim/evidence confirm。
- [ ] 运行：

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
