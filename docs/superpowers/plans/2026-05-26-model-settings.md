# 桌面端模型配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 TypeDance 桌面端新增 Codex 风格的模型配置能力，支持 `config.toml`、`auth.json`、设置页和 sidecar 统一生效。

**Architecture:** sidecar 是配置真相源，负责读取、写入、校验和合成模型配置；前端只通过设置 API 读写脱敏状态。共享契约放在 `packages/contracts`，避免前后端字段漂移；`llm_provider.py` 从配置层获取最终模型参数并保留环境变量覆盖能力。

**Tech Stack:** Python 3.11+ `tomllib`, FastAPI, Pydantic v2, React, React Router, TypeScript, Zod, shadcn/ui existing components, Vitest, pytest.

---

## File Structure

新增：

- `packages/contracts/src/settings/model-settings.ts`
  - 前端设置 API 的 Zod schema、枚举和类型。
- `services/sidecar/src/typedance_sidecar/model_settings.py`
  - 桌面端模型配置、认证文件、脱敏状态和最终配置合成。
- `services/sidecar/src/typedance_sidecar/settings_api.py`
  - `/settings/model` 系列 FastAPI router。
- `services/sidecar/tests/test_model_settings.py`
  - 配置读写、优先级、脱敏和损坏文件测试。
- `services/sidecar/tests/test_settings_api.py`
  - 设置 API 行为测试。
- `apps/web/src/features/settings/SettingsPage.tsx`
  - 设置页。
- `apps/web/src/features/settings/SettingsPage.test.tsx`
  - 设置页交互测试。

修改：

- `packages/contracts/src/index.ts`
  - 导出 settings schema。
- `packages/contracts/tests/contracts.test.ts`
  - 覆盖 settings schema。
- `services/sidecar/src/typedance_sidecar/llm_provider.py`
  - 默认模型改为 `deepseek-v4-flash`，从模型设置层读取 auth/config。
- `services/sidecar/tests/test_llm_provider.py`
  - 覆盖 auth.json 与 env 覆盖行为。
- `services/sidecar/src/typedance_sidecar/main.py`
  - 挂载 settings router。
- `apps/web/src/api.ts`
  - 新增 settings API helper。
- `apps/web/src/api.test.ts`
  - 覆盖前端 settings API helper。
- `apps/web/src/router.tsx`
  - 新增 `/settings` route。
- `apps/web/src/components/SiteSidebar.tsx`
  - 设置入口改为真实链接。

---

## Task 1: 共享 settings 契约

**Files:**
- Create: `packages/contracts/src/settings/model-settings.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`

- [ ] **Step 1: 新增失败测试**

在 `packages/contracts/tests/contracts.test.ts` 的 import 中加入：

```ts
  agentModeSchema,
  modelSettingsResponseSchema,
  modelSettingsUpdateSchema,
  modelProviderSchema,
```

在文件末尾加入测试：

```ts
describe("model settings schemas", () => {
  it("validates a redacted model settings response", () => {
    const parsed = modelSettingsResponseSchema.parse({
      config_path: "C:/Users/test/.typedance/config.toml",
      auth_path: "C:/Users/test/.typedance/auth.json",
      model: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        base_url: "https://api.deepseek.com",
        temperature: 0,
        timeout_seconds: 120,
        structured_output: true,
      },
      agents: {
        parser: "auto",
        structurer: "auto",
        reviewer: "auto",
        rewriter: "auto",
        opportunity_calibrator: "auto",
      },
      api_key: {
        configured: true,
        source: "auth_json",
        preview: "...a9f2",
      },
    });

    expect(parsed.model.model).toBe("deepseek-v4-flash");
    expect(parsed.api_key.preview).toBe("...a9f2");
  });

  it("validates settings update without requiring an api key", () => {
    const parsed = modelSettingsUpdateSchema.parse({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        base_url: null,
        temperature: 0.1,
        timeout_seconds: 90,
        structured_output: true,
      },
      agents: {
        parser: "langchain",
        structurer: "auto",
        reviewer: "auto",
        rewriter: "rule",
        opportunity_calibrator: "auto",
      },
    });

    expect(modelProviderSchema.parse("openai")).toBe("openai");
    expect(agentModeSchema.parse(parsed.agents.rewriter)).toBe("rule");
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
```

Expected: FAIL，提示 `modelSettingsResponseSchema` 等导出不存在。

- [ ] **Step 3: 新增契约文件**

创建 `packages/contracts/src/settings/model-settings.ts`：

```ts
import { z } from "zod";

export const modelProviderSchema = z.enum(["deepseek", "openai", "openai_compatible"]);
export const agentModeSchema = z.enum(["rule", "auto", "langchain"]);
export const apiKeySourceSchema = z.enum(["env", "auth_json", "none"]);

export const modelConfigSchema = z.object({
  provider: modelProviderSchema,
  model: z.string().min(1),
  base_url: z.string().url().nullable().optional(),
  temperature: z.number().min(0).max(2),
  timeout_seconds: z.number().positive(),
  structured_output: z.boolean(),
});

export const agentModeConfigSchema = z.object({
  parser: agentModeSchema,
  structurer: agentModeSchema,
  reviewer: agentModeSchema,
  rewriter: agentModeSchema,
  opportunity_calibrator: agentModeSchema,
});

export const apiKeyStatusSchema = z.object({
  configured: z.boolean(),
  source: apiKeySourceSchema,
  preview: z.string().nullable().optional(),
});

export const modelSettingsResponseSchema = z.object({
  config_path: z.string().min(1),
  auth_path: z.string().min(1),
  model: modelConfigSchema,
  agents: agentModeConfigSchema,
  api_key: apiKeyStatusSchema,
});

export const modelSettingsUpdateSchema = z.object({
  model: modelConfigSchema,
  agents: agentModeConfigSchema,
  api_key: z.string().min(1).optional(),
});

export const modelSettingsTestResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

export type ModelProvider = z.infer<typeof modelProviderSchema>;
export type AgentMode = z.infer<typeof agentModeSchema>;
export type ApiKeySource = z.infer<typeof apiKeySourceSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type AgentModeConfig = z.infer<typeof agentModeConfigSchema>;
export type ApiKeyStatus = z.infer<typeof apiKeyStatusSchema>;
export type ModelSettingsResponse = z.infer<typeof modelSettingsResponseSchema>;
export type ModelSettingsUpdate = z.infer<typeof modelSettingsUpdateSchema>;
export type ModelSettingsTestResponse = z.infer<typeof modelSettingsTestResponseSchema>;
```

- [ ] **Step 4: 导出契约**

在 `packages/contracts/src/index.ts` 末尾加入：

```ts
export * from "./settings/model-settings";
```

- [ ] **Step 5: 运行 contracts 测试**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
```

Expected: PASS。

- [ ] **Step 6: 提交契约**

```bash
git add packages/contracts/src/settings/model-settings.ts packages/contracts/src/index.ts packages/contracts/tests/contracts.test.ts
git commit -m "feat(contracts): 新增模型设置契约"
```

---

## Task 2: Sidecar 配置文件读写与合成

**Files:**
- Create: `services/sidecar/src/typedance_sidecar/model_settings.py`
- Modify: `services/sidecar/src/typedance_sidecar/llm_provider.py`
- Modify: `services/sidecar/tests/test_llm_provider.py`
- Test: `services/sidecar/tests/test_model_settings.py`

- [ ] **Step 1: 新增配置层失败测试**

创建 `services/sidecar/tests/test_model_settings.py`：

```python
import json

import pytest

from typedance_sidecar.model_settings import (
    DEFAULT_DEEPSEEK_BASE_URL,
    DEFAULT_DEEPSEEK_MODEL,
    ModelSettingsError,
    api_key_preview,
    load_model_auth,
    load_model_config,
    resolve_model_settings,
    save_model_auth,
    save_model_config,
)


def test_model_settings_defaults_to_deepseek_v4_flash(tmp_path):
    resolved = resolve_model_settings(data_dir=tmp_path, environ={})

    assert resolved.model.provider == "deepseek"
    assert resolved.model.model == DEFAULT_DEEPSEEK_MODEL
    assert resolved.model.model == "deepseek-v4-flash"
    assert resolved.model.base_url == DEFAULT_DEEPSEEK_BASE_URL
    assert resolved.agents.parser == "auto"
    assert resolved.api_key.configured is False
    assert resolved.api_key.source == "none"


def test_model_settings_roundtrips_config_and_auth(tmp_path):
    save_model_config(
        tmp_path,
        {
            "model": {
                "provider": "openai",
                "model": "gpt-5.4",
                "base_url": None,
                "temperature": 0.2,
                "timeout_seconds": 90,
                "structured_output": True,
            },
            "agents": {
                "parser": "langchain",
                "structurer": "auto",
                "reviewer": "auto",
                "rewriter": "rule",
                "opportunity_calibrator": "auto",
            },
        },
    )
    save_model_auth(tmp_path, api_key="sk-test-a9f2")

    config = load_model_config(tmp_path)
    auth = load_model_auth(tmp_path)
    resolved = resolve_model_settings(data_dir=tmp_path, environ={})

    assert config.model.provider == "openai"
    assert auth.TYPEDANCE_LLM_API_KEY == "sk-test-a9f2"
    assert resolved.api_key.configured is True
    assert resolved.api_key.source == "auth_json"
    assert resolved.api_key.preview == "...a9f2"


def test_environment_api_key_overrides_auth_json(tmp_path):
    save_model_auth(tmp_path, api_key="sk-from-auth")

    resolved = resolve_model_settings(
        data_dir=tmp_path,
        environ={"TYPEDANCE_LLM_API_KEY": "sk-from-env"},
    )

    assert resolved.api_key.source == "env"
    assert resolved.api_key.value == "sk-from-env"


def test_environment_model_values_override_config_toml(tmp_path):
    save_model_config(
        tmp_path,
        {
            "model": {
                "provider": "deepseek",
                "model": "deepseek-v4-flash",
                "base_url": "https://api.deepseek.com",
                "temperature": 0,
                "timeout_seconds": 120,
                "structured_output": True,
            },
            "agents": {
                "parser": "auto",
                "structurer": "auto",
                "reviewer": "auto",
                "rewriter": "auto",
                "opportunity_calibrator": "auto",
            },
        },
    )

    resolved = resolve_model_settings(
        data_dir=tmp_path,
        environ={
            "TYPEDANCE_LLM_PROVIDER": "openai",
            "TYPEDANCE_LLM_MODEL": "gpt-5.4",
            "TYPEDANCE_LLM_BASE_URL": "",
            "TYPEDANCE_LLM_TEMPERATURE": "0.3",
            "TYPEDANCE_LLM_TIMEOUT_SECONDS": "60",
            "TYPEDANCE_LLM_STRUCTURED_OUTPUT": "false",
        },
    )

    assert resolved.model.provider == "openai"
    assert resolved.model.model == "gpt-5.4"
    assert resolved.model.base_url is None
    assert resolved.model.temperature == 0.3
    assert resolved.model.timeout_seconds == 60
    assert resolved.model.structured_output is False


def test_corrupt_auth_json_returns_understandable_error(tmp_path):
    (tmp_path / "auth.json").write_text("{not-json", encoding="utf-8")

    with pytest.raises(ModelSettingsError, match="auth.json"):
        load_model_auth(tmp_path)


def test_api_key_preview_never_returns_full_key():
    assert api_key_preview("sk-1234567890abcdef") == "...cdef"
    assert api_key_preview("short") == "...hort"
    assert api_key_preview(None) is None
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pytest services/sidecar/tests/test_model_settings.py
```

Expected: FAIL，提示 `typedance_sidecar.model_settings` 不存在。

- [ ] **Step 3: 新增模型设置模块**

创建 `services/sidecar/src/typedance_sidecar/model_settings.py`：

```python
import json
import os
import tomllib
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError


DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash"

Provider = Literal["deepseek", "openai", "openai_compatible"]
AgentMode = Literal["rule", "auto", "langchain"]
ApiKeySource = Literal["env", "auth_json", "none"]


class ModelSettingsError(Exception):
    pass


class ModelConfig(BaseModel):
    provider: Provider = "deepseek"
    model: str = DEFAULT_DEEPSEEK_MODEL
    base_url: str | None = DEFAULT_DEEPSEEK_BASE_URL
    temperature: float = 0
    timeout_seconds: float = 120
    structured_output: bool = True


class AgentModeConfig(BaseModel):
    parser: AgentMode = "auto"
    structurer: AgentMode = "auto"
    reviewer: AgentMode = "auto"
    rewriter: AgentMode = "auto"
    opportunity_calibrator: AgentMode = "auto"


class ModelSettingsFile(BaseModel):
    model: ModelConfig = Field(default_factory=ModelConfig)
    agents: AgentModeConfig = Field(default_factory=AgentModeConfig)


class ModelAuthFile(BaseModel):
    auth_mode: Literal["api_key", "none", "login"] = "none"
    TYPEDANCE_LLM_API_KEY: str | None = None
    tokens: dict[str, Any] | None = None
    last_refresh: str | None = None


class ApiKeyStatus(BaseModel):
    configured: bool
    source: ApiKeySource
    preview: str | None = None
    value: str | None = Field(default=None, exclude=True)


class ResolvedModelSettings(BaseModel):
    config_path: str
    auth_path: str
    model: ModelConfig
    agents: AgentModeConfig
    api_key: ApiKeyStatus


def default_data_dir(environ: dict[str, str] | None = None) -> Path:
    env = environ if environ is not None else os.environ
    override = env.get("TYPEDANCE_DATA_DIR")
    if override:
        return Path(override)
    return Path.home() / ".typedance"


def config_path(data_dir: Path) -> Path:
    return data_dir / "config.toml"


def auth_path(data_dir: Path) -> Path:
    return data_dir / "auth.json"


def load_model_config(data_dir: Path) -> ModelSettingsFile:
    path = config_path(data_dir)
    if not path.exists():
        return ModelSettingsFile()
    try:
        return ModelSettingsFile.model_validate(tomllib.loads(path.read_text(encoding="utf-8")))
    except (OSError, tomllib.TOMLDecodeError, ValidationError) as exc:
        raise ModelSettingsError(f"Invalid config.toml: {exc}") from exc


def load_model_auth(data_dir: Path) -> ModelAuthFile:
    path = auth_path(data_dir)
    if not path.exists():
        return ModelAuthFile()
    try:
        return ModelAuthFile.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError, ValidationError) as exc:
        raise ModelSettingsError(f"Invalid auth.json: {exc}") from exc


def save_model_config(data_dir: Path, payload: dict[str, Any] | ModelSettingsFile) -> ModelSettingsFile:
    data_dir.mkdir(parents=True, exist_ok=True)
    settings = payload if isinstance(payload, ModelSettingsFile) else ModelSettingsFile.model_validate(payload)
    _atomic_write_text(config_path(data_dir), _settings_to_toml(settings))
    return settings


def save_model_auth(data_dir: Path, *, api_key: str | None) -> ModelAuthFile:
    data_dir.mkdir(parents=True, exist_ok=True)
    auth = load_model_auth(data_dir).model_copy(
        update={
            "auth_mode": "api_key" if api_key else "none",
            "TYPEDANCE_LLM_API_KEY": api_key,
        }
    )
    _atomic_write_text(auth_path(data_dir), json.dumps(auth.model_dump(), ensure_ascii=False, indent=2) + "\n")
    return auth


def resolve_model_settings(
    *,
    data_dir: Path | None = None,
    environ: dict[str, str] | None = None,
) -> ResolvedModelSettings:
    env = environ if environ is not None else os.environ
    resolved_data_dir = data_dir or default_data_dir(env if environ is not None else None)
    config = load_model_config(resolved_data_dir)
    auth = load_model_auth(resolved_data_dir)
    model = _model_with_env_overrides(config.model, env)
    agents = _agents_with_env_overrides(config.agents, env)
    key, source = _api_key(env, auth, model.provider)
    return ResolvedModelSettings(
        config_path=str(config_path(resolved_data_dir)),
        auth_path=str(auth_path(resolved_data_dir)),
        model=model,
        agents=agents,
        api_key=ApiKeyStatus(
            configured=bool(key),
            source=source,
            preview=api_key_preview(key),
            value=key,
        ),
    )


def api_key_preview(value: str | None) -> str | None:
    if not value:
        return None
    return f"...{value[-4:]}"
```

同文件继续加入 helper：

```python
def _model_with_env_overrides(model: ModelConfig, env: dict[str, str]) -> ModelConfig:
    provider = env.get("TYPEDANCE_LLM_PROVIDER", model.provider).strip().lower()
    if provider not in {"deepseek", "openai", "openai_compatible"}:
        raise ModelSettingsError(f"Unsupported LLM provider: {provider}")
    base_url = env.get("TYPEDANCE_LLM_BASE_URL")
    return model.model_copy(
        update={
            "provider": provider,
            "model": env.get("TYPEDANCE_LLM_MODEL") or model.model or _default_model(provider),
            "base_url": None if base_url == "" else (base_url or model.base_url or _default_base_url(provider)),
            "temperature": _float_env(env, "TYPEDANCE_LLM_TEMPERATURE", model.temperature),
            "timeout_seconds": _float_env(env, "TYPEDANCE_LLM_TIMEOUT_SECONDS", model.timeout_seconds),
            "structured_output": _bool_env(env, "TYPEDANCE_LLM_STRUCTURED_OUTPUT", model.structured_output),
        }
    )


def _agents_with_env_overrides(agents: AgentModeConfig, env: dict[str, str]) -> AgentModeConfig:
    return agents.model_copy(
        update={
            "parser": _agent_mode_env(env, "TYPEDANCE_RESUME_PARSER_MODE", agents.parser),
            "structurer": _agent_mode_env(env, "TYPEDANCE_RESUME_STRUCTURER_MODE", agents.structurer),
            "reviewer": _agent_mode_env(env, "TYPEDANCE_RESUME_REVIEWER_MODE", agents.reviewer),
            "rewriter": _agent_mode_env(env, "TYPEDANCE_RESUME_REWRITER_MODE", agents.rewriter),
            "opportunity_calibrator": _agent_mode_env(
                env,
                "TYPEDANCE_RESUME_OPPORTUNITY_CALIBRATOR_MODE",
                agents.opportunity_calibrator,
            ),
        }
    )


def _api_key(env: dict[str, str], auth: ModelAuthFile, provider: str) -> tuple[str | None, ApiKeySource]:
    for name in ["TYPEDANCE_LLM_API_KEY", *_provider_api_key_names(provider)]:
        value = env.get(name)
        if value:
            return value, "env"
    if auth.TYPEDANCE_LLM_API_KEY:
        return auth.TYPEDANCE_LLM_API_KEY, "auth_json"
    return None, "none"


def _provider_api_key_names(provider: str) -> list[str]:
    if provider == "openai":
        return ["OPENAI_API_KEY"]
    return ["DEEPSEEK_API_KEY"]


def _default_model(provider: str) -> str:
    if provider == "openai":
        return "gpt-5.4"
    return DEFAULT_DEEPSEEK_MODEL


def _default_base_url(provider: str) -> str | None:
    if provider == "deepseek":
        return DEFAULT_DEEPSEEK_BASE_URL
    return None


def _agent_mode_env(env: dict[str, str], name: str, default: AgentMode) -> AgentMode:
    value = env.get(name)
    if value is None or not value.strip():
        return default
    normalized = value.strip().lower()
    if normalized in {"rules", "deterministic", "local"}:
        normalized = "rule"
    if normalized not in {"rule", "auto", "langchain"}:
        raise ModelSettingsError(f"Unsupported agent mode {name}: {value}")
    return normalized  # type: ignore[return-value]


def _float_env(env: dict[str, str], name: str, default: float) -> float:
    value = env.get(name)
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError as exc:
        raise ModelSettingsError(f"Invalid float env {name}: {value}") from exc


def _bool_env(env: dict[str, str], name: str, default: bool) -> bool:
    value = env.get(name)
    if value is None or not value.strip():
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ModelSettingsError(f"Invalid boolean env {name}: {value}")


def _settings_to_toml(settings: ModelSettingsFile) -> str:
    model = settings.model
    agents = settings.agents
    base_url = "null" if model.base_url is None else json.dumps(model.base_url)
    return (
        "[model]\n"
        f"provider = {json.dumps(model.provider)}\n"
        f"model = {json.dumps(model.model)}\n"
        f"base_url = {base_url}\n"
        f"temperature = {model.temperature}\n"
        f"timeout_seconds = {model.timeout_seconds}\n"
        f"structured_output = {str(model.structured_output).lower()}\n\n"
        "[agents]\n"
        f"parser = {json.dumps(agents.parser)}\n"
        f"structurer = {json.dumps(agents.structurer)}\n"
        f"reviewer = {json.dumps(agents.reviewer)}\n"
        f"rewriter = {json.dumps(agents.rewriter)}\n"
        f"opportunity_calibrator = {json.dumps(agents.opportunity_calibrator)}\n"
    )


def _atomic_write_text(path: Path, text: str) -> None:
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(text, encoding="utf-8")
    temp_path.replace(path)
```

- [ ] **Step 4: 更新 llm_provider 使用配置层**

修改 `services/sidecar/src/typedance_sidecar/llm_provider.py`：

```python
from pathlib import Path

from .model_settings import (
    DEFAULT_DEEPSEEK_BASE_URL,
    DEFAULT_DEEPSEEK_MODEL,
    ModelSettingsError,
    resolve_model_settings,
)
```

把 `load_llm_provider_config()` 改为支持 `data_dir`：

```python
def load_llm_provider_config(
    environ: Mapping[str, str] | None = None,
    *,
    data_dir: Path | None = None,
) -> LlmProviderConfig:
    env = dict(environ if environ is not None else os.environ)
    try:
        settings = resolve_model_settings(data_dir=data_dir, environ=env)
    except ModelSettingsError as exc:
        raise LlmProviderError(str(exc)) from exc
    return LlmProviderConfig(
        provider=settings.model.provider,
        model=settings.model.model,
        model_provider="openai",
        base_url=settings.model.base_url,
        api_key_env_names=_api_key_env_names(settings.model.provider),
        temperature=settings.model.temperature,
        timeout_seconds=settings.model.timeout_seconds,
        structured_output=settings.model.structured_output,
    )
```

把 `build_chat_model()` 内取 key 的逻辑改为：

```python
settings = resolve_model_settings(data_dir=data_dir, environ=env)
api_key = settings.api_key.value
```

并给 `build_chat_model()` 和 `has_configured_llm_api_key()` 增加 `data_dir: Path | None = None` 参数。

- [ ] **Step 5: 更新 llm_provider 测试**

在 `services/sidecar/tests/test_llm_provider.py` 中新增：

```python
def test_llm_provider_reads_api_key_from_auth_json(tmp_path):
    from typedance_sidecar.model_settings import save_model_auth

    save_model_auth(tmp_path, api_key="sk-auth")
    config = load_llm_provider_config({}, data_dir=tmp_path)

    calls = {}

    def fake_init_chat_model(**kwargs):
        calls.update(kwargs)
        return object()

    build_chat_model(config, environ={}, data_dir=tmp_path, init_chat_model_fn=fake_init_chat_model)

    assert calls["api_key"] == "sk-auth"


def test_llm_provider_env_key_overrides_auth_json(tmp_path):
    from typedance_sidecar.model_settings import save_model_auth

    save_model_auth(tmp_path, api_key="sk-auth")

    calls = {}

    def fake_init_chat_model(**kwargs):
        calls.update(kwargs)
        return object()

    build_chat_model(
        environ={"TYPEDANCE_LLM_API_KEY": "sk-env"},
        data_dir=tmp_path,
        init_chat_model_fn=fake_init_chat_model,
    )

    assert calls["api_key"] == "sk-env"
```

- [ ] **Step 6: 运行 sidecar 配置测试**

Run:

```bash
pytest services/sidecar/tests/test_model_settings.py services/sidecar/tests/test_llm_provider.py
```

Expected: PASS。

- [ ] **Step 7: 提交 sidecar 配置层**

```bash
git add services/sidecar/src/typedance_sidecar/model_settings.py services/sidecar/src/typedance_sidecar/llm_provider.py services/sidecar/tests/test_model_settings.py services/sidecar/tests/test_llm_provider.py
git commit -m "feat(sidecar): 新增模型配置文件解析"
```

---

## Task 3: Settings API

**Files:**
- Create: `services/sidecar/src/typedance_sidecar/settings_api.py`
- Modify: `services/sidecar/src/typedance_sidecar/main.py`
- Test: `services/sidecar/tests/test_settings_api.py`

- [ ] **Step 1: 新增 API 失败测试**

创建 `services/sidecar/tests/test_settings_api.py`：

```python
from fastapi.testclient import TestClient

from typedance_sidecar.main import app
from typedance_sidecar.model_settings import load_model_auth, load_model_config, save_model_auth


def test_settings_api_returns_redacted_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.get("/settings/model")

    assert response.status_code == 200
    payload = response.json()
    assert payload["model"]["provider"] == "deepseek"
    assert payload["model"]["model"] == "deepseek-v4-flash"
    assert payload["api_key"] == {"configured": False, "source": "none", "preview": None}
    assert payload["config_path"].endswith("config.toml")


def test_settings_api_saves_config_and_auth_key(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.put(
        "/settings/model",
        json={
            "model": {
                "provider": "openai",
                "model": "gpt-5.4",
                "base_url": None,
                "temperature": 0.2,
                "timeout_seconds": 90,
                "structured_output": True,
            },
            "agents": {
                "parser": "langchain",
                "structurer": "auto",
                "reviewer": "auto",
                "rewriter": "auto",
                "opportunity_calibrator": "auto",
            },
            "api_key": "sk-test-a9f2",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["model"]["provider"] == "openai"
    assert payload["api_key"]["configured"] is True
    assert payload["api_key"]["preview"] == "...a9f2"
    assert "sk-test" not in response.text
    assert load_model_config(tmp_path).model.model == "gpt-5.4"
    assert load_model_auth(tmp_path).TYPEDANCE_LLM_API_KEY == "sk-test-a9f2"


def test_settings_api_clears_auth_json_key_only(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    save_model_auth(tmp_path, api_key="sk-auth-a9f2")
    client = TestClient(app)

    response = client.delete("/settings/model/api-key")

    assert response.status_code == 200
    assert response.json()["api_key"]["configured"] is False
    assert load_model_auth(tmp_path).TYPEDANCE_LLM_API_KEY is None


def test_settings_api_reports_env_key_source(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TYPEDANCE_LLM_API_KEY", "sk-env-a9f2")
    save_model_auth(tmp_path, api_key="sk-auth-0000")
    client = TestClient(app)

    response = client.get("/settings/model")

    assert response.status_code == 200
    assert response.json()["api_key"]["source"] == "env"
    assert response.json()["api_key"]["preview"] == "...a9f2"
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pytest services/sidecar/tests/test_settings_api.py
```

Expected: FAIL，返回 404 或 import error。

- [ ] **Step 3: 新增 settings router**

创建 `services/sidecar/src/typedance_sidecar/settings_api.py`：

```python
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .llm_provider import LlmProviderError, build_chat_model
from .model_settings import (
    AgentModeConfig,
    ModelConfig,
    ModelSettingsError,
    ModelSettingsFile,
    resolve_model_settings,
    save_model_auth,
    save_model_config,
)

DataDirDependency = Callable[[], Path]


class ModelSettingsUpdateRequest(BaseModel):
    model: ModelConfig
    agents: AgentModeConfig
    api_key: str | None = Field(default=None, min_length=1)


class ModelSettingsTestResponse(BaseModel):
    ok: bool
    message: str


def _redacted_response(data_dir: Path) -> dict[str, Any]:
    resolved = resolve_model_settings(data_dir=data_dir)
    return resolved.model_dump(exclude={"api_key": {"value"}})


def create_settings_router(data_dir_dependency: DataDirDependency) -> APIRouter:
    router = APIRouter(prefix="/settings", tags=["settings"])

    @router.get("/model")
    def get_model_settings() -> dict[str, Any]:
        try:
            return _redacted_response(data_dir_dependency())
        except ModelSettingsError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.put("/model")
    def update_model_settings(payload: ModelSettingsUpdateRequest) -> dict[str, Any]:
        data_dir = data_dir_dependency()
        try:
            save_model_config(data_dir, ModelSettingsFile(model=payload.model, agents=payload.agents))
            if payload.api_key is not None:
                save_model_auth(data_dir, api_key=payload.api_key)
            return _redacted_response(data_dir)
        except ModelSettingsError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.delete("/model/api-key")
    def clear_model_api_key() -> dict[str, Any]:
        data_dir = data_dir_dependency()
        try:
            save_model_auth(data_dir, api_key=None)
            return _redacted_response(data_dir)
        except ModelSettingsError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/model/test", response_model=ModelSettingsTestResponse)
    def test_model_settings() -> ModelSettingsTestResponse:
        try:
            model = build_chat_model(data_dir=data_dir_dependency())
            model.invoke([{"role": "user", "content": "Reply with OK."}])
            return ModelSettingsTestResponse(ok=True, message="模型连接成功")
        except (LlmProviderError, ModelSettingsError, Exception) as exc:
            return ModelSettingsTestResponse(ok=False, message=str(exc))

    return router
```

- [ ] **Step 4: 挂载 router**

在 `services/sidecar/src/typedance_sidecar/main.py` 中加入 import：

```python
from .settings_api import create_settings_router
```

在 revision router 后加入：

```python
app.include_router(create_settings_router(app_data_dir))
```

- [ ] **Step 5: 运行 settings API 测试**

Run:

```bash
pytest services/sidecar/tests/test_settings_api.py
```

Expected: PASS。

- [ ] **Step 6: 提交 settings API**

```bash
git add services/sidecar/src/typedance_sidecar/settings_api.py services/sidecar/src/typedance_sidecar/main.py services/sidecar/tests/test_settings_api.py
git commit -m "feat(sidecar): 新增模型设置接口"
```

---

## Task 4: Agent mode 接入配置层

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/resume_parser_runner.py`
- Modify: `services/sidecar/src/typedance_sidecar/resume_structurer_runner.py`
- Modify: `services/sidecar/src/typedance_sidecar/resume_reviewer_runner.py`
- Modify: `services/sidecar/src/typedance_sidecar/resume_rewriter_runner.py`
- Modify: `services/sidecar/src/typedance_sidecar/resume_opportunity_calibrator_runner.py`
- Test: existing runner tests

- [ ] **Step 1: 新增 opportunity calibrator mode 测试**

在 `services/sidecar/tests/test_resume_opportunity_calibrator_runner.py` 中加入：

```python
from typedance_sidecar.resume_opportunity_calibrator_runner import (
    LangChainOpportunityCalibratorRunner,
    build_opportunity_calibrator_runner,
)


def test_opportunity_calibrator_runner_defaults_to_rule():
    runner = build_opportunity_calibrator_runner({})

    assert isinstance(runner, RuleBasedOpportunityCalibratorRunner)


def test_opportunity_calibrator_runner_uses_langchain_mode():
    runner = build_opportunity_calibrator_runner({"TYPEDANCE_RESUME_OPPORTUNITY_CALIBRATOR_MODE": "langchain"})

    assert isinstance(runner, LangChainOpportunityCalibratorRunner)
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pytest services/sidecar/tests/test_resume_opportunity_calibrator_runner.py
```

Expected: FAIL，提示 `build_opportunity_calibrator_runner` 不存在。

- [ ] **Step 3: 修改 runner config 读取设置层**

在 parser/structurer/reviewer/rewriter runner 中，将 `load_*_runner_config()` 改为优先读取 `resolve_model_settings().agents`。

示例用于 `resume_parser_runner.py`：

```python
from .model_settings import ModelSettingsError, resolve_model_settings


def load_resume_parser_runner_config(
    environ: Mapping[str, str] | None = None,
) -> ResumeParserRunnerConfig:
    env = dict(environ if environ is not None else os.environ)
    try:
        mode = resolve_model_settings(environ=env).agents.parser
    except ModelSettingsError:
        mode = env.get("TYPEDANCE_RESUME_PARSER_MODE", "rule").strip().lower()
    if mode in {"rules", "deterministic", "local"}:
        mode = "rule"
    if mode not in {"rule", "langchain", "auto"}:
        raise ValueError(f"Unsupported resume parser runner mode: {mode}")
    return ResumeParserRunnerConfig(mode=mode)
```

对 `structurer`、`reviewer`、`rewriter` 使用同样结构，字段分别为 `agents.structurer`、`agents.reviewer`、`agents.rewriter`。

- [ ] **Step 4: 给 opportunity calibrator 增加 LangChain runner**

在 `services/sidecar/src/typedance_sidecar/resume_opportunity_calibrator_runner.py` 中加入：

```python
import json
import os
from collections.abc import Mapping
from typing import Literal

from .llm_provider import build_chat_model, has_configured_llm_api_key
from .model_settings import ModelSettingsError, resolve_model_settings


OpportunityCalibratorMode = Literal["rule", "langchain", "auto"]


class OpportunityCalibratorRunnerConfig(BaseModel):
    mode: OpportunityCalibratorMode = "rule"


class LangChainOpportunityCalibratorRunner:
    def __init__(self, model_factory: Callable[[], Any] = build_chat_model) -> None:
        self.model_factory = model_factory

    def __call__(
        self,
        context: AgentInvocationContext,
        request: OpportunityCalibratorRunRequest,
    ) -> dict[str, Any]:
        model = self.model_factory()
        structured_model = model.with_structured_output(OpportunityCalibrationOutput)
        raw_output = structured_model.invoke(_messages(context, request))
        output = _coerce_calibration_output(raw_output)
        return {
            "invocation_id": context.invocation_id,
            "run_id": context.run_id,
            "document_id": context.document_id,
            "pack_id": context.pack_id,
            "agent_name": context.agent_name,
            "output_type": "OpportunityCalibrationOutput",
            "confidence": 0.78,
            "warnings": [],
            "payload": output.model_dump(),
            "output_refs": [],
        }


def load_opportunity_calibrator_runner_config(
    environ: Mapping[str, str] | None = None,
) -> OpportunityCalibratorRunnerConfig:
    env = dict(environ if environ is not None else os.environ)
    try:
        mode = resolve_model_settings(environ=env).agents.opportunity_calibrator
    except ModelSettingsError:
        mode = env.get("TYPEDANCE_RESUME_OPPORTUNITY_CALIBRATOR_MODE", "rule").strip().lower()
    if mode in {"rules", "deterministic", "local"}:
        mode = "rule"
    if mode not in {"rule", "langchain", "auto"}:
        raise ValueError(f"Unsupported opportunity calibrator runner mode: {mode}")
    return OpportunityCalibratorRunnerConfig(mode=mode)


def build_opportunity_calibrator_runner(
    environ: Mapping[str, str] | None = None,
    *,
    model_factory: Callable[[], Any] | None = None,
) -> OpportunityCalibratorRunner:
    env = dict(environ if environ is not None else os.environ)
    config = load_opportunity_calibrator_runner_config(env)
    if config.mode == "rule":
        return RuleBasedOpportunityCalibratorRunner()
    if config.mode == "auto" and not has_configured_llm_api_key(env):
        return RuleBasedOpportunityCalibratorRunner()
    factory = model_factory or (lambda: build_chat_model(environ=env))
    return LangChainOpportunityCalibratorRunner(model_factory=factory)
```

同文件加入：

```python
def _messages(
    context: AgentInvocationContext,
    request: OpportunityCalibratorRunRequest,
) -> list[dict[str, str]]:
    payload = {
        "run_type": "opportunity_calibrate",
        "document_id": context.document_id,
        "source_title": request.source_title,
        "source_text": request.source_text,
        "base_draft_id": request.base_draft_id,
        "variant_draft_id": request.variant_draft_id,
        "modules": [module.model_dump() for module in request.modules],
        "claims": [claim.model_dump() for claim in request.claims],
    }
    return [
        {
            "role": "system",
            "content": (
                "你是 TypeDance 的 OpportunityCalibrator。只输出 OpportunityCalibrationOutput。"
                "只能基于基础简历已有事实和岗位文本生成匹配分析、问题和建议。"
                "不得为了匹配岗位而编造经历、技能、指标或证据。"
            ),
        },
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


def _coerce_calibration_output(raw_output: Any) -> OpportunityCalibrationOutput:
    if isinstance(raw_output, OpportunityCalibrationOutput):
        return raw_output
    if isinstance(raw_output, BaseModel):
        return OpportunityCalibrationOutput.model_validate(raw_output.model_dump())
    return OpportunityCalibrationOutput.model_validate(raw_output)
```

- [ ] **Step 5: opportunity service 使用 builder**

修改 `services/sidecar/src/typedance_sidecar/revision_opportunity_calibration.py` import：

```python
from .resume_opportunity_calibrator_runner import (
    OpportunityCalibratorRunRequest,
    OpportunityCalibratorRunner,
    build_opportunity_calibrator_runner,
)
```

修改构造函数默认 runner：

```python
self.calibrator_runner = calibrator_runner or build_opportunity_calibrator_runner()
```

- [ ] **Step 6: 运行 runner 测试**

Run:

```bash
pytest services/sidecar/tests/test_resume_parser_runner.py services/sidecar/tests/test_resume_structurer_runner.py services/sidecar/tests/test_resume_reviewer_runner.py services/sidecar/tests/test_resume_rewriter_runner.py services/sidecar/tests/test_resume_opportunity_calibrator_runner.py
```

Expected: PASS。

- [ ] **Step 7: 提交 agent mode 接入**

```bash
git add services/sidecar/src/typedance_sidecar/resume_parser_runner.py services/sidecar/src/typedance_sidecar/resume_structurer_runner.py services/sidecar/src/typedance_sidecar/resume_reviewer_runner.py services/sidecar/src/typedance_sidecar/resume_rewriter_runner.py services/sidecar/src/typedance_sidecar/resume_opportunity_calibrator_runner.py services/sidecar/src/typedance_sidecar/revision_opportunity_calibration.py services/sidecar/tests/test_resume_opportunity_calibrator_runner.py
git commit -m "feat(sidecar): 接入模型设置的 Agent 模式"
```

---

## Task 5: 前端 settings API helper

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [ ] **Step 1: 新增失败测试**

在 `apps/web/src/api.test.ts` 末尾加入：

```ts
describe("model settings api", () => {
  it("loads redacted model settings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      config_path: "C:/Users/test/.typedance/config.toml",
      auth_path: "C:/Users/test/.typedance/auth.json",
      model: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        base_url: "https://api.deepseek.com",
        temperature: 0,
        timeout_seconds: 120,
        structured_output: true,
      },
      agents: {
        parser: "auto",
        structurer: "auto",
        reviewer: "auto",
        rewriter: "auto",
        opportunity_calibrator: "auto",
      },
      api_key: {
        configured: true,
        source: "auth_json",
        preview: "...a9f2",
      },
    }))));

    const { getModelSettings } = await import("./api");
    const settings = await getModelSettings();

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4317/settings/model");
    expect(settings.model.model).toBe("deepseek-v4-flash");
  });

  it("saves model settings with an optional api key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      config_path: "C:/Users/test/.typedance/config.toml",
      auth_path: "C:/Users/test/.typedance/auth.json",
      model: {
        provider: "openai",
        model: "gpt-5.4",
        base_url: null,
        temperature: 0,
        timeout_seconds: 120,
        structured_output: true,
      },
      agents: {
        parser: "langchain",
        structurer: "auto",
        reviewer: "auto",
        rewriter: "auto",
        opportunity_calibrator: "auto",
      },
      api_key: {
        configured: true,
        source: "auth_json",
        preview: "...a9f2",
      },
    }))));

    const { saveModelSettings } = await import("./api");
    await saveModelSettings({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        base_url: null,
        temperature: 0,
        timeout_seconds: 120,
        structured_output: true,
      },
      agents: {
        parser: "langchain",
        structurer: "auto",
        reviewer: "auto",
        rewriter: "auto",
        opportunity_calibrator: "auto",
      },
      api_key: "sk-test-a9f2",
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/settings/model",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body).api_key).toBe("sk-test-a9f2");
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
corepack pnpm --filter @typedance/web test -- src/api.test.ts
```

Expected: FAIL，提示 `getModelSettings` 不存在。

- [ ] **Step 3: 新增 api helper**

在 `apps/web/src/api.ts` 的 contracts import 中加入：

```ts
  modelSettingsResponseSchema,
  modelSettingsTestResponseSchema,
  modelSettingsUpdateSchema,
  type ModelSettingsResponse,
  type ModelSettingsTestResponse,
  type ModelSettingsUpdate,
```

在 `apps/web/src/api.ts` 中加入：

```ts
export async function getModelSettings(): Promise<ModelSettingsResponse> {
  const response = await fetch(`${baseUrl}/settings/model`)
  return parseTemplateResponse(
    response,
    (value) => modelSettingsResponseSchema.parse(value),
    "Failed to load model settings",
  )
}

export async function saveModelSettings(input: ModelSettingsUpdate): Promise<ModelSettingsResponse> {
  const payload = modelSettingsUpdateSchema.parse(input)
  const response = await fetch(`${baseUrl}/settings/model`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseTemplateResponse(
    response,
    (value) => modelSettingsResponseSchema.parse(value),
    "Failed to save model settings",
  )
}

export async function testModelSettings(): Promise<ModelSettingsTestResponse> {
  const response = await fetch(`${baseUrl}/settings/model/test`, { method: "POST" })
  return parseTemplateResponse(
    response,
    (value) => modelSettingsTestResponseSchema.parse(value),
    "Failed to test model settings",
  )
}

export async function clearModelApiKey(): Promise<ModelSettingsResponse> {
  const response = await fetch(`${baseUrl}/settings/model/api-key`, { method: "DELETE" })
  return parseTemplateResponse(
    response,
    (value) => modelSettingsResponseSchema.parse(value),
    "Failed to clear model API key",
  )
}
```

- [ ] **Step 4: 运行 API helper 测试**

Run:

```bash
corepack pnpm --filter @typedance/web test -- src/api.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交前端 API**

```bash
git add apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "feat(web): 新增模型设置 API"
```

---

## Task 6: 设置页 UI 与路由

**Files:**
- Create: `apps/web/src/features/settings/SettingsPage.tsx`
- Create: `apps/web/src/features/settings/SettingsPage.test.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/components/SiteSidebar.tsx`

- [ ] **Step 1: 新增设置页测试**

创建 `apps/web/src/features/settings/SettingsPage.test.tsx`：

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { SettingsPage } from "./SettingsPage"

const basePayload = {
  config_path: "C:/Users/test/.typedance/config.toml",
  auth_path: "C:/Users/test/.typedance/auth.json",
  model: {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    base_url: "https://api.deepseek.com",
    temperature: 0,
    timeout_seconds: 120,
    structured_output: true,
  },
  agents: {
    parser: "auto",
    structurer: "auto",
    reviewer: "auto",
    rewriter: "auto",
    opportunity_calibrator: "auto",
  },
  api_key: {
    configured: true,
    source: "auth_json",
    preview: "...a9f2",
  },
}

describe("SettingsPage", () => {
  it("loads and displays model settings without exposing the full key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(basePayload))))

    render(<SettingsPage />)

    expect(await screen.findByDisplayValue("deepseek-v4-flash")).toBeInTheDocument()
    expect(screen.getByText("已配置 ...a9f2")).toBeInTheDocument()
    expect(screen.queryByText(/sk-/)).not.toBeInTheDocument()
  })

  it("saves edited model settings", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(basePayload))))

    render(<SettingsPage />)

    const modelInput = await screen.findByLabelText("模型")
    await user.clear(modelInput)
    await user.type(modelInput, "deepseek-v4-pro")
    await user.click(screen.getByRole("button", { name: "保存设置" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:4317/settings/model",
        expect.objectContaining({ method: "PUT" }),
      )
    })
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
corepack pnpm --filter @typedance/web test -- src/features/settings/SettingsPage.test.tsx
```

Expected: FAIL，提示 `SettingsPage` 不存在。

- [ ] **Step 3: 创建 SettingsPage**

创建 `apps/web/src/features/settings/SettingsPage.tsx`，使用现有 shadcn/ui 组件，不新增官方组件源码：

```tsx
import { useCallback, useEffect, useState } from "react"
import { Loader2, Save, TestTube2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  clearModelApiKey,
  getModelSettings,
  saveModelSettings,
  testModelSettings,
} from "@/api"
import type { AgentMode, ModelProvider, ModelSettingsResponse } from "@typedance/contracts"

const providerOptions: Array<{ value: ModelProvider; label: string }> = [
  { value: "deepseek", label: "DeepSeek" },
  { value: "openai", label: "OpenAI" },
  { value: "openai_compatible", label: "OpenAI-compatible" },
]

const agentModeOptions: Array<{ value: AgentMode; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "langchain", label: "真实模型" },
  { value: "rule", label: "本地规则" },
]

type FormState = ModelSettingsResponse & { api_key_input: string }

function toFormState(settings: ModelSettingsResponse): FormState {
  return { ...settings, api_key_input: "" }
}

export function SettingsPage() {
  const [form, setForm] = useState<FormState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setForm(toFormState(await getModelSettings()))
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "加载模型设置失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleSave() {
    if (!form) return
    setSaving(true)
    try {
      const saved = await saveModelSettings({
        model: form.model,
        agents: form.agents,
        ...(form.api_key_input.trim() ? { api_key: form.api_key_input.trim() } : {}),
      })
      setForm(toFormState(saved))
      toast.success("模型设置已保存")
    } catch (exc) {
      toast.error(exc instanceof Error ? exc.message : "保存模型设置失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    try {
      const result = await testModelSettings()
      toast[result.ok ? "success" : "error"](result.message)
    } finally {
      setTesting(false)
    }
  }

  async function handleClearKey() {
    const cleared = await clearModelApiKey()
    setForm(toFormState(cleared))
    toast.success("已清除本机保存的 API Key")
  }

  if (loading) {
    return <div className="flex min-h-[320px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  if (error || !form) {
    return <div className="mx-auto max-w-4xl p-6 text-sm text-destructive">{error ?? "模型设置不可用"}</div>
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">设置</h1>
      </div>

      <FieldSet>
        <FieldGroup>
          <section className="space-y-5 border-b border-border pb-6">
            <FieldTitle>模型</FieldTitle>
            <Field>
              <FieldLabel htmlFor="provider">供应商</FieldLabel>
              <Select
                value={form.model.provider}
                onValueChange={(value) => setForm({ ...form, model: { ...form.model, provider: value as ModelProvider } })}
              >
                <SelectTrigger id="provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="model">模型</FieldLabel>
              <Input
                id="model"
                value={form.model.model}
                onChange={(event) => setForm({ ...form, model: { ...form.model, model: event.target.value } })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="base-url">Base URL</FieldLabel>
              <Input
                id="base-url"
                value={form.model.base_url ?? ""}
                onChange={(event) => setForm({ ...form, model: { ...form.model, base_url: event.target.value || null } })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="temperature">Temperature</FieldLabel>
                <Input
                  id="temperature"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.model.temperature}
                  onChange={(event) => setForm({ ...form, model: { ...form.model, temperature: Number(event.target.value) } })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="timeout">Timeout seconds</FieldLabel>
                <Input
                  id="timeout"
                  type="number"
                  min={1}
                  value={form.model.timeout_seconds}
                  onChange={(event) => setForm({ ...form, model: { ...form.model, timeout_seconds: Number(event.target.value) } })}
                />
              </Field>
            </div>
            <Field orientation="horizontal">
              <Switch
                id="structured-output"
                checked={form.model.structured_output}
                onCheckedChange={(checked) => setForm({ ...form, model: { ...form.model, structured_output: checked } })}
              />
              <FieldLabel htmlFor="structured-output">结构化输出</FieldLabel>
            </Field>
          </section>
        </FieldGroup>
      </FieldSet>
    </div>
  )
}
```

在同组件中补充 API Key 和 Agent mode 区域，放在模型 section 后：

```tsx
<section className="space-y-5 border-b border-border py-6">
  <FieldTitle>API Key</FieldTitle>
  <p className="text-sm text-muted-foreground">
    {form.api_key.source === "env"
      ? "当前由环境变量生效"
      : form.api_key.configured
        ? `已配置 ${form.api_key.preview ?? ""}`
        : "未配置"}
  </p>
  <Field>
    <FieldLabel htmlFor="api-key">新 API Key</FieldLabel>
    <Input
      id="api-key"
      type="password"
      value={form.api_key_input}
      onChange={(event) => setForm({ ...form, api_key_input: event.target.value })}
      placeholder="输入后保存到 auth.json"
    />
    <FieldDescription>页面不会展示完整 API Key。</FieldDescription>
  </Field>
  <Button type="button" variant="outline" onClick={handleClearKey} disabled={form.api_key.source === "env"}>
    <Trash2 className="mr-2 h-4 w-4" />
    清除本机 Key
  </Button>
</section>

<section className="space-y-5 py-6">
  <FieldTitle>Agent 模式</FieldTitle>
  {([
    ["parser", "Parser"],
    ["structurer", "Structurer"],
    ["reviewer", "Reviewer"],
    ["rewriter", "Rewriter"],
    ["opportunity_calibrator", "Opportunity Calibrator"],
  ] as const).map(([key, label]) => (
    <Field key={key}>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={form.agents[key]}
        onValueChange={(value) => setForm({ ...form, agents: { ...form.agents, [key]: value as AgentMode } })}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {agentModeOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  ))}
</section>

<div className="flex flex-wrap gap-2">
  <Button type="button" onClick={handleSave} disabled={saving}>
    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
    保存设置
  </Button>
  <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
    {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-2 h-4 w-4" />}
    测试连接
  </Button>
</div>
```

- [ ] **Step 4: 新增路由**

在 `apps/web/src/router.tsx` 中加入 import：

```tsx
import { SettingsPage } from "./features/settings/SettingsPage"
```

在 children 中加入：

```tsx
{ path: "/settings", element: <SettingsPage /> },
```

- [ ] **Step 5: 设置侧栏入口**

修改 `apps/web/src/components/SiteSidebar.tsx` 的 footer：

```tsx
<SidebarMenuButton asChild tooltip="设置" isActive={location.pathname === "/settings"}>
  <Link to="/settings" aria-current={location.pathname === "/settings" ? "page" : undefined}>
    <Settings />
    <span>设置</span>
  </Link>
</SidebarMenuButton>
```

- [ ] **Step 6: 运行设置页测试**

Run:

```bash
corepack pnpm --filter @typedance/web test -- src/features/settings/SettingsPage.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 提交设置页**

```bash
git add apps/web/src/features/settings/SettingsPage.tsx apps/web/src/features/settings/SettingsPage.test.tsx apps/web/src/router.tsx apps/web/src/components/SiteSidebar.tsx
git commit -m "feat(web): 新增模型设置页面"
```

---

## Task 7: 全量验证与文档收口

**Files:**
- Modify: `docs/README.md`
- Existing verification only.

- [ ] **Step 1: 运行 sidecar 测试**

Run:

```bash
corepack pnpm --filter @typedance/sidecar test
```

Expected: PASS。

- [ ] **Step 2: 运行 web 测试**

Run:

```bash
corepack pnpm --filter @typedance/web test
```

Expected: PASS。

- [ ] **Step 3: 运行 contracts 测试**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
```

Expected: PASS。

- [ ] **Step 4: 运行 web build**

Run:

```bash
corepack pnpm --filter @typedance/web build
```

Expected: PASS；允许现有 Vite chunk size warning。

- [ ] **Step 5: 运行全量测试**

Run:

```bash
corepack pnpm test
```

Expected: PASS。

- [ ] **Step 6: 更新 docs README**

在 `docs/README.md` 的当前实施计划附近新增一条：

```md
- `superpowers/specs/2026-05-26-model-settings-design.md`
  - 桌面端模型配置设计。
  - 规定 `config.toml` 和 `auth.json` 分工、DeepSeek 默认模型、设置页行为与 settings API 边界。
```

- [ ] **Step 7: 提交文档收口**

```bash
git add docs/README.md
git commit -m "docs(settings): 补充模型设置文档索引"
```

- [ ] **Step 8: 最终状态检查**

Run:

```bash
git status -sb
git log --oneline --decorate --max-count=8
```

Expected: 工作区干净，最近提交包含本计划任务提交。

---

## Self-Review

**Spec coverage:** 本计划覆盖 `config.toml`、`auth.json`、环境变量优先级、DeepSeek 默认模型、settings API、设置页、脱敏展示、Agent mode、测试和文档索引。登录态、keychain、多 key 管理和 Web/SaaS 配置保持为非目标或后续扩展。

**Placeholder scan:** 本计划没有占位词、空泛测试项或未命名测试步骤。每个任务都包含明确文件、测试命令和提交命令。

**Type consistency:** 前端契约字段使用 `provider`、`model`、`base_url`、`temperature`、`timeout_seconds`、`structured_output`、`agents`、`api_key`；后端 Pydantic 模型和 API payload 使用同名字段。
