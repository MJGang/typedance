# WP11 Import Flow 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导入或粘贴旧简历后，系统自动创建 Revision Document、Source、import_reconstruct Run、结构化 Draft、Issue、Proposal、Evidence 和 RenderProjection，并进入 Revision Workspace。

**Architecture:** 后端新增一个同步的导入重构编排服务，先用确定性解析器模拟最终 Agent 链路，保证对象边界、状态流和 WorkspaceView 与终局一致。前端在首页提供“导入旧简历”入口，用户粘贴内容后由 API client 串联 Document、Source、RevisionRun，然后跳转 `/revision/:documentId`。后续真实 Agent 接入时替换编排器内部实现，不改变前端消费的 WorkspaceView。

**Tech Stack:** FastAPI, Pydantic, SQLite, React, React Router, TypeScript, shadcn/ui, Tailwind CSS, Vitest, pytest.

---

## File Structure

新增：
- `services/sidecar/src/typedance_sidecar/revision_import_flow.py`
  - 旧简历导入重构编排服务，负责解析来源、生成 draft/modules/claims/issues/proposals/evidence/render projection。
- `services/sidecar/tests/test_revision_import_flow.py`
  - 编排服务行为测试。
- `apps/web/src/features/home/ImportOldResumeModal.tsx`
  - 首页旧简历粘贴导入入口。
- `apps/web/src/features/home/ImportOldResumeModal.test.tsx`
  - 前端导入交互测试。

修改：
- `services/sidecar/src/typedance_sidecar/revision_api.py`
  - `POST /documents/{document_id}/revision-runs` 在 `run_type=import_reconstruct` 时触发导入编排。
- `services/sidecar/tests/test_revision_api.py`
  - 验证导入 run 会生成 WorkspaceView 可消费对象。
- `apps/web/src/api.ts`
  - 保持 WP10 API client，必要时补充 import helper。
- `apps/web/src/api.test.ts`
  - 验证前端按 Document -> Source -> Run 的顺序请求。
- `apps/web/src/features/home/HomePage.tsx`
  - 新增导入旧简历主入口。
- `apps/web/src/App.test.tsx`
  - 更新首页入口断言。
- `docs/README.md`
  - 登记 WP11 计划。

## Task 1: 后端导入编排服务

- [x] 新增 `RevisionImportFlowService.run_import_reconstruct(document_id, run_id)`。
- [x] 将 source raw_text 解析为 `ParsedBlock`，空行忽略，标题/联系方式/普通段落可区分。
- [x] 创建 `DraftVersion`，并把 `Document.current_draft_id` 指向新 draft。
- [x] 创建 `BasicInfo`、`CoreSkills`、`WorkExperience`、`ProjectExperience`、`Education` 等可见模块；找不到明确标题时保留为 `ImportedContent`。
- [x] 为关键内容生成 `DocumentClaim` 和 `EvidenceLink`。
- [x] 为缺少结果、缺少联系方式、未确认事实等风险生成 `RevisionIssue`。
- [x] 为可改写项生成 `RevisionProposal`，并把 proposal 关联到 issue。
- [x] 调用 `RenderService.build_projection_for_draft()` 生成 `RenderProjection`。
- [x] 将 run 更新为 `completed`，写入 `target_draft_id` 和 `output_summary`。

## Task 2: Revision API 串入编排

- [x] `create_revision_run()` 保存 run 后，如果 `run_type == "import_reconstruct"`，调用 `RevisionImportFlowService`。
- [x] 没有 source 或 source 没有内容时返回 400。
- [x] 保持非 import run 的现有行为不变。
- [x] API 测试断言创建 import run 后，WorkspaceView 中存在 draft、modules、issues、proposals、evidence、render_projection。

## Task 3: 前端导入入口

- [x] 新增 `ImportOldResumeModal`，包含标题输入、旧简历内容 Textarea、错误态、提交中状态。
- [x] 提交时依次调用 `createRevisionDocument()`、`createRevisionSource()`、`createRevisionRun()`。
- [x] 成功后关闭弹窗并 `navigate("/revision/:documentId")`。
- [x] 首页空状态和顶部操作区都提供“导入旧简历”入口。
- [x] 保留原“新建简历/模板”入口，但不把旧简历导入导向 legacy workspace。

## Task 4: 测试与验证

- [x] `pytest services/sidecar/tests/test_revision_import_flow.py services/sidecar/tests/test_revision_api.py`
- [x] `corepack pnpm --filter @typedance/web test`
- [x] `corepack pnpm --filter @typedance/web build`
- [x] `corepack pnpm test`

## Completion

提交：

```bash
git add docs/README.md docs/superpowers/plans/2026-05-21-wp11-import-flow.md services/sidecar/src/typedance_sidecar/revision_import_flow.py services/sidecar/src/typedance_sidecar/revision_api.py services/sidecar/tests/test_revision_import_flow.py services/sidecar/tests/test_revision_api.py apps/web/src/api.ts apps/web/src/api.test.ts apps/web/src/features/home/HomePage.tsx apps/web/src/features/home/ImportOldResumeModal.tsx apps/web/src/features/home/ImportOldResumeModal.test.tsx apps/web/src/App.test.tsx
git commit -m "feat(revision): 新增旧简历导入重构流程"
```
