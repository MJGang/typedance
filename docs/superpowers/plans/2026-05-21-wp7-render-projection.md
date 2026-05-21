# WP7 Render Projection 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让结构化 `DraftVersion + DocumentModule[]` 可以稳定投影成 `RenderProjection.html` 与 `RenderProjection.doc_json`。

**Architecture:** 新增 `DraftProjectionBuilder`，从 pack render mapping 选择 profile，将可见模块转成默认 A4/ATS 可消费的 HTML 和 TipTap-like doc_json。`RenderService` 负责调用 builder、保存 projection，并回写 draft 的 `render_projection_id`；事实源仍然是 Draft/Module/Claim，不是 doc_json。

**Tech Stack:** Python 3.14 runtime, Pydantic v2, existing sidecar repository, pytest.

---

## File Structure

新增：

- `services/sidecar/src/typedance_sidecar/revision_render_projection.py`
  - Draft 到 RenderProjection 的投影构建器。
- `services/sidecar/tests/test_revision_render_projection.py`
  - 投影构建和服务持久化测试。

修改：

- `services/sidecar/src/typedance_sidecar/revision_services.py`
  - `RenderService` 新增 `build_projection_for_draft()`。
- `docs/README.md`
  - 登记 WP7 计划。

## Task 1: Projection Builder

- [ ] 实现 `DraftProjectionBuilder.build(draft, modules, render_profile=None)`。
- [ ] 使用 `default_pack_registry()` 获取 pack 默认 profile。
- [ ] 拒绝不在 pack `supported_profiles` 内的 render profile。
- [ ] 忽略 hidden module。
- [ ] 按 module `order` 排序。
- [ ] 生成 `RenderProjection.html`。
- [ ] 生成 TipTap-like `doc_json`。
- [ ] 对空草稿、过长内容、module 仍需确认生成 layout warnings。

## Task 2: RenderService Integration

- [ ] `RenderService.build_projection_for_draft(draft_id, render_profile=None)` 读取 draft 和 modules。
- [ ] 保存 `RenderProjection`。
- [ ] 回写 `DraftVersion.render_projection_id`。
- [ ] 找不到 draft 时抛出 `RevisionServiceError`。

## Task 3: Tests

- [ ] 测试可见模块生成 HTML 与 doc_json。
- [ ] 测试 hidden module 不进入投影。
- [ ] 测试 unsupported profile 报错。
- [ ] 测试 service 会保存 projection 并回写 draft。
- [ ] 测试长内容产生 warning。
- [ ] 运行：

```bash
corepack pnpm --filter @typedance/sidecar test -- tests/test_revision_render_projection.py
corepack pnpm --filter @typedance/sidecar test
corepack pnpm test
```

## Completion

提交：

```bash
git add docs/README.md docs/superpowers/plans/2026-05-21-wp7-render-projection.md services/sidecar/src/typedance_sidecar/revision_render_projection.py services/sidecar/src/typedance_sidecar/revision_services.py services/sidecar/tests/test_revision_render_projection.py
git commit -m "feat(sidecar): 新增结构化草稿渲染投影"
```
