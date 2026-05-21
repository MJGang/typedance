# WP14 Opportunity Calibration 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在基础简历之上生成岗位校准版本，让 JD 成为可选的版本化场景，而不是写简历的唯一起点。

**Architecture:** 后端新增 `RevisionOpportunityCalibrationService`，使用 `external_context` Source 表示岗位/JD 信息，读取基础 Draft 并创建 `variant_type="opportunity"` 的新 Draft。服务复制基础模块，基于岗位关键词生成匹配缺口 Issue、保守改写 Proposal 和过度贴合风险标记，保证不把用户没有的经历写进简历。前端在 Revision Workspace 提供“岗位校准”入口，粘贴岗位信息后触发 `opportunity_calibrate` run 并刷新 WorkspaceView。

**Tech Stack:** FastAPI, Pydantic, SQLite, React, React Router, TypeScript, shadcn/ui, Tailwind CSS, Vitest, pytest.

---

## File Structure

新增：
- `services/sidecar/src/typedance_sidecar/revision_opportunity_calibration.py`
  - 岗位校准编排服务。
- `services/sidecar/tests/test_revision_opportunity_calibration.py`
  - 岗位校准服务测试。
- `apps/web/src/features/revision/OpportunityCalibrationModal.tsx`
  - 工作台岗位校准入口。
- `apps/web/src/features/revision/OpportunityCalibrationModal.test.tsx`
  - 前端岗位校准交互测试。

修改：
- `services/sidecar/src/typedance_sidecar/revision_api.py`
  - `POST /documents/{document_id}/revision-runs` 在 `run_type=opportunity_calibrate` 时触发岗位校准。
- `services/sidecar/tests/test_revision_api.py`
  - 验证 API 触发岗位校准后生成 opportunity draft。
- `apps/web/src/api.ts`
  - 新增 `calibrateRevisionOpportunity()` helper。
- `apps/web/src/api.test.ts`
  - 验证前端按 Source -> Run -> WorkspaceView 顺序校准。
- `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
  - 新增岗位校准按钮和弹窗。
- `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
  - 验证校准入口调用 helper 并刷新。
- `docs/README.md`
  - 登记 WP14 计划。

## Task 1: 后端岗位校准服务

- [ ] 新增 `RevisionOpportunityCalibrationService.run_opportunity_calibrate(document_id, run_id)`。
- [ ] 定位 base draft：优先 `run.base_draft_id`，其次 `document.current_draft_id`。
- [ ] 读取 `external_context` source 的岗位文本，提取岗位关键词。
- [ ] 创建 `DraftVersion(variant_type="opportunity")`，复制 base draft 的可见模块。
- [ ] 不创建虚构 claim；只复制已有 claim 到新 draft。
- [ ] 缺少要求时创建 `missing_opportunity_requirement` issue。
- [ ] 对过度贴合风险创建 `overfit_risk` issue。
- [ ] 为缺口创建保守 proposal，提示用户补充真实事实而不是自动编造。
- [ ] 调用 `RenderService.build_projection_for_draft()`。
- [ ] 将 run 更新为 `completed`，写入 `target_draft_id` 和 `output_summary`，并把 document current draft 指向岗位版本。

## Task 2: Revision API 串入 opportunity_calibrate run

- [ ] `create_revision_run()` 保存 run 后，如果 `run_type == "opportunity_calibrate"`，调用 `RevisionOpportunityCalibrationService`。
- [ ] 没有 base draft 或 external_context source 时返回 400。
- [ ] 保持 import、blank guided、quality review 和其它 run 行为不变。
- [ ] API 测试断言 opportunity run 后 WorkspaceView 当前 draft 为 `variant_type="opportunity"`。

## Task 3: Revision Workspace 校准入口

- [ ] `api.ts` 新增 `calibrateRevisionOpportunity(documentId, baseDraftId, input)`。
- [ ] 新增 `OpportunityCalibrationModal`，收集岗位名称和岗位描述。
- [ ] `RevisionWorkspacePage` 在有 current draft 时展示“岗位校准”按钮。
- [ ] 成功后刷新 WorkspaceView。
- [ ] 不把岗位校准入口放到首页主路径，保持它是基础简历之后的版本化动作。

## Task 4: 测试与验证

- [ ] `pytest services/sidecar/tests/test_revision_opportunity_calibration.py services/sidecar/tests/test_revision_api.py`
- [ ] `corepack pnpm --filter @typedance/web test`
- [ ] `corepack pnpm --filter @typedance/web build`
- [ ] `corepack pnpm test`

## Completion

提交：

```bash
git add docs/README.md docs/superpowers/plans/2026-05-21-wp14-opportunity-calibration.md services/sidecar/src/typedance_sidecar/revision_opportunity_calibration.py services/sidecar/src/typedance_sidecar/revision_api.py services/sidecar/tests/test_revision_opportunity_calibration.py services/sidecar/tests/test_revision_api.py apps/web/src/api.ts apps/web/src/api.test.ts apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx apps/web/src/features/revision/OpportunityCalibrationModal.tsx apps/web/src/features/revision/OpportunityCalibrationModal.test.tsx
git commit -m "feat(revision): 新增岗位版本校准流程"
```
