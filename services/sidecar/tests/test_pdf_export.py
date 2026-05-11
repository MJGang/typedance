from pathlib import Path

from fastapi.testclient import TestClient

from typedance_sidecar import main as sidecar_main
from typedance_sidecar.main import app
from typedance_sidecar.models import ResumeVersionCreate, ResumeVersion, TemplateStyleConfig
from typedance_sidecar.pdf import _write_fpdf_fallback, render_resume_html, resume_lines_for_pdf


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
    assert preview_response.headers["content-disposition"].startswith("inline;")


def test_rendered_html_applies_template_library_style():
    resume = ResumeVersion.new(
        ResumeVersionCreate(
            title="Template Styled Resume",
            target_language="en-US",
            template_id="classic-a4",
            doc_json={
                "type": "doc",
                "content": [
                    {
                        "type": "heading",
                        "attrs": {"level": 1},
                        "content": [{"type": "text", "text": "Ada Lovelace"}],
                    }
                ],
            },
        )
    )
    style = TemplateStyleConfig.model_validate(
        {
            "template_id": "classic-a4",
            "slots": {
                "page": {
                    "label": {"zh-CN": "页面", "en-US": "Page"},
                    "class_name": "bg-white text-slate-900 font-sans",
                },
                "header": {
                    "label": {"zh-CN": "页首", "en-US": "Header"},
                    "class_name": "text-blue-800 border-b-2 border-blue-800 pb-3 mb-4",
                },
            },
        }
    )

    html = render_resume_html(resume, style)

    assert '<body class="td-resume-page">' in html
    assert ".td-resume-page h1" in html
    assert "color: #1e40af;" in html
    assert "border-bottom-color: #1e40af;" in html
    assert "padding-bottom: 9pt;" in html


def test_save_preview_uses_saved_template_style(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    captured: dict[str, str | None] = {}

    def fake_export_resume_pdf(resume, exports_dir, template_style=None):
        captured["template_id"] = template_style.template_id if template_style else None
        captured["header_class"] = template_style.slots["header"].class_name if template_style else None
        exports_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = exports_dir / f"{resume.id}.pdf"
        pdf_path.write_bytes(b"%PDF-1.4\n")
        return pdf_path

    monkeypatch.setattr(sidecar_main, "export_resume_pdf", fake_export_resume_pdf)
    client = TestClient(app)
    style_response = client.put(
        "/template-styles/classic-a4",
        json={
            "template_id": "classic-a4",
            "slots": {
                "header": {
                    "label": {"zh-CN": "页首", "en-US": "Header"},
                    "class_name": "text-blue-800 border-b-2 border-blue-800 pb-3 mb-4",
                }
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
        "header_class": "text-blue-800 border-b-2 border-blue-800 pb-3 mb-4",
    }


def test_fpdf_fallback_output_changes_with_template_style(tmp_path):
    resume = ResumeVersion.new(
        ResumeVersionCreate(
            title="Fallback Styled Resume",
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
                        "type": "paragraph",
                        "content": [{"type": "text", "text": "Designed computation notes"}],
                    },
                ],
            },
        )
    )
    plain_path = tmp_path / "plain.pdf"
    styled_path = tmp_path / "styled.pdf"
    style = TemplateStyleConfig.model_validate(
        {
            "template_id": "classic-a4",
            "slots": {
                "page": {
                    "label": {"zh-CN": "页面", "en-US": "Page"},
                    "class_name": "text-slate-700 font-sans",
                },
                "header": {
                    "label": {"zh-CN": "页首", "en-US": "Header"},
                    "class_name": "text-blue-800 border-b-2 border-blue-800 pb-3 mb-4",
                },
            },
        }
    )

    _write_fpdf_fallback(resume, plain_path)
    _write_fpdf_fallback(resume, styled_path, style)

    plain_bytes = plain_path.read_bytes()
    styled_bytes = styled_path.read_bytes()
    assert plain_bytes != styled_bytes
    assert b"0.1176 0.251 0.6863 rg" in styled_bytes
    assert b"0.1176 0.251 0.6863 RG" in styled_bytes


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
