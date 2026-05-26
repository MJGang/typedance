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


def test_settings_api_model_test_reports_missing_key(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.post("/settings/model/test")

    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert "TYPEDANCE_LLM_API_KEY" in response.json()["message"]
