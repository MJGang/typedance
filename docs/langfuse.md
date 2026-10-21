# Agent 可观测性（Langfuse）

Agent Host 支持将完整 Agent 运行链路上报到 Langfuse Cloud 或自建实例。默认关闭，不需要 Langfuse 也能正常使用 Agent；配置错误、观测回调异常和上报失败均不改变 Agent 执行结果。

## 配置

准备实例和项目的 API Keys 后，在启动 TypeDance 的 PowerShell 中设置：

```powershell
$env:LANGFUSE_ENABLED = 'true'
$env:LANGFUSE_BASE_URL = 'http://localhost:3000'
$env:LANGFUSE_PUBLIC_KEY = '<项目 Public Key>'
$env:LANGFUSE_SECRET_KEY = '<项目 Secret Key>'
$env:LANGFUSE_TRACING_ENVIRONMENT = 'development'
# 可选：用于区分客户端版本或提交
$env:LANGFUSE_RELEASE = 'local'
```

`LANGFUSE_BASE_URL` 必须填写实例根地址，Cloud 用户使用项目所在区域的根地址。SDK 会追加 `/api/public/otel/v1/traces`，不要把该路径写入配置。实例需要支持当前 Langfuse JS SDK 的 OTLP 上报协议（本次锁定 SDK 6.0.1）；自建实例请使用兼容的 Langfuse 4 服务端。

开发环境在同一个终端执行 `corepack pnpm dev`。也可以把配置写到被 Git 忽略的本机 `.env`，通过绝对路径显式指定 `$env:TYPEDANCE_ENV_FILE = 'E:\workspaces\typedance\.env'`；Agent Host 不自动搜索 `.env`。

桌面发布版需完全退出已有 TypeDance 进程，再从设置了环境变量的终端启动安装后的 `TypeDance.exe`。桌面启动器仅将上述 Langfuse 配置和 `LANGFUSE_CAPTURE_CONTENT` 传给 Agent Host；Python Sidecar 不接收这些凭据。发布版不读取开发环境文件，也不内置任何 Langfuse 项目或密钥。修改配置后需要重启。

Agent Host 日志会打印 `Langfuse: enabled` 或 `disabled`，不打印密钥。`LANGFUSE_ENABLED` 必须严格等于 `true`，且地址与两项密钥均有效才会启用。设为 `false` 或移除该变量即可关闭。

## 监控范围

每次运行形成一个 `agent.run` 根观测；同一对话通过 Langfuse Session 聚合。根观测 metadata 包含 `workspace_id`、`conversation_id`、`agent_run_id`、`harness_run_id`、`pack_id`、`mutation_mode`、模型轮数与最终状态，可以从应用中的 Run ID 定位 Trace。

| 观测 | 内容 |
| --- | --- |
| `agent.prepare` | 首次模型请求前的上下文加载、技能和 Prompt 准备耗时；准备失败或取消也会结束观测 |
| `model.generate` | 每一轮独立 generation，记录模型、首 Token 时间、耗时、真实 Token 用量与失败/取消状态 |
| 工具名 | 每次工具执行的 tool 观测，包含调用 ID、来源、耗时和成功/失败/取消状态；MCP、插件和内置工具共用该路径 |
| `permission.wait` | 权限请求到决策之间的等待时间与结果 |
| 子 Agent 名 | 运行时实际发出的子 Agent 生命周期 |
| 验证器名 | verification 的开始、结束与结果 |
| 其他运行事件 | 计划、证据、记忆、用户输入、画布修改提议和应用等已发生的 Harness 事件 |

DeepSeek 的用量来自 SSE 中的 `usage`，包括输入、输出、总量、缓存命中/未命中和推理 Token；未返回的字段不估算。缓存和推理细分是总量的子集，不应再次加到总 Token 中。价格由 Langfuse 对模型的定价配置决定；没有匹配价格时不虚构费用。中途取消可能收不到最终用量。

各轮 generation 和工具是同一根运行的子观测，使用显式父上下文，避免并发对话串线。子 Agent 观测仅反映已有生命周期事件；运行时未提供独立子运行关联的事件，不会被推断成更深的调用树。Python 业务执行时间体现在对应工具跨度内，不增加 Python 函数级自动埋点。

## 内容采集

默认只上报运行元数据、用量、状态和时间，**不采集消息、Prompt、推理文本、工具参数或工具结果**，错误信息也只记录状态。需要排查内容时显式设置：

```powershell
$env:LANGFUSE_CAPTURE_CONTENT = 'true'
```

开启后，消息、上下文、简历内容、模型输出、工具参数和结果可能被发送到配置的实例。实现会清除常见凭据字段、Bearer/API Key 字符串及配置中的 Langfuse Keys；每个文本最多采集 16,000 字符，对象深度最多 8 层、集合最多 100 项。该清理不等于个人信息匿名化；敏感资料场景保持内容采集关闭。

## 验证和退出

运行结束后异步刷新，运行中的观测由 SDK 定时批量上报。Agent Host 收到 `SIGINT`/`SIGTERM` 时结束尚未关闭的观测并刷新队列；强制终止进程或断电仍可能丢失缓冲区中的数据，桌面退出会直接终止子进程，应主要依靠每次运行结束时的刷新。

自动化测试使用真实 Langfuse Span Processor、本地 HTTP 接收端和 DeepSeek SSE 响应，检查 OTLP 路径与认证、Trace 父子关系、多轮用量、工具失败、并发、上下文错误、取消、内容开关、凭据清理和退出刷新。测试不调用付费模型或远端 Langfuse。

实例部署后，可发送一条会调用工具的消息，在 Langfuse Traces 中按 `agent_run_id` 搜索，确认 `agent.prepare → model.generate → tool → model.generate` 的时间线；再停止一次运行检查取消状态。控制台入库、Session 展示和费用计算需要在实际实例上验收。

## 职责边界

Harness Core 仅提供可选的通用运行事件和模型生命周期观测接口，没有 Langfuse 或 TypeDance 依赖。Agent Host 负责 SDK、配置、会话关联、内容策略和上报。桌面启动器只传递明确允许的配置；Frontend 与 Python Sidecar 不承担 AI 监控编排。

官方参考：[SDK 手动埋点](https://langfuse.com/docs/observability/sdk/instrumentation)、[SDK 高级配置](https://langfuse.com/docs/observability/sdk/advanced-features)、[DeepSeek Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)。
