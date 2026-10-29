from conftest import authenticated_client
import pytest
from fastapi.testclient import TestClient

from fixtures.heading2_styles import template_style_payload
from typedance_sidecar.main import app


def test_template_sample_round_trip_without_updated_at(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = authenticated_client(app)

    payload = {
        "id": "test-sample",
        "name": {"zh-CN": "娴嬭瘯鏍峰紶", "en-US": "Test sample"},
        "target_language": "zh-CN",
        "doc_json": {"type": "doc", "content": []},
        "plain_text_snapshot": "",
    }
    resp = client.put("/template-samples/test-sample", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["id"] == "test-sample"
    assert data["updated_at"] is not None

    resp = client.get("/template-samples/test-sample")
    assert resp.status_code == 200
    assert resp.json()["id"] == "test-sample"


def test_style_config_round_trip(client):
    """TemplateStyleConfig round trip with blocks"""
    payload = template_style_payload("accent-wash")
    resp = client.put("/template-styles/classic-a4", json=payload)
    assert resp.status_code == 200, resp.text

    resp = client.get("/template-styles/classic-a4")
    assert resp.status_code == 200
    data = resp.json()
    assert data["template_id"] == "classic-a4"
    assert "heading1" in data["blocks"]
    assert data["blocks"]["heading1"]["fontSize"] == "28px"
    assert data["theme"]["accentColor"] == "#174EA6"
    assert data["blocks"]["heading2"]["decorationStyle"] == "accent-wash"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda payload: payload.pop("theme"),
        lambda payload: payload["theme"].update({"accentColor": "blue"}),
        lambda payload: payload["blocks"]["heading2"].update({"decorationStyle": "ornate"}),
        lambda payload: payload["blocks"]["heading2"].update({"backgroundColor": "#ffffff"}),
        lambda payload: payload["blocks"]["heading2"].update({"borderBottom": {"style": "solid"}}),
    ],
)
def test_style_config_rejects_incomplete_or_invalid_h2_contract(client, mutate):
    payload = template_style_payload()
    mutate(payload)

    response = client.put("/template-styles/classic-a4", json=payload)

    assert response.status_code == 422, response.text


def test_style_config_list_returns_saved_styles(client):
    payload = template_style_payload(template_id="user_classic-a4_1")
    payload["name"] = "我的主题"
    resp = client.put("/template-styles/user_classic-a4_1", json=payload)
    assert resp.status_code == 200, resp.text

    resp = client.get("/template-styles")
    assert resp.status_code == 200
    data = resp.json()
    assert any(item["template_id"] == "user_classic-a4_1" for item in data)


def test_style_config_delete_removes_saved_style(client):
    payload = template_style_payload(template_id="user_theme_to_delete")
    payload["name"] = "我的主题"
    resp = client.put("/template-styles/user_theme_to_delete", json=payload)
    assert resp.status_code == 200, resp.text

    resp = client.delete("/template-styles/user_theme_to_delete")
    assert resp.status_code == 204

    resp = client.get("/template-styles/user_theme_to_delete")
    assert resp.status_code == 404


def test_style_config_delete_reassigns_documents_to_classic_a4(client):
    custom_template_id = "user_theme_in_use"
    created_style = client.put(
        f"/template-styles/{custom_template_id}",
        json={**template_style_payload(template_id=custom_template_id), "name": "正在使用的主题"},
    )
    assert created_style.status_code == 200
    created_document = client.post(
        "/documents",
        json={"title": "模板引用测试", "initial_mode": "base_resume"},
    )
    assert created_document.status_code == 201
    document_id = created_document.json()["id"]
    selected = client.patch(
        f"/documents/{document_id}",
        json={"template_id": custom_template_id},
    )
    assert selected.status_code == 200

    deleted = client.delete(f"/template-styles/{custom_template_id}")

    assert deleted.status_code == 204
    assert client.get(f"/documents/{document_id}").json()["template_id"] == "classic-a4"


def test_style_config_rejects_empty_template_id(client):
    payload = template_style_payload()
    payload["template_id"] = ""
    resp = client.put("/template-styles/classic-a4", json=payload)
    assert resp.status_code == 422


def test_style_config_rejects_mismatched_template_id(client):
    resp = client.put(
        "/template-styles/classic-a4",
        json=template_style_payload(template_id="other-template"),
    )
    assert resp.status_code == 400
