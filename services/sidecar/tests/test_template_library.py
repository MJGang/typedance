import pytest
from fastapi.testclient import TestClient

from typedance_sidecar.main import app


def test_template_sample_round_trip_without_updated_at(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

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
    payload = {
        "template_id": "classic-a4",
        "preset": "classic",
        "blocks": {
            "heading1": {"fontSize": "24px", "fontWeight": 700, "color": "#1a1a1a"},
            "paragraph": {"fontSize": "10px", "lineHeight": 1.5, "color": "#334155"},
        },
    }
    resp = client.put("/template-styles/classic-a4", json=payload)
    assert resp.status_code == 200, resp.text

    resp = client.get("/template-styles/classic-a4")
    assert resp.status_code == 200
    data = resp.json()
    assert data["template_id"] == "classic-a4"
    assert "heading1" in data["blocks"]
    assert data["blocks"]["heading1"]["fontSize"] == "24px"


def test_style_config_rejects_empty_template_id(client):
    resp = client.put("/template-styles/classic-a4", json={
        "template_id": "",
        "preset": "classic",
        "blocks": {},
    })
    assert resp.status_code == 422


def test_style_config_rejects_mismatched_template_id(client):
    resp = client.put("/template-styles/classic-a4", json={
        "template_id": "other-template",
        "preset": "classic",
        "blocks": {},
    })
    assert resp.status_code == 400
