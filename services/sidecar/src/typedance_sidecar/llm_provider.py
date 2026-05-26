import json
import os
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any, Literal

from langchain.chat_models import init_chat_model
from pydantic import BaseModel, Field

from .model_settings import (
    DEFAULT_DEEPSEEK_BASE_URL,
    DEFAULT_DEEPSEEK_MODEL,
    ModelSettingsError,
    resolve_model_settings,
)


class LlmProviderError(Exception):
    pass


StructuredOutputMethod = Literal["json_mode", "json_schema"]


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
    *,
    data_dir: Path | None = None,
) -> LlmProviderConfig:
    env = environ if environ is not None else os.environ
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


def build_chat_model(
    config: LlmProviderConfig | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    data_dir: Path | None = None,
    init_chat_model_fn: Callable[..., Any] = init_chat_model,
) -> Any:
    env = environ if environ is not None else os.environ
    resolved_config = config or load_llm_provider_config(env, data_dir=data_dir)
    try:
        settings = resolve_model_settings(data_dir=data_dir, environ=env)
    except ModelSettingsError as exc:
        raise LlmProviderError(str(exc)) from exc
    api_key = _first_present_env(env, resolved_config.api_key_env_names) or settings.api_key.value
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
    structured_output_method = structured_output_method_for_config(resolved_config)
    if resolved_config.structured_output and structured_output_method == "json_schema":
        kwargs["profile"] = {"structured_output": True}
    model = init_chat_model_fn(**kwargs)
    _attach_structured_output_method(model, structured_output_method)
    return model


def structured_output_method_for_config(config: LlmProviderConfig) -> StructuredOutputMethod:
    if config.provider == "openai" and config.structured_output:
        return "json_schema"
    return "json_mode"


def with_typedance_structured_output(model: Any, schema: Any) -> Any:
    method = getattr(model, "_typedance_structured_output_method", None)
    if method in {"json_mode", "json_schema"}:
        return model.with_structured_output(schema, method=method)
    return model.with_structured_output(schema)


def structured_output_system_instruction(schema: type[BaseModel]) -> str:
    schema_json = json.dumps(schema.model_json_schema(), ensure_ascii=False)
    return (
        "只输出合法 json 对象，不要输出 Markdown、代码块或解释文本。"
        f"json 必须能被 {schema.__name__} 解析，并完全符合这个 JSON Schema：{schema_json}"
    )


def has_configured_llm_api_key(
    environ: Mapping[str, str] | None = None,
    config: LlmProviderConfig | None = None,
    *,
    data_dir: Path | None = None,
) -> bool:
    env = environ if environ is not None else os.environ
    try:
        settings = resolve_model_settings(data_dir=data_dir, environ=env)
    except ModelSettingsError as exc:
        raise LlmProviderError(str(exc)) from exc
    resolved_config = config or load_llm_provider_config(env, data_dir=data_dir)
    return (_first_present_env(env, resolved_config.api_key_env_names) or settings.api_key.value) is not None


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


def _attach_structured_output_method(model: Any, method: StructuredOutputMethod) -> None:
    try:
        setattr(model, "_typedance_structured_output_method", method)
    except Exception:
        try:
            object.__setattr__(model, "_typedance_structured_output_method", method)
        except Exception:
            pass
