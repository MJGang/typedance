from pathlib import Path

from fastapi.testclient import TestClient

from typedance_sidecar.main import app


def test_export_pdf_creates_file(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)
    created = client.post(
        "/resume-versions",
        json={
            "title": "Backend Engineer",
            "target_language": "en-US",
            "plain_text_snapshot": "Built reliable PDF export."
        },
    ).json()

    response = client.post(f"/exports/pdf/{created['id']}")

    assert response.status_code == 201
    pdf_path = Path(response.json()["file_path"])
    assert pdf_path.exists()
    assert pdf_path.suffix == ".pdf"
    assert pdf_path.stat().st_size > 0
