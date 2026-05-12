from pathlib import Path

from fastapi.testclient import TestClient

from typedance_sidecar import main as sidecar_main
from typedance_sidecar.main import app
from typedance_sidecar.models import ResumeVersionCreate, ResumeVersion, TemplateStyleConfig
from typedance_sidecar.pdf import render_resume_html, resume_lines_for_pdf


def fake_pdf(resume, exports_dir, template_style=None) -> Path:
    """Write a minimal valid PDF to satisfy endpoint tests without WeasyPrint."""
    exports_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = exports_dir / f"{resume.id}.pdf"
    pdf_path.write_bytes(b"%PDF-1.4\n")
    return pdf_path



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
    monkeypatch.setattr(sidecar_main, "export_resume_pdf", fake_pdf)
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
    assert preview_response.headers["content-disposition"].startswith("inline;")


def test_rendered_html_applies_template_block_style():
    """RenderResumeHTML applies BlockStyle-based CSS rules"""
    from typedance_sidecar.pdf import render_resume_html
    from typedance_sidecar.models import ResumeVersion, TemplateStyleConfig

    resume = ResumeVersion(
        id="test-render-style",
        title="Test",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={"type": "doc", "content": []},
        plain_text_snapshot="Hello\nWorld",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    style = TemplateStyleConfig(
        template_id="classic-a4",
        preset="classic",
        blocks={
            "heading1": {"fontSize": "28pt", "fontWeight": 700, "color": "#1a1a1a", "textAlign": "center"},
            "paragraph": {"fontSize": "10pt", "lineHeight": 1.5, "color": "#334155"},
        },
    )
    html = render_resume_html(resume, template_style=style)
    assert ".td-resume-heading1" in html
    assert "font-size: 28pt;" in html
    assert "color: #1a1a1a;" in html
    assert ".td-resume-paragraph" in html
    assert "line-height: 1.5;" in html
    assert "color: #334155;" in html


def test_save_preview_uses_saved_template_block_style(tmp_path, monkeypatch):
    """PUT template-styles with blocks, then create resume should use that style"""
    captured: dict[str, object] = {}
    from typedance_sidecar import main as sidecar_main

    def fake_export_resume_pdf(resume, exports_dir, template_style=None):
        captured["template_id"] = template_style.template_id if template_style else None
        if template_style and template_style.blocks and "heading1" in template_style.blocks:
            captured["heading1_size"] = template_style.blocks["heading1"].font_size
        else:
            captured["heading1_size"] = None
        exports_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = exports_dir / f"{resume.id}.pdf"
        pdf_path.write_bytes(b"%PDF-1.4\n")
        return pdf_path

    monkeypatch.setattr(sidecar_main, "export_resume_pdf", fake_export_resume_pdf)
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    style_response = client.put(
        "/template-styles/classic-a4",
        json={
            "template_id": "classic-a4",
            "preset": "classic",
            "blocks": {
                "heading1": {"fontSize": "28pt", "fontWeight": 700, "color": "#1a1a1a"},
                "paragraph": {"fontSize": "10pt", "lineHeight": 1.5, "color": "#334155"},
            },
        },
    )
    assert style_response.status_code == 200

    response = client.post(
        "/resume-versions",
        json={
            "title": "Backend Engineer",
            "target_language": "en-US",
            "template_id": "classic-a4",
            "plain_text_snapshot": "Built reliable PDF export.",
        },
    )

    assert response.status_code == 201
    assert captured == {
        "template_id": "classic-a4",
        "heading1_size": "28pt",
    }


def test_export_pdf_reuses_preview_pdf(tmp_path, monkeypatch):
    monkeypatch.setattr(sidecar_main, "export_resume_pdf", fake_pdf)
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
