# 桌面端模型配置设计

> 状态：已确认设计，等待实施计划。

## 目标

TypeDance 桌面端需要支持真实模型配置，同时保持类似 Codex 的配置心智：

- 高级用户可以手动编辑配置文件。
- 普通用户可以在设置页面中完成模型配置。
- 模型行为配置和认证凭据分离。
- 后续如果引入用户登录，可以自然扩展到 token 登录态。

本设计只覆盖桌面端。Chrome 或浏览器打开页面只是开发和渲染载体，不作为独立 Web 产品形态设计。

## 非目标

- 不设计在线 Web/SaaS 用户模型配置。
- 不在浏览器 localStorage 或 IndexedDB 中保存 API Key。
- 不接入 OS keychain；第一版采用 Codex 风格的本机 `auth.json`。
- 不提示 `deepseek-chat` 弃用，也不自动迁移旧模型名。
- 不在第一版实现多账号、多 provider 多 key 并存管理。

## 配置文件

配置目录沿用现有 sidecar 数据目录：

```text
~/.typedance/config.toml
~/.typedance/auth.json
```

### config.toml

`config.toml` 只保存非敏感模型行为配置。

```toml
[model]
provider = "deepseek"
model = "deepseek-v4-flash"
base_url = "https://api.deepseek.com"
temperature = 0
timeout_seconds = 120
structured_output = true

[agents]
parser = "auto"
structurer = "auto"
reviewer = "auto"
rewriter = "auto"
opportunity_calibrator = "auto"
```

说明：

- DeepSeek 默认模型必须是 `deepseek-v4-flash`。
- `deepseek-chat` 仅作为用户已有配置值被兼容读取，不作为默认值生成。
- `provider` 第一版支持 `deepseek`、`openai`、`openai_compatible`。
- `agents` 的取值为 `rule`、`auto`、`langchain`。

### auth.json

`auth.json` 模仿 Codex 的极简认证文件，保存认证模式、模型 API Key 和未来登录 token。

```json
{
  "auth_mode": "api_key",
  "TYPEDANCE_LLM_API_KEY": null,
  "tokens": null,
  "last_refresh": null
}
```

说明：

- `auth_mode` 第一版支持 `api_key`、`none`，未来可扩展 `login`。
- `TYPEDANCE_LLM_API_KEY` 是当前模型调用使用的统一 API Key 字段。
- `tokens` 和 `last_refresh` 预留给未来登录态。
- UI 和日志不得输出完整 API Key。
- 文件不得进入 git、导出包或诊断日志。

## 生效优先级

最终模型配置由 sidecar 合成，优先级如下：

1. 环境变量临时覆盖。
2. `~/.typedance/config.toml` 和 `~/.typedance/auth.json`。
3. 内置默认值。

认证凭据优先级：

1. `TYPEDANCE_LLM_API_KEY`。
2. provider 对应的环境变量，例如 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY`。
3. `auth.json` 中的 `TYPEDANCE_LLM_API_KEY`。
4. 未配置。

模型行为配置优先级：

1. `TYPEDANCE_LLM_PROVIDER`、`TYPEDANCE_LLM_MODEL`、`TYPEDANCE_LLM_BASE_URL`、`TYPEDANCE_LLM_TEMPERATURE`、`TYPEDANCE_LLM_TIMEOUT_SECONDS`、`TYPEDANCE_LLM_STRUCTURED_OUTPUT`。
2. `config.toml`。
3. 内置默认值。

当 agent mode 为 `auto` 且没有可用 API Key 时，继续回退到 rule-based runner。当 agent mode 为 `langchain` 且没有可用 API Key 时，应返回可理解的配置错误。

## Sidecar 边界

sidecar 是配置真相源。

- sidecar 负责读取、校验、写入 `config.toml` 和 `auth.json`。
- sidecar 负责合成最终 `LlmProviderConfig`。
- sidecar 负责脱敏 API Key 状态。
- Tauri 壳不直接解析模型配置。
- 前端设置页只通过 sidecar API 读取和保存配置。

这样可以保证桌面打包、开发期本地 Web、sidecar 单独运行时都使用同一套配置逻辑。

## 设置页

设置页提供一个“模型设置”区域：

- provider 选择：DeepSeek、OpenAI、OpenAI-compatible。
- model 输入或选择，默认 `deepseek-v4-flash`。
- base URL 输入，DeepSeek 默认 `https://api.deepseek.com`。
- temperature 数字输入。
- timeout seconds 数字输入。
- structured output 开关。
- API Key 输入和保存。
- agent mode 选择：Parser、Structurer、Reviewer、Rewriter、Opportunity Calibrator。

API Key 展示规则：

- 未配置：显示未配置。
- 来自 `auth.json`：显示已配置，并显示尾号，例如 `...a9f2`。
- 来自环境变量：显示当前由环境变量生效。
- 清除按钮只清除 `auth.json` 中的 key，不清除环境变量。

错误处理：

- 保存配置失败时，显示设置保存失败。
- 测试连接失败时，显示 provider 返回的简短错误，不展示完整请求和 key。
- 配置文件损坏时，sidecar 返回可恢复错误；设置页允许重置为默认配置。

## API

第一版设置 API 保持较小：

```text
GET    /settings/model
PUT    /settings/model
POST   /settings/model/test
DELETE /settings/model/api-key
```

`GET /settings/model` 返回脱敏配置状态，包括：

- 当前有效 provider、model、base_url、temperature、timeout_seconds、structured_output。
- agent modes。
- API Key 是否存在。
- API Key 来源：`env`、`auth_json`、`none`。
- 配置文件路径，用于高级用户定位。

`PUT /settings/model` 写入 `config.toml`，并在 payload 包含新 API Key 时写入 `auth.json`。

`POST /settings/model/test` 使用当前有效配置发起一次轻量模型调用，返回成功或错误摘要。

`DELETE /settings/model/api-key` 清除 `auth.json` 中的 `TYPEDANCE_LLM_API_KEY`。

## DeepSeek 默认模型

Context7 查询 DeepSeek 官方文档确认：

- DeepSeek V4 模型包括 `deepseek-v4-flash` 和 `deepseek-v4-pro`。
- `deepseek-chat` 和 `deepseek-reasoner` 将于 2026-07-24 弃用。
- TypeDance 第一版默认模型使用 `deepseek-v4-flash`。

实现时需要把当前代码中的 `deepseek-chat` 默认值替换为 `deepseek-v4-flash`。旧配置值照常读取，不增加迁移提示。

## 测试策略

后端测试：

- 默认配置返回 DeepSeek + `deepseek-v4-flash`。
- `auth.json` 可提供 API Key。
- 环境变量 API Key 覆盖 `auth.json`。
- 环境变量模型行为配置覆盖 `config.toml`。
- `auto` 无 key 时回退 rule-based。
- `langchain` 无 key 时返回配置错误。
- 损坏的 `config.toml` 或 `auth.json` 返回可理解错误。
- 设置 API 不返回完整 API Key。

前端测试：

- 设置页可加载当前模型配置。
- 保存 provider/model/base URL/agent mode 会调用设置 API。
- API Key 已配置时只显示脱敏状态。
- 环境变量覆盖时清除按钮不影响 env 生效状态。
- 测试连接成功/失败状态可见。

集成验证：

- `corepack pnpm --filter @typedance/web test`
- `corepack pnpm --filter @typedance/web build`
- `corepack pnpm --filter @typedance/sidecar test`
- 至少一次手动验证：设置页保存 DeepSeek API Key 后，旧简历导入或质量检查可以走 `langchain` 模式。

## 后续扩展

- 登录态：`auth_mode = "login"` 时使用 `tokens`，由服务端或云账号系统刷新。
- 多 provider 多 key：未来可从极简字段迁移到 key map，但第一版不做。
- OS keychain：后续可把 `auth.json` 中的 key 替换为 keychain 引用。
- 配置导入导出：只导出 `config.toml` 非敏感配置，不导出 `auth.json`。
