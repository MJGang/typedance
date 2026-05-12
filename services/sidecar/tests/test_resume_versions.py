from pathlib import Path

from fastapi.testclient import TestClient

from typedance_sidecar import main as sidecar_main
from typedance_sidecar.main import app


def _fake_pdf(resume, exports_dir, template_style=None) -> Path:
    exports_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = exports_dir / f"{resume.id}.pdf"
    pdf_path.write_bytes(b"%PDF-1.4\n")
    return pdf_path


def test_create_update_and_list_resume_versions(tmp_path, monkeypatch):
    monkeypatch.setattr(sidecar_main, "export_resume_pdf", _fake_pdf)
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
