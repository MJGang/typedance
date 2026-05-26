# WP12 Blank Guided Flow 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户从空白开始时，通过基础信息和模块线索生成可审阅的结构化初稿，而不是进入空白 A4 或模板选择页。

**Architecture:** 后端新增空白引导编排服务，消费 `manual_user_input` Source，创建 `blank_guided_generate` run 对应的 Draft、Modules、Claims、Issues、Proposals、Evidence 和 RenderProjection。前端新增 `BlankGuidedResumeModal`，将用户填写的身份状态、目标方向、联系方式、技能和经历线索组织成 Source，再触发 run 并跳转 Revision Workspace。和 WP11 一样，前端只消费 WorkspaceView，后续真实 Agent 可替换编排内部实现。

**Tech Stack:** FastAPI, Pydantic, SQLite, React, React Router, TypeScript, shadcn/ui, Tailwind CSS, Vitest, pytest.

---

## File Structure

新增：
- `services/sidecar/src/typedance_sidecar/revision_blank_guided_flow.py`
  - 空白引导生成编排服务。
- `services/sidecar/tests/test_revision_blank_guided_flow.py`
  - 后端空白引导行为测试。
- `apps/web/src/features/home/BlankGuidedResumeModal.tsx`
  - 首页 AI-native 新建简历入口。
- `apps/web/src/features/home/BlankGuidedResumeModal.test.tsx`
  - 前端引导交互测试。

修改：
- `services/sidecar/src/typedance_sidecar/revision_api.py`
  - `POST /documents/{document_id}/revision-runs` 在 `run_type=blank_guided_generate` 时触发空白引导编排。
- `services/sidecar/tests/test_revision_api.py`
  - 验证 blank guided run 生成 WorkspaceView。
- `apps/web/src/api.ts`
  - 新增 `startBlankGuidedResume()` helper。
- `apps/web/src/api.test.ts`
  - 验证前端按 Document -> Source -> Run -> WorkspaceView 顺序创建。
- `apps/web/src/features/home/HomePage.tsx`
  - 将“新建简历”主入口切到空白引导。
- `apps/web/src/App.test.tsx`
  - 更新首页入口断言。
- `docs/README.md`
  - 登记 WP12 计划。

## Task 1: 后端空白引导编排

- [x] 新增 `RevisionBlankGuidedFlowService.run_blank_guided_generate(document_id, run_id)`。
- [x] 读取 `manual_user_input` source 的 raw_text，解析为键值线索。
- [x] 创建 `DraftVersion`，并把 `Document.current_draft_id` 指向新 draft。
- [x] 创建 `BasicInfo`、`JobIntent`、`CoreSkills`、`WorkExperience`、`ProjectExperience` 模块。
- [x] 用户提供的线索生成 `DocumentClaim` 与 `EvidenceLink`。
- [x] 缺少工作经历、项目经历、技能、联系方式等内容时生成 `RevisionIssue`。
- [x] 对可改写或缺失项生成 `RevisionProposal`。
- [x] 调用 `RenderService.build_projection_for_draft()` 生成 `RenderProjection`。
- [x] 将 run 更新为 `completed`，写入 `target_draft_id` 和 `output_summary`。

## Task 2: Revision API 串入 blank guided run

- [x] `create_revision_run()` 保存 run 后，如果 `run_type == "blank_guided_generate"`，调用 `RevisionBlankGuidedFlowService`。
- [x] 没有 manual source 或 source 没有内容时返回 400。
- [x] 保持 WP11 import flow 和其它 run 行为不变。
- [x] API 测试断言 blank guided run 后，WorkspaceView 中存在 draft、modules、issues、proposals、evidence、render_projection。

## Task 3: 前端引导入口

- [x] 新增 `BlankGuidedResumeModal`，包含身份状态、姓名、联系方式、目标方向、技能、经历线索、项目线索。
- [x] 提交时调用 `startBlankGuidedResume()`。
- [x] 成功后关闭弹窗并 `navigate("/revision/:documentId")`。
- [x] 首页“新建简历”主按钮打开引导弹窗，旧模板创建保留为次级入口。
- [x] 空状态不展示空白 A4，不进入 legacy workspace。

## Task 4: 测试与验证

- [x] `pytest services/sidecar/tests/test_revision_blank_guided_flow.py services/sidecar/tests/test_revision_api.py`
- [x] `corepack pnpm --filter @typedance/web test`
- [x] `corepack pnpm --filter @typedance/web build`
- [x] `corepack pnpm test`

## Completion

提交：

```bash
git add docs/README.md docs/superpowers/plans/2026-05-21-wp12-blank-guided-flow.md services/sidecar/src/typedance_sidecar/revision_blank_guided_flow.py services/sidecar/src/typedance_sidecar/revision_api.py services/sidecar/tests/test_revision_blank_guided_flow.py services/sidecar/tests/test_revision_api.py apps/web/src/api.ts apps/web/src/api.test.ts apps/web/src/features/home/HomePage.tsx apps/web/src/features/home/BlankGuidedResumeModal.tsx apps/web/src/features/home/BlankGuidedResumeModal.test.tsx apps/web/src/App.test.tsx
git commit -m "feat(revision): 新增空白引导生成流程"
```
