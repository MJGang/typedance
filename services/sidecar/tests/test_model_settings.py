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
    assert "value" not in resolved.model_dump()["api_key"]


def test_save_model_config_omits_none_base_url_from_toml(tmp_path):
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
                "parser": "auto",
                "structurer": "auto",
                "reviewer": "auto",
                "rewriter": "auto",
                "opportunity_calibrator": "auto",
            },
        },
    )

    raw_config = (tmp_path / "config.toml").read_text(encoding="utf-8")

    assert "base_url = null" not in raw_config
    assert load_model_config(tmp_path).model.base_url is None


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


def test_provider_specific_defaults_apply_when_config_omits_model_values(tmp_path):
    (tmp_path / "config.toml").write_text(
        "[model]\nprovider = \"openai\"\n\n[agents]\n",
        encoding="utf-8",
    )

    resolved = resolve_model_settings(data_dir=tmp_path, environ={})

    assert resolved.model.provider == "openai"
    assert resolved.model.model == "gpt-5.4"
    assert resolved.model.base_url is None


def test_corrupt_auth_json_returns_understandable_error(tmp_path):
    (tmp_path / "auth.json").write_text("{not-json", encoding="utf-8")

    with pytest.raises(ModelSettingsError, match="auth.json"):
        load_model_auth(tmp_path)


def test_api_key_preview_never_returns_full_key():
    assert api_key_preview("sk-1234567890abcdef") == "...cdef"
    assert api_key_preview("short") == "...hort"
    assert api_key_preview(None) is None


def test_model_auth_preserves_future_login_fields(tmp_path):
    (tmp_path / "auth.json").write_text(
        json.dumps(
            {
                "auth_mode": "login",
                "TYPEDANCE_LLM_API_KEY": None,
                "tokens": {"access_token": "token"},
                "last_refresh": "2026-05-26T06:00:00Z",
            }
        ),
        encoding="utf-8",
    )

    saved = save_model_auth(tmp_path, api_key="sk-new")

    assert saved.auth_mode == "api_key"
    assert saved.tokens == {"access_token": "token"}
    assert saved.last_refresh == "2026-05-26T06:00:00Z"
