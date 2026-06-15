# Harness Agent System 最终架构

> 状态：当前目标架构与实现边界  
> 日期：2026-06-16  
> 核心原则：Harness 是可独立发布的通用 TS/Node/ESM agent runtime，不依赖 TypeDance、Resume Pack 或任何业务模型。

## 1. 一句话定位

TypeDance 的 AI 能力由独立 Harness System 承载。TypeDance 只是 Harness 的一个宿主产品，Resume / Blog / Novel 等 Pack 只是宿主产品里的业务环境。

Harness Core 不知道 Pack，不知道 Resume，不知道 Python 业务 API。它只知道：

- run
- event stream
- model adapter
- capability policy
- plugin manifest
- skill / agent definition
- tool call
- MCP server
- permission
- memory
- workspace adapter
- verification

## 2. 包边界

```text
packages/harness-contracts
  纯 Harness 协议包，可独立发布
  不依赖 TypeDance 业务 contracts

packages/harness-core
  纯 Harness runtime，可独立发布
  只依赖 harness-contracts

packages/harness-server
  Harness HTTP/SSE + MCP stdio 传输层
  只依赖 harness-core、harness-contracts、MCP SDK

packages/agent-host
  TypeDance TS Agent Host
  可以知道 Pack，负责把 Pack AI 请求映射为 Harness run
  不属于 Harness Core，不可反向污染 Core

packages/contracts
  TypeDance 产品合同聚合包
  可以 re-export harness-contracts
  同时拥有 Document / Revision / Pack 等业务合同

plugins/resume
  TypeDance Resume Pack 对 Harness 的 AI 能力声明
  是宿主产品提供给 Harness 的外部 plugin bundle

services/sidecar
  Python 业务服务
  暴露 HTTP API 和 MCP tools
  不拥有 AI 编排、模型调用、skill 选择、agent 组织逻辑
```

禁止方向：

```text
harness-core -> packages/contracts
harness-core -> services/sidecar
harness-core -> plugins/resume
harness-core -> apps/web
harness-core -> TypeDance Pack 模型
```

## 3. 通信模型

```text
Frontend 普通业务页面
  -> Python HTTP API

Frontend AI 面板
  -> TypeDance Agent Host
  -> Harness Run Server / Harness Runtime
  -> Harness Core
  -> Plugin/MCP/Tool/Permission/Model
  -> Python MCP tools
  -> Python deterministic business services
```

前端可以为了普通业务直接调用 Python HTTP API。  
前端如果调用 AI，则只走 Harness Run Stream。

## 4. Agent Host 的职责

TypeDance 侧需要一个 TS Agent Host 层。它不属于 Harness Core。

Host 负责：

- 管理 active pack。
- 读取当前 Pack 可用的 plugin。
- 把 active pack 映射成 Harness `capability_policy`。
- 把 pack action 放进 run `context`。
- 启动或连接 Harness Run Server。
- 把业务上下文放进 `context`。
- 把前端 AI 请求转换为 Harness run request。
- 把 Harness events 适配给 assistant-ui。

Host 可以知道 Resume / Blog / Novel。Harness Core 不可以。

当前实现包：

```text
packages/agent-host
```

当前 Agent Host HTTP 入口：

```text
POST /packs/{packId}/runs
GET /runs/{runId}
GET /runs/{runId}/events
POST /runs/{runId}/input
POST /runs/{runId}/cancel
POST /permissions/{requestId}/resolve
```

前端 AI 调用不得直接调用 Python，也不得直接调用 Python 的旧 `runs`。

## 5. Capability Policy

Harness Core 的能力边界统一用 `capability_policy` 表示：

```ts
{
  scope_ids: string[]
  plugin_ids: string[]
}
```

语义：

- `scope_ids` 是宿主给 Core 的不透明 scope 字符串。
- `plugin_ids` 是显式插件白名单。
- 如果给了 `plugin_ids`，Core 以插件白名单为准。
- 如果没有 `plugin_ids`，Core 按 `scope_ids` 匹配 plugin manifest。
- 如果两者都为空，Core 不加载任何 plugin。

示例：

```json
{
  "scope_ids": ["workspace:alpha"],
  "plugin_ids": ["alpha.agent"]
}
```

`pack:resume` 这类字符串可以作为宿主定义的普通 scope 出现在 plugin bundle 中，但 Core 不拼接、不解析、不理解它。

## 6. Plugin / Skill / Agent

Plugin 是 Harness 能力包，包含：

- instructions
- skills
- agents
- MCP server declarations
- permissions
- verification recipes

Skill 是 plugin 内的一段任务能力说明。  
Agent 是运行时 actor，携带 skills 和可用 tools 执行模型循环。  
Core 只按 manifest 和 policy 装配它们，不理解业务意义。

## 7. Python 边界

Python 只负责确定性业务能力：

- CRUD
- import/export
- render
- parse
- quality data
- proposal apply/reject
- workspace view aggregation

Python 可以把这些能力暴露为 HTTP API 或 MCP tools。  
Python 不负责：

- model call
- prompt orchestration
- skill selection
- agent planning
- memory/dream/distill
- AI workflow routing

## 8. Run API

当前 Harness Server 暴露：

```text
POST /runs
GET /runs/{runId}
GET /runs/{runId}/events
POST /runs/{runId}/input
POST /runs/{runId}/cancel
POST /permissions/{requestId}/resolve
```

创建 run：

```ts
{
  capability_policy?: {
    scope_ids?: string[]
    plugin_ids?: string[]
  }
  user_message: string
  context?: Record<string, unknown>
}
```

没有 `pack_id`，没有 `packId`。

## 9. RunEvent

Harness event stream 是前端 AI 面板的事实源：

- `run.started`
- `assistant.delta`
- `reasoning.summary.delta`
- `plan.updated`
- `tool.call.started`
- `tool.call.delta`
- `tool.call.completed`
- `permission.requested`
- `permission.resolved`
- `artifact.patch.proposed`
- `artifact.patch.applied`
- `verification.started`
- `verification.completed`
- `evidence.added`
- `memory.updated`
- `subagent.started`
- `subagent.completed`
- `run.completed`
- `run.failed`
- `run.canceled`
- `user.input.received`

前端可以展示 reasoning summary，但不展示模型原始隐藏推理。

## 10. Permission

Permission Engine 属于 Harness Core。它负责：

- 判断 tool 是否需要授权。
- 生成 permission request event。
- 记录 permission decision。
- 支持 run/workspace/always 等授权记忆。

桌面 OS 权限、文件选择器、用户授权 UI 是宿主职责。Core 只消费标准授权结果。

## 11. Memory / Dream / Distill

Memory 是 Harness 能力。Core 的 memory scope 只能使用通用维度：

- `run`
- `workspace`
- `user`
- `global`

Pack 级记忆如果需要，由 Host 在 key、metadata 或外部存储层表达，不能进入 Core 类型。

Dream 和 Distill 是 Harness system agent 能力，不属于 Python，也不属于某个业务 Pack。

## 12. Workspace-first

文件读取、搜索、解析都通过 tool 表达。

RAG 不是顶层产品概念。底层可以使用：

- local search
- FTS / BM25
- vector index
- document parser

但对 Harness 和用户来说，它们都是 workspace tools。

## 13. 不可妥协约束

1. `harness-core` 源码不得出现业务 Pack 概念。
2. `harness-core` 不得依赖 `@typedance/contracts`。
3. `harness-core` 不得加载仓库内真实 `plugins/resume` 作为自身测试 fixture。
4. `harness-contracts` 不得依赖 TypeDance 业务合同。
5. Python 不参与 AI 编排。
6. 前端 AI 调用只走 Harness Run Stream。
7. 普通业务 HTTP 可以直连 Python。
8. Plugin 由 Host 选择并通过 capability policy 暴露给 Core。
9. Core 只执行通用 runtime 行为，不承载业务策略。
