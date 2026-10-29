from conftest import authenticated_client
from fastapi.testclient import TestClient

from typedance_sidecar.main import app


def test_sidecar_does_not_expose_ai_orchestration_routes(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = authenticated_client(app)

    created_document = client.post(
        "/documents",
        json={
            "title": "AI boundary",
            "pack_id": "resume",
            "target_language": "zh-CN",
        },
    )
    assert created_document.status_code == 201
    document_id = created_document.json()["id"]

    assert client.post(
        f"/documents/{document_id}/revision-runs",
        json={"run_type": "quality_review"},
    ).status_code == 404
    assert client.get("/revision-runs/run_missing").status_code == 404
    assert client.get("/settings/model").status_code == 404
    assert client.put("/settings/model", json={}).status_code == 404
    assert client.delete("/settings/model/api-key").status_code == 404
    assert client.post("/settings/model/test").status_code == 404
