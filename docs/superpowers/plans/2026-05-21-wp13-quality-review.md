# WP13 Quality Review 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在没有目标 JD 的情况下，对当前 Draft 运行基础质量检查，产出问题卡、建议、确认风险和导出阻塞信号。

**Architecture:** 后端新增 `RevisionQualityReviewService`，消费当前 draft 的 modules、claims、evidence 和 render projection，创建 `quality_review` run 关联的 RevisionIssue / RevisionProposal，并必要时补建 RenderProjection。前端在 Revision Workspace 提供“运行质量检查”动作，触发 run 后刷新 WorkspaceView。质量检查仍然围绕 WorkspaceView，不引入聊天式流程。

**Tech Stack:** FastAPI, Pydantic, SQLite, React, React Router, TypeScript, shadcn/ui, Tailwind CSS, Vitest, pytest.

---

## File Structure

新增：
- `services/sidecar/src/typedance_sidecar/revision_quality_review.py`
  - 基础质量检查编排服务。
- `services/sidecar/tests/test_revision_quality_review.py`
  - 质量检查服务测试。

修改：
- `services/sidecar/src/typedance_sidecar/revision_api.py`
  - `POST /documents/{document_id}/revision-runs` 在 `run_type=quality_review` 时触发质量检查。
- `services/sidecar/tests/test_revision_api.py`
  - 验证 API 触发质量检查后 WorkspaceView 更新。
- `apps/web/src/api.ts`
  - 新增 `runRevisionQualityReview()` helper。
- `apps/web/src/api.test.ts`
  - 验证质量检查 helper 调用 revision-runs。
- `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
  - 新增运行质量检查按钮。
- `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
  - 验证按钮调用质量检查并刷新。
- `docs/README.md`
  - 登记 WP13 计划。

## Task 1: 后端质量检查服务

- [ ] 新增 `RevisionQualityReviewService.run_quality_review(document_id, run_id)`。
- [ ] 定位 base draft：优先 `run.base_draft_id`，其次 `document.current_draft_id`，最后最新 draft。
- [ ] 检查 BasicInfo、CoreSkills、WorkExperience、ProjectExperience 是否缺失或为空。
- [ ] 检查联系方式、经历结果、证据、未确认高风险主张。
- [ ] 为 blocking 风险创建 `RevisionIssue(severity="blocking")`。
- [ ] 为 warning 风险创建 `RevisionIssue(severity="warning")`。
- [ ] 为可处理问题创建 `RevisionProposal`。
- [ ] 必要时调用 `RenderService.build_projection_for_draft()`。
- [ ] 将 run 更新为 `completed`，写入 `target_draft_id` 和 `output_summary`。

## Task 2: Revision API 串入 quality_review run

- [ ] `create_revision_run()` 保存 run 后，如果 `run_type == "quality_review"`，调用 `RevisionQualityReviewService`。
- [ ] 没有 draft 时返回 400。
- [ ] 保持 import flow、blank guided flow 和其它 run 行为不变。
- [ ] API 测试断言 quality_review run 后 WorkspaceView 中出现 issue、proposal、quality_gate。

## Task 3: Revision Workspace 触发入口

- [ ] `api.ts` 新增 `runRevisionQualityReview(documentId, baseDraftId?)`。
- [ ] `RevisionWorkspacePage` 在有 current draft 时展示“运行质量检查”按钮。
- [ ] 点击后调用 helper，刷新 WorkspaceView。
- [ ] action pending 时禁用按钮，失败时展示页面错误。

## Task 4: 测试与验证

- [ ] `pytest services/sidecar/tests/test_revision_quality_review.py services/sidecar/tests/test_revision_api.py`
- [ ] `corepack pnpm --filter @typedance/web test`
- [ ] `corepack pnpm --filter @typedance/web build`
- [ ] `corepack pnpm test`

## Completion

提交：

```bash
git add docs/README.md docs/superpowers/plans/2026-05-21-wp13-quality-review.md services/sidecar/src/typedance_sidecar/revision_quality_review.py services/sidecar/src/typedance_sidecar/revision_api.py services/sidecar/tests/test_revision_quality_review.py services/sidecar/tests/test_revision_api.py apps/web/src/api.ts apps/web/src/api.test.ts apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
git commit -m "feat(revision): 新增基础质量检查流程"
```
