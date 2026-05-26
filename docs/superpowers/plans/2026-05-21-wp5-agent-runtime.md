# WP5 Agent Runtime 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立不依赖具体大模型供应商的 Agent Runtime 骨架，让每次 Agent 调用都可追踪、可校验、可失败恢复。

**Architecture:** 新增通用 `AgentInvocationContext`、`AgentOutputEnvelope`、`AgentSchemaRegistry` 和 `AgentRuntime`。Runtime 不直接调用 OpenAI/Claude，也不直接写 Draft/Issue/Proposal；它只负责执行 runner、校验输出信封和 payload schema、记录 `AgentStep`，并在失败时更新 `RevisionRun` 状态。

**Tech Stack:** Python 3.14 runtime, Pydantic v2, SQLite repository, pytest.

---

## File Structure

新增：

- `services/sidecar/src/typedance_sidecar/revision_agent_runtime.py`
  - Agent 调用上下文、输出信封、schema registry、runtime 执行器、错误分类。
- `services/sidecar/tests/test_revision_agent_runtime.py`
  - Agent Runtime 成功、schema 失败、policy 失败、model 失败测试。

修改：

- `docs/README.md`
  - 登记 WP5 计划。

## Task 1: Agent Runtime Models

- [x] 定义 `AgentInputRef`，把领域对象引用统一成 `ObjectType:object_id`。
- [x] 定义 `AgentWarning`。
- [x] 定义 `AgentInvocationContext`。
- [x] 定义 `AgentOutputEnvelope`。
- [x] 定义 `AgentInvocationResult`。
- [x] 定义 `AgentRuntimeError`，包含 `step_status`、`code`、`message`、`retryable`、`details`。

## Task 2: Schema Registry

- [x] 实现 `AgentSchemaRegistry.register(output_type, model_type)`。
- [x] 实现 `AgentSchemaRegistry.validate(envelope)`。
- [x] 未注册 output type 抛出 `failed_schema` 错误。
- [x] payload 校验失败抛出 `failed_schema` 错误。

## Task 3: Runtime Execution

- [x] `AgentRuntime.invoke(context, runner)` 创建 running `AgentStep`。
- [x] runner 返回 dict 时转换为 `AgentOutputEnvelope`。
- [x] 校验信封必须匹配 context 的 invocation/run/document/pack/agent。
- [x] 成功时保存 completed `AgentStep`。
- [x] schema 失败时保存 failed_schema `AgentStep`，并将 run 更新为 `failed_retryable`。
- [x] policy 失败时保存 failed_policy `AgentStep`，并将 run 更新为 `failed_final`。
- [x] runner 抛异常时保存 failed_model `AgentStep`，并将 run 更新为 `failed_retryable`。

## Task 4: Tests

- [x] 测试成功调用完成 AgentStep。
- [x] 测试 payload schema 失败不会 completed。
- [x] 测试信封和 context 不一致进入 failed_policy。
- [x] 测试 runner 异常进入 failed_model。
- [x] 测试未知 output type 进入 failed_schema。
- [x] 运行：

```bash
corepack pnpm --filter @typedance/sidecar test -- tests/test_revision_agent_runtime.py
corepack pnpm --filter @typedance/sidecar test
corepack pnpm test
```

## Completion

提交：

```bash
git add docs/README.md docs/superpowers/plans/2026-05-21-wp5-agent-runtime.md services/sidecar/src/typedance_sidecar/revision_agent_runtime.py services/sidecar/tests/test_revision_agent_runtime.py
git commit -m "feat(sidecar): 新增 Agent Runtime 骨架"
```
