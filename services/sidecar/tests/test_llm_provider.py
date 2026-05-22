import pytest

from typedance_sidecar.llm_provider import (
    DEFAULT_DEEPSEEK_BASE_URL,
    LlmProviderError,
    build_chat_model,
    load_llm_provider_config,
)


def test_llm_provider_defaults_to_deepseek_openai_compatible():
    config = load_llm_provider_config({})

    assert config.provider == "deepseek"
    assert config.model == "deepseek-chat"
    assert config.base_url == DEFAULT_DEEPSEEK_BASE_URL
    assert config.model_provider == "openai"
    assert config.api_key_env_names == ["TYPEDANCE_LLM_API_KEY", "DEEPSEEK_API_KEY"]


def test_llm_provider_requires_api_key_without_storing_secret():
    config = load_llm_provider_config({})

    with pytest.raises(LlmProviderError, match="TYPEDANCE_LLM_API_KEY"):
        build_chat_model(config, environ={})

    assert "api_key" not in config.model_dump()
    assert "sk-" not in repr(config)


def test_llm_provider_builds_langchain_chat_model_from_env():
    calls = {}
    expected_model = object()
    config = load_llm_provider_config(
        {
            "TYPEDANCE_LLM_MODEL": "deepseek-reasoner",
            "TYPEDANCE_LLM_TIMEOUT_SECONDS": "90",
            "TYPEDANCE_LLM_TEMPERATURE": "0.2",
        }
    )

    def fake_init_chat_model(**kwargs):
        calls.update(kwargs)
        return expected_model

    model = build_chat_model(
        config,
        environ={"DEEPSEEK_API_KEY": "sk-test"},
        init_chat_model_fn=fake_init_chat_model,
    )

    assert model is expected_model
    assert calls == {
        "model": "deepseek-reasoner",
        "model_provider": "openai",
        "base_url": DEFAULT_DEEPSEEK_BASE_URL,
        "api_key": "sk-test",
        "temperature": 0.2,
        "timeout": 90.0,
        "profile": {"structured_output": True},
    }
