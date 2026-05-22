import os
from collections.abc import Callable, Mapping
from typing import Any, Literal

from langchain.chat_models import init_chat_model
from pydantic import BaseModel, Field


DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_DEEPSEEK_MODEL = "deepseek-chat"


class LlmProviderError(Exception):
    pass


class LlmProviderConfig(BaseModel):
    provider: Literal["deepseek", "openai", "openai_compatible"] = "deepseek"
    model: str = DEFAULT_DEEPSEEK_MODEL
    model_provider: str = "openai"
    base_url: str | None = DEFAULT_DEEPSEEK_BASE_URL
    api_key_env_names: list[str] = Field(default_factory=lambda: ["TYPEDANCE_LLM_API_KEY", "DEEPSEEK_API_KEY"])
    temperature: float = 0
    timeout_seconds: float = 120
    structured_output: bool = True


def load_llm_provider_config(
    environ: Mapping[str, str] | None = None,
) -> LlmProviderConfig:
    env = environ if environ is not None else os.environ
    provider = env.get("TYPEDANCE_LLM_PROVIDER", "deepseek").strip().lower()
    if provider not in {"deepseek", "openai", "openai_compatible"}:
        raise LlmProviderError(f"Unsupported LLM provider: {provider}")

    model = env.get("TYPEDANCE_LLM_MODEL") or _default_model(provider)
    base_url = env.get("TYPEDANCE_LLM_BASE_URL") or _default_base_url(provider)
    return LlmProviderConfig(
        provider=provider,
        model=model,
        model_provider="openai",
        base_url=base_url,
        api_key_env_names=_api_key_env_names(provider),
        temperature=_float_env(env, "TYPEDANCE_LLM_TEMPERATURE", 0),
        timeout_seconds=_float_env(env, "TYPEDANCE_LLM_TIMEOUT_SECONDS", 120),
        structured_output=_bool_env(env, "TYPEDANCE_LLM_STRUCTURED_OUTPUT", True),
    )


def build_chat_model(
    config: LlmProviderConfig | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    init_chat_model_fn: Callable[..., Any] = init_chat_model,
) -> Any:
    resolved_config = config or load_llm_provider_config(environ)
    env = environ if environ is not None else os.environ
    api_key = _first_present_env(env, resolved_config.api_key_env_names)
    if not api_key:
        names = ", ".join(resolved_config.api_key_env_names)
        raise LlmProviderError(f"Missing LLM API key. Set one of: {names}")

    kwargs: dict[str, Any] = {
        "model": resolved_config.model,
        "model_provider": resolved_config.model_provider,
        "api_key": api_key,
        "temperature": resolved_config.temperature,
        "timeout": resolved_config.timeout_seconds,
    }
    if resolved_config.base_url:
        kwargs["base_url"] = resolved_config.base_url
    if resolved_config.structured_output:
        kwargs["profile"] = {"structured_output": True}
    return init_chat_model_fn(**kwargs)


def has_configured_llm_api_key(
    environ: Mapping[str, str] | None = None,
    config: LlmProviderConfig | None = None,
) -> bool:
    resolved_config = config or load_llm_provider_config(environ)
    env = environ if environ is not None else os.environ
    return _first_present_env(env, resolved_config.api_key_env_names) is not None


def _default_model(provider: str) -> str:
    if provider == "openai":
        return "gpt-5.4"
    return DEFAULT_DEEPSEEK_MODEL


def _default_base_url(provider: str) -> str | None:
    if provider == "deepseek":
        return DEFAULT_DEEPSEEK_BASE_URL
    return None


def _api_key_env_names(provider: str) -> list[str]:
    if provider == "openai":
        return ["TYPEDANCE_LLM_API_KEY", "OPENAI_API_KEY"]
    return ["TYPEDANCE_LLM_API_KEY", "DEEPSEEK_API_KEY"]


def _first_present_env(env: Mapping[str, str], names: list[str]) -> str | None:
    for name in names:
        value = env.get(name)
        if value:
            return value
    return None


def _float_env(env: Mapping[str, str], name: str, default: float) -> float:
    value = env.get(name)
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError as exc:
        raise LlmProviderError(f"Invalid float env {name}: {value}") from exc


def _bool_env(env: Mapping[str, str], name: str, default: bool) -> bool:
    value = env.get(name)
    if value is None or not value.strip():
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise LlmProviderError(f"Invalid boolean env {name}: {value}")
