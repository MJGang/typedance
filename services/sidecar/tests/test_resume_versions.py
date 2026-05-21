from pathlib import Path

from fastapi.testclient import TestClient

from typedance_sidecar import main as sidecar_main
from typedance_sidecar.main import app


def test_create_update_and_list_resume_versions(tmp_path, monkeypatch):
    from typedance_sidecar import main as sidecar_main

    def _fake_render_and_export_pdf(resume, template_style, output_path):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"%PDF-1.4\n")
        return output_path

    monkeypatch.setattr(sidecar_main, "render_and_export_pdf", _fake_render_and_export_pdf)
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.post(
        "/resume-versions",
        json={"title": "Frontend Engineer", "target_language": "en-US"},
    )

    assert response.status_code == 201
    created = response.json()
    assert created["title"] == "Frontend Engineer"
    assert created["target_language"] == "en-US"

    update_response = client.patch(
        f"/resume-versions/{created['id']}",
        json={"plain_text_snapshot": "Built local-first resume tooling."},
    )

    assert update_response.status_code == 200
    assert update_response.json()["plain_text_snapshot"] == "Built local-first resume tooling."

    list_response = client.get("/resume-versions")

    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [created["id"]]

    projection_response = client.post(f"/legacy/resume-versions/{created['id']}/revision-document")

    assert projection_response.status_code == 200
    workspace = projection_response.json()
    assert workspace["document"]["id"] == f"doc_legacy_{created['id']}"
    assert workspace["current_draft"]["id"].startswith(f"draft_legacy_{created['id']}")
    assert workspace["render_projection"]["render_profile"] == "legacy-classic-a4"
    assert "Built local-first resume tooling." in workspace["render_projection"]["html"]
