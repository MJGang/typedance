import json
import os
import tomllib
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Literal, cast

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
    base_url: str | None = None
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


def default_data_dir(environ: Mapping[str, str] | None = None) -> Path:
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
    try:
        settings = payload if isinstance(payload, ModelSettingsFile) else ModelSettingsFile.model_validate(payload)
    except ValidationError as exc:
        raise ModelSettingsError(f"Invalid config.toml payload: {exc}") from exc
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
    environ: Mapping[str, str] | None = None,
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


def _model_with_env_overrides(model: ModelConfig, env: Mapping[str, str]) -> ModelConfig:
    raw_provider = env.get("TYPEDANCE_LLM_PROVIDER")
    provider = (raw_provider or model.provider).strip().lower()
    if provider not in {"deepseek", "openai", "openai_compatible"}:
        raise ModelSettingsError(f"Unsupported LLM provider: {provider}")

    base_url = _resolved_base_url(
        provider=provider,
        config_provider=model.provider,
        config_base_url=model.base_url,
        raw_provider=raw_provider,
        env=env,
    )
    model_name = _resolved_model_name(
        provider=provider,
        config_provider=model.provider,
        config_model=model.model,
        raw_provider=raw_provider,
        model_was_configured="model" in model.model_fields_set,
        env=env,
    )
    return model.model_copy(
        update={
            "provider": provider,
            "model": model_name,
            "base_url": base_url,
            "temperature": _float_env(env, "TYPEDANCE_LLM_TEMPERATURE", model.temperature),
            "timeout_seconds": _float_env(env, "TYPEDANCE_LLM_TIMEOUT_SECONDS", model.timeout_seconds),
            "structured_output": _bool_env(env, "TYPEDANCE_LLM_STRUCTURED_OUTPUT", model.structured_output),
        }
    )


def _resolved_base_url(
    *,
    provider: str,
    config_provider: str,
    config_base_url: str | None,
    raw_provider: str | None,
    env: Mapping[str, str],
) -> str | None:
    if "TYPEDANCE_LLM_BASE_URL" in env:
        value = env.get("TYPEDANCE_LLM_BASE_URL", "")
        return None if value == "" else value
    if raw_provider is not None and provider != config_provider:
        return _default_base_url(provider)
    return config_base_url or _default_base_url(provider)


def _resolved_model_name(
    *,
    provider: str,
    config_provider: str,
    config_model: str,
    raw_provider: str | None,
    model_was_configured: bool,
    env: Mapping[str, str],
) -> str:
    env_model = env.get("TYPEDANCE_LLM_MODEL")
    if env_model:
        return env_model
    if raw_provider is not None and provider != config_provider:
        return _default_model(provider)
    if not model_was_configured:
        return _default_model(provider)
    return config_model


def _agents_with_env_overrides(agents: AgentModeConfig, env: Mapping[str, str]) -> AgentModeConfig:
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


def _api_key(env: Mapping[str, str], auth: ModelAuthFile, provider: str) -> tuple[str | None, ApiKeySource]:
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


def _agent_mode_env(env: Mapping[str, str], name: str, default: AgentMode) -> AgentMode:
    value = env.get(name)
    if value is None or not value.strip():
        return default
    normalized = value.strip().lower()
    if normalized in {"rules", "deterministic", "local"}:
        normalized = "rule"
    if normalized not in {"rule", "auto", "langchain"}:
        raise ModelSettingsError(f"Unsupported agent mode {name}: {value}")
    return cast(AgentMode, normalized)


def _float_env(env: Mapping[str, str], name: str, default: float) -> float:
    value = env.get(name)
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError as exc:
        raise ModelSettingsError(f"Invalid float env {name}: {value}") from exc


def _bool_env(env: Mapping[str, str], name: str, default: bool) -> bool:
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
    model_lines = [
        "[model]",
        f"provider = {json.dumps(model.provider)}",
        f"model = {json.dumps(model.model)}",
    ]
    if model.base_url is not None:
        model_lines.append(f"base_url = {json.dumps(model.base_url)}")
    model_lines.extend(
        [
            f"temperature = {model.temperature}",
            f"timeout_seconds = {model.timeout_seconds}",
            f"structured_output = {str(model.structured_output).lower()}",
            "",
            "[agents]",
            f"parser = {json.dumps(agents.parser)}",
            f"structurer = {json.dumps(agents.structurer)}",
            f"reviewer = {json.dumps(agents.reviewer)}",
            f"rewriter = {json.dumps(agents.rewriter)}",
            f"opportunity_calibrator = {json.dumps(agents.opportunity_calibrator)}",
            "",
        ]
    )
    return "\n".join(model_lines)


def _atomic_write_text(path: Path, text: str) -> None:
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(text, encoding="utf-8")
    temp_path.replace(path)
