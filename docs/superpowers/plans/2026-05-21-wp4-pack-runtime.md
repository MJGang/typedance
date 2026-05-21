# WP4 Pack Runtime 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Resume Pack 从静态契约变成 sidecar 可加载、可校验、可查询的 Pack Runtime。

**Architecture:** 在 Python sidecar 内新增 Pack 模型、Pack Registry 和 Resume Pack 定义。Pack Runtime 只声明规则，不调用 Agent，不渲染页面，也不直接写业务数据；Revision Services、Agent Runtime 和 FastAPI API 后续通过 registry 获取模块、问题类型、动作、质量规则、证据规则和 Agent 合约。

**Tech Stack:** Python 3.14 runtime, Pydantic v2, pytest, existing sidecar package.

---

## File Structure

新增：

- `services/sidecar/src/typedance_sidecar/revision_pack.py`
  - 定义 `ModuleSpec`、`IssueTypeSpec`、`ActionSpec`、`QualityRule`、`EvidenceRule`、`AgentContract`、`RenderMapping`、`DocumentPack` 和 `PackRegistry`。
- `services/sidecar/src/typedance_sidecar/resume_pack.py`
  - 定义 `resume_pack_definition` 和 `default_pack_registry()`。
- `services/sidecar/tests/test_revision_pack.py`
  - 验证 registry、Resume Pack 规则和错误路径。

修改：

- `docs/README.md`
  - 登记 WP4 计划。

## Task 1: Pack Models and Registry

- [ ] 新增 `revision_pack.py`。
- [ ] 用 Pydantic 嵌套模型表达 Pack schema。
- [ ] `PackRegistry.register()` 校验重复 pack id。
- [ ] `PackRegistry.get()` 找不到 pack 时抛出 `PackRegistryError`。
- [ ] 提供 `get_module_spec()`、`get_issue_type_spec()`、`get_action_spec()`、`get_quality_rule()`、`get_evidence_rule()` 辅助查询。

## Task 2: Resume Pack Definition

- [ ] 新增 `resume_pack.py`。
- [ ] 声明简历模块：基础信息、职业摘要、求职意向、核心技能、工作经历、项目经历、教育经历、实习经历、证书、荣誉奖项、作品链接、自我评价、自定义模块。
- [ ] 声明问题类型：信息缺失、表达空泛、缺少结果、缺少证据、时间线异常、技能缺少支撑、重复内容、篇幅过长、语言风格不统一、HR 阅读不友好、夸大风险、排版风险。
- [ ] 声明动作、质量规则、证据规则、Agent 合约和渲染映射。
- [ ] 提供 `default_pack_registry()` 注册 Resume Pack。

## Task 3: Tests

- [ ] 测试 Resume Pack 能注册和查询。
- [ ] 测试必需模块和关键动作存在。
- [ ] 测试重复注册报错。
- [ ] 测试找不到 pack/module/issue/action/rule 时返回明确异常。
- [ ] 运行：

```bash
corepack pnpm --filter @typedance/sidecar test -- tests/test_revision_pack.py
corepack pnpm --filter @typedance/sidecar test
corepack pnpm test
```

## Completion

提交：

```bash
git add docs/superpowers/plans/2026-05-21-wp4-pack-runtime.md docs/README.md services/sidecar/src/typedance_sidecar/revision_pack.py services/sidecar/src/typedance_sidecar/resume_pack.py services/sidecar/tests/test_revision_pack.py
git commit -m "feat(sidecar): 新增 Resume Pack 运行时"
```
