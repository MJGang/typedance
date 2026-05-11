from pathlib import Path

from fastapi.testclient import TestClient

from typedance_sidecar.main import app
from typedance_sidecar.models import ResumeVersionCreate, ResumeVersion
from typedance_sidecar.pdf import resume_lines_for_pdf


def test_pdf_export_uses_doc_json_as_canonical_content():
    resume = ResumeVersion.new(
        ResumeVersionCreate(
            title="Stale API title",
            target_language="en-US",
            doc_json={
                "type": "doc",
                "content": [
                    {
                        "type": "heading",
                        "attrs": {"level": 1},
                        "content": [{"type": "text", "text": "Ada Lovelace"}],
                    },
                    {
                        "type": "bulletList",
                        "content": [
                            {
                                "type": "listItem",
                                "content": [
                                    {
                                        "type": "paragraph",
                                        "content": [{"type": "text", "text": "Designed computation notes"}],
                                    }
                                ],
                            }
                        ],
                    },
                ],
            },
            plain_text_snapshot="Stale snapshot that must not render",
        )
    )

    lines = resume_lines_for_pdf(resume)

    assert "Ada Lovelace" in lines
    assert "Designed computation notes" in lines
    assert "Stale snapshot that must not render" not in lines


def test_save_generates_preview_pdf(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)
    response = client.post(
        "/resume-versions",
        json={
            "title": "Backend Engineer",
            "target_language": "en-US",
            "plain_text_snapshot": "Built reliable PDF export."
        },
    )

    assert response.status_code == 201
    created = response.json()
    preview_path = Path(created["preview_pdf_path"])
    assert preview_path.exists()
    assert preview_path.suffix == ".pdf"
    assert preview_path.stat().st_size > 0
    assert created["preview_pdf_url"].endswith(f"/previews/{created['id']}.pdf")

    preview_response = client.get(created["preview_pdf_url"])
    assert preview_response.status_code == 200
    assert preview_response.headers["content-type"] == "application/pdf"


def test_export_pdf_reuses_preview_pdf(tmp_path, monkeypatch):
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
    assert str(pdf_path) == created["preview_pdf_path"]


def test_export_pdf_with_chinese_content(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)
    created = client.post(
        "/resume-versions",
        json={
            "title": "张三 - 全栈开发工程师简历",
            "target_language": "zh-CN",
            "plain_text_snapshot": "负责 TypeDance 首版简历工作台的产品与工程落地。"
        },
    ).json()

    response = client.post(f"/exports/pdf/{created['id']}")

    assert response.status_code == 201
    pdf_path = Path(response.json()["file_path"])
    assert pdf_path.exists()
    assert pdf_path.suffix == ".pdf"
    assert pdf_path.stat().st_size > 0

    # Verify PDF embeds a CJK font (Microsoft YaHei) confirming Chinese characters render correctly
    raw = pdf_path.read_bytes()
    assert b"MicrosoftYaHei" in raw, "PDF should embed Microsoft YaHei font for Chinese characters"
    assert b"Identity-H" in raw, "PDF should use CID font encoding for CJK"
