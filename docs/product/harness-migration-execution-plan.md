# Harness Agent System 迁移执行计划

> 状态：当前落地计划  
> 日期：2026-06-16  
> 目标：把 TypeDance AI 能力迁移到独立 TS Harness System，Python 只保留业务 HTTP API 与 MCP tools。

## 1. 最终目标

完成后系统应满足：

- `packages/harness-contracts` 是纯 Harness 协议包。
- `packages/harness-core` 是纯 Harness runtime 包。
- `packages/harness-server` 是 Harness 本地 HTTP/SSE/MCP 传输包。
- `packages/agent-host` 是 TypeDance TS Agent Host，负责 Pack -> Harness policy/run 映射。
- `packages/contracts` 只是 TypeDance 产品合同聚合包，可以 re-export harness contracts。
- `plugins/resume` 是 TypeDance 提供给 Harness 的外部 plugin bundle。
- `services/sidecar` 不再包含 AI 编排和模型调用。

## 2. 已确定边界

Harness Core 禁止：

- `pack_id`
- `packId`
- `resolveForPack`
- Resume / Blog / Novel 业务判断
- 直接依赖 `@typedance/contracts`
- 直接依赖 Python sidecar
- 直接加载 TypeDance 真实业务 plugin 作为自身测试 fixture

Harness Core 允许：

- 不透明 `scopeIds`
- 显式 `pluginIds`
- 通用 plugin manifest
- 通用 skill/agent/tool/MCP/permission/memory/workspace/verification 运行时

## 3. 当前包结构

```text
packages/harness-contracts/
  src/run.ts
  src/events.ts
  src/plugin.ts
  src/permission.ts
  src/tool.ts

packages/harness-core/
  src/run/
  src/event/
  src/model/
  src/tool/
  src/permission/
  src/plugin/
  src/skill/
  src/mcp/
  src/memory/
  src/workspace/
  src/verification/

packages/harness-server/
  src/index.ts
  src/mcp/stdio-connector.ts

packages/agent-host/
  src/index.ts

plugins/resume/
  plugin.json
  instructions.md
  skills/

services/sidecar/src/typedance_sidecar/mcp/
  resume_server.py
  resume_tools.py
```

## 4. 运行链路

```text
Frontend assistant-ui panel
  -> TS Agent Host maps active pack to capability_policy
  -> Harness Server POST /runs
  -> Harness Core run / event / agent loop
  -> Plugin policy resolution
  -> Tool Router
  -> MCP Manager
  -> Python MCP tools
  -> Python deterministic business service
```

普通页面继续：

```text
Frontend -> Python HTTP API
```

## 5. 执行顺序

### Step 1：纯 Harness contracts

- 新增 `packages/harness-contracts`。
- 定义 run / event / plugin / permission / tool schema。
- `packages/contracts/src/harness/index.ts` 只 re-export `@typedance/harness-contracts`。

### Step 2：Core 去业务化

- `createRun` 使用 `capability_policy`。
- 删除 `pack_id` / `packId`。
- 删除 `resolveForPack`。
- 引入 `resolvePluginsForPolicy` / `resolveSkillsForPolicy`。
- Core 测试只使用 generic alpha/beta fixture。

### Step 3：Server 去业务化

- Server 只接受 `capability_policy`。
- 删除含混的 `/runs/{id}/resume` 路由。
- SSE 只输出 Harness RunEvent。
- MCP stdio client 使用通用 client name。

### Step 4：Python MCP

- Python MCP tools 封装业务服务。
- MCP tools 不知道 skill / agent / model / prompt。
- Sidecar AI runtime 旧入口后续删除或重写为非 AI 业务服务。

### Step 5：TS Host

- Host 管理 active pack。
- Host 决定当前 Pack 允许哪些 plugin。
- Host 生成 `capability_policy`。
- Host 暴露 `POST /packs/{packId}/runs`。
- Host 自动启动当前 Pack primary agent。
- Host 适配 assistant-ui。

### Step 6：前端 AI 面板

- 使用 assistant-ui。
- AI 消息创建 Harness run。
- 流式消费 SSE。
- 展示 tool call、permission、patch、verification、reasoning summary。

## 6. 验证要求

每次改动 Harness 边界后必须至少运行：

```text
corepack pnpm --filter @typedance/harness-contracts test
corepack pnpm --filter @typedance/harness-contracts build
corepack pnpm --filter @typedance/contracts test
corepack pnpm --filter @typedance/contracts build
corepack pnpm --filter @typedance/harness-core test
corepack pnpm --filter @typedance/harness-core build
corepack pnpm --filter @typedance/harness-server test
corepack pnpm --filter @typedance/harness-server build
corepack pnpm --filter @typedance/agent-host test
corepack pnpm --filter @typedance/agent-host build
```

涉及 Python MCP 时还要运行：

```text
rtk pytest services/sidecar/tests/test_resume_mcp_tools.py -q
```

边界扫描：

```text
rg -n 'packId|pack_id|resolveForPack|resolvePluginsForPack|resolveSkillsForPack' packages/harness-core packages/harness-contracts packages/harness-server
rg -n '@typedance/contracts' packages/harness-core packages/harness-server
```

预期：除测试里的 `not.toHaveProperty("pack_id")` 防回归断言外，不应有命中。
