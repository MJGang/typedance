import pytest
from fastapi.testclient import TestClient

from typedance_sidecar.main import app


def test_template_sample_round_trip_without_updated_at(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    payload = {
        "id": "sample-tech-zh",
        "name": {"zh-CN": "通用技术样张", "en-US": "General technical sample"},
        "target_language": "zh-CN",
        "doc_json": {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "张三"}]}],
        },
        "plain_text_snapshot": "张三",
    }

    put_response = client.put("/template-samples/sample-tech-zh", json=payload)

    assert put_response.status_code == 200
    assert put_response.json()["id"] == "sample-tech-zh"
    assert put_response.json()["plain_text_snapshot"] == "张三"
    assert put_response.json()["updated_at"]

    get_response = client.get("/template-samples/sample-tech-zh")

    assert get_response.status_code == 200
    assert get_response.json()["id"] == "sample-tech-zh"
    assert get_response.json()["plain_text_snapshot"] == "张三"


def test_style_config_rejects_blocklisted_class(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.put(
        "/template-styles/classic-a4",
        json={
            "template_id": "classic-a4",
            "slots": {
                "page": {
                    "label": {"zh-CN": "页面", "en-US": "Page"},
                    "class_name": "bg-white fixed",
                    "allowed_class_groups": ["page-background"],
                }
            },
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["class_name"] == "fixed"


@pytest.mark.parametrize(
    "slot_payload",
    [
        {"label": {"zh-CN": "Page", "en-US": "Page"}},
        {"label": {"zh-CN": "Page", "en-US": "Page"}, "class_name": ""},
    ],
)
def test_style_config_rejects_missing_or_empty_class_name(tmp_path, monkeypatch, slot_payload):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.put(
        "/template-styles/classic-a4",
        json={"template_id": "classic-a4", "slots": {"page": slot_payload}},
    )

    assert response.status_code == 422


def test_style_config_rejects_empty_localized_label(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.put(
        "/template-styles/classic-a4",
        json={
            "template_id": "classic-a4",
            "slots": {
                "page": {
                    "label": {"zh-CN": "", "en-US": "Page"},
                    "class_name": "bg-white",
                }
            },
        },
    )

    assert response.status_code == 422


def test_pdf_class_policy_rejects_empty_class(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.put(
        "/pdf-class-policy",
        json={"allowlist": ["bg-white", ""], "blocklist": ["fixed"], "groups": {}},
    )

    assert response.status_code == 422


def test_pdf_class_policy_round_trip_with_group_default_blocklist(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    payload = {
        "allowlist": ["bg-white", "text-slate-900"],
        "blocklist": ["fixed"],
        "groups": {
            "text-color": {
                "label": {"zh-CN": "文字颜色", "en-US": "Text color"},
                "allowlist": ["text-slate-900"],
            }
        },
    }

    put_response = client.put("/pdf-class-policy", json=payload)

    assert put_response.status_code == 200
    assert put_response.json()["allowlist"] == ["bg-white", "text-slate-900"]
    assert put_response.json()["groups"]["text-color"]["blocklist"] == []

    get_response = client.get("/pdf-class-policy")

    assert get_response.status_code == 200
    assert get_response.json()["blocklist"] == ["fixed"]
    assert get_response.json()["groups"]["text-color"]["blocklist"] == []
