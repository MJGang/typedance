from pathlib import Path

from fastapi.testclient import TestClient

from typedance_sidecar import main as sidecar_main
from typedance_sidecar.main import app
from typedance_sidecar.models import ResumeVersionCreate, ResumeVersion, TemplateStyleConfig
from typedance_sidecar.pdf import render_resume_html, resume_lines_for_pdf


def test_render_and_export_pdf_writes_pdf_file(tmp_path, mock_playwright):
    """render_and_export_pdf 生成 HTML → 调用 Playwright → 写入 PDF 文件"""
    from typedance_sidecar.models import ResumeVersion
    from typedance_sidecar.pdf import render_and_export_pdf

    resume = ResumeVersion(
        id="test-pdf-write",
        title="Test",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={"type": "doc", "content": []},
        plain_text_snapshot="Hello World",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    pdf_path = tmp_path / "output.pdf"

    result = render_and_export_pdf(resume, None, pdf_path)

    assert result == pdf_path
    assert pdf_path.exists()

    # verify Playwright was called correctly
    mock_page = mock_playwright
    mock_page.set_content.assert_called_once()
    call_args, _ = mock_page.set_content.call_args
    assert "Hello World" in call_args[0]
    mock_page.pdf.assert_called_once_with(path=str(pdf_path), format="A4", print_background=True)
    mock_page.close.assert_called_once()


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
    from typedance_sidecar import main as sidecar_main

    def fake_render_and_export_pdf(resume, template_style, output_path):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"%PDF-1.4\n")
        return output_path

    monkeypatch.setattr(sidecar_main, "render_and_export_pdf", fake_render_and_export_pdf)
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

    def fake_render_and_export_pdf(resume, template_style, output_path):
        captured["template_id"] = template_style.template_id if template_style else None
        if template_style and template_style.blocks and "heading1" in template_style.blocks:
            captured["heading1_size"] = template_style.blocks["heading1"].font_size
        else:
            captured["heading1_size"] = None
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"%PDF-1.4\n")
        return output_path

    monkeypatch.setattr(sidecar_main, "render_and_export_pdf", fake_render_and_export_pdf)
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


def test_export_pdf_returns_pdf_download(tmp_path, monkeypatch, mock_playwright):
    """POST /exports/pdf/{id} 返回 200 + PDF 附件下载"""
    from pathlib import Path

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

    # mock 让 Playwright 写入一个伪 PDF 文件
    def fake_pdf_side_effect(**kwargs):
        path = kwargs.get("path")
        if path:
            Path(path).write_bytes(b"%PDF-1.4\n")

    mock_page = mock_playwright
    mock_page.pdf.side_effect = fake_pdf_side_effect

    response = client.post(f"/exports/pdf/{created['id']}")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "attachment" in response.headers["content-disposition"]
