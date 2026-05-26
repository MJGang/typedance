import pytest

from typedance_sidecar.llm_provider import (
    DEFAULT_DEEPSEEK_BASE_URL,
    LlmProviderError,
    build_chat_model,
    has_configured_llm_api_key,
    load_llm_provider_config,
    with_typedance_structured_output,
)


def test_llm_provider_defaults_to_deepseek_openai_compatible(tmp_path):
    config = load_llm_provider_config({}, data_dir=tmp_path)

    assert config.provider == "deepseek"
    assert config.model == "deepseek-v4-flash"
    assert config.base_url == DEFAULT_DEEPSEEK_BASE_URL
    assert config.model_provider == "openai"
    assert config.api_key_env_names == ["TYPEDANCE_LLM_API_KEY", "DEEPSEEK_API_KEY"]


def test_llm_provider_requires_api_key_without_storing_secret(tmp_path):
    config = load_llm_provider_config({}, data_dir=tmp_path)

    with pytest.raises(LlmProviderError, match="TYPEDANCE_LLM_API_KEY"):
        build_chat_model(config, environ={}, data_dir=tmp_path)

    assert "api_key" not in config.model_dump()
    assert "sk-" not in repr(config)
    assert has_configured_llm_api_key({}, config, data_dir=tmp_path) is False
    assert has_configured_llm_api_key({"DEEPSEEK_API_KEY": "sk-test"}, config, data_dir=tmp_path) is True


def test_llm_provider_builds_langchain_chat_model_from_env(tmp_path):
    calls = {}

    class ExpectedModel:
        pass

    expected_model = ExpectedModel()
    config = load_llm_provider_config(
        {
            "TYPEDANCE_LLM_MODEL": "deepseek-reasoner",
            "TYPEDANCE_LLM_TIMEOUT_SECONDS": "90",
            "TYPEDANCE_LLM_TEMPERATURE": "0.2",
        },
        data_dir=tmp_path,
    )

    def fake_init_chat_model(**kwargs):
        calls.update(kwargs)
        return expected_model

    model = build_chat_model(
        config,
        environ={"DEEPSEEK_API_KEY": "sk-test"},
        data_dir=tmp_path,
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
    }
    assert getattr(model, "_typedance_structured_output_method") == "json_mode"


def test_llm_provider_uses_native_structured_output_for_openai(tmp_path):
    calls = {}

    class ExpectedModel:
        pass

    expected_model = ExpectedModel()

    def fake_init_chat_model(**kwargs):
        calls.update(kwargs)
        return expected_model

    model = build_chat_model(
        config=load_llm_provider_config(
            {
                "TYPEDANCE_LLM_PROVIDER": "openai",
                "TYPEDANCE_LLM_MODEL": "gpt-5.4",
            },
            data_dir=tmp_path,
        ),
        environ={"OPENAI_API_KEY": "sk-openai"},
        data_dir=tmp_path,
        init_chat_model_fn=fake_init_chat_model,
    )

    assert calls["profile"] == {"structured_output": True}
    assert getattr(model, "_typedance_structured_output_method") == "json_schema"


def test_with_typedance_structured_output_passes_provider_method():
    calls = {}

    class FakeModel:
        _typedance_structured_output_method = "json_mode"

        def with_structured_output(self, schema, **kwargs):
            calls["schema"] = schema
            calls["kwargs"] = kwargs
            return "structured"

    assert with_typedance_structured_output(FakeModel(), dict) == "structured"
    assert calls == {"schema": dict, "kwargs": {"method": "json_mode"}}


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
