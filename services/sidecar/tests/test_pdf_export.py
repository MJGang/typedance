from conftest import authenticated_client
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from urllib.parse import unquote

from fixtures.heading2_styles import HEADING2_DOC_JSON, template_style_payload
from typedance_sidecar import main as sidecar_main
from typedance_sidecar.main import app
from typedance_sidecar.models import ResumeVersionCreate, ResumeVersion, TemplateStyleConfig
from typedance_sidecar.pdf import render_resume_html, resume_lines_for_pdf
from typedance_sidecar.style_renderer import mix_hex_with_white


@pytest.mark.parametrize("decoration_style", ["minimal-line", "accent-wash", "dot-ribbon"])
def test_h2_styles_render_three_real_spans_with_marks(decoration_style):
    resume = ResumeVersion(
        id=f"test-h2-{decoration_style}",
        title="H2 styles",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json=HEADING2_DOC_JSON,
        plain_text_snapshot="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    style = TemplateStyleConfig.model_validate(template_style_payload(decoration_style))

    html = render_resume_html(resume, style)

    assert f'data-heading-style="{decoration_style}"' in html
    assert '<span class="td-heading-prefix" aria-hidden="true"></span>' in html
    assert '<span class="td-heading-content"><strong>教育</strong>' in html
    assert '<span data-td-inline-style style="color: #123456; background-color: #fedcba"><u>经历</u></span>' in html
    assert '<span class="td-heading-suffix" aria-hidden="true"></span>' in html
    assert html.count('class="td-heading-prefix"') == 1
    assert html.count('class="td-heading-content"') == 1
    assert html.count('class="td-heading-suffix"') == 1
    assert "::before" not in html
    assert "::after" not in html
    assert "break-after: avoid" in html
    assert "break-inside: avoid" in html


@pytest.mark.parametrize(
    ("color", "expected"),
    [("#174EA6", "#e3eaf4"), ("#174ea6", "#e3eaf4"), ("#000000", "#e0e0e0"), ("#FFFFFF", "#ffffff")],
)
def test_mix_hex_with_white_matches_typescript_rounding(color, expected):
    assert mix_hex_with_white(color) == expected


def test_accent_wash_uses_print_safe_explicit_span_dimensions():
    style = TemplateStyleConfig.model_validate(template_style_payload("accent-wash"))
    resume = ResumeVersion(
        id="test-accent-wash-print-layout",
        title="H2 print layout",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json=HEADING2_DOC_JSON,
        plain_text_snapshot="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    html = render_resume_html(resume, style)

    assert "position: relative;\n  isolation: isolate;\n  z-index: 0;\n  break-after: avoid;" in html
    assert "height: calc(100% - 8px);" in html
    assert "width: 100%;" in html
    assert "height: 100%;" in html
    assert "inset: 0;" not in html


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
    mock_page.pdf.assert_called_once_with(
        path=str(pdf_path),
        format="A4",
        print_background=True,
        prefer_css_page_size=True,
        margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
    )
    mock_page.wait_for_function.assert_not_called()
    mock_page.close.assert_called_once()


def test_render_html_to_pdf_writes_projection_html(tmp_path, mock_playwright):
    from typedance_sidecar.pdf import render_html_to_pdf

    pdf_path = tmp_path / "revision-output.pdf"

    result = render_html_to_pdf("<article>结构化草稿</article>", pdf_path)

    assert result == pdf_path
    assert pdf_path.exists()
    mock_page = mock_playwright
    mock_page.set_content.assert_called_once_with("<article>结构化草稿</article>", wait_until="load")
    mock_page.wait_for_function.assert_not_called()
    mock_page.pdf.assert_called_once_with(
        path=str(pdf_path),
        format="A4",
        print_background=True,
        prefer_css_page_size=True,
        margin={"top": "86px", "bottom": "86px", "left": "50px", "right": "50px"},
    )
    mock_page.close.assert_called_once()


def test_rendered_html_resets_browser_default_body_margin():
    resume = ResumeVersion(
        id="test-pdf-margin",
        title="Test",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={"type": "doc", "content": []},
        plain_text_snapshot="Hello World",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    html = render_resume_html(resume)

    assert "body.td-resume-page" in html
    assert "margin: 0;" in html


def test_rendered_html_uses_natural_print_pagination_with_page_margins():
    resume = ResumeVersion(
        id="test-html-a4-pages",
        title="Test",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={"type": "doc", "content": []},
        plain_text_snapshot="Hello World",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    html = render_resume_html(
        resume,
        html_page_margin={"top": "88px", "bottom": "72px", "left": "42px", "right": "48px"},
    )

    assert '<body class="td-resume-page td-export-document" data-td-natural-print>' in html
    assert '<main class="td-export-content">' in html
    assert "data-td-export-pages" not in html
    assert "<script>" not in html
    assert "width: 794px;" in html
    assert "min-height: 1123px;" in html
    assert "padding: 88px 48px 72px 42px;" in html
    assert "@page {\n    size: A4;\n    margin: 88px 48px 72px 42px;" in html


def test_rendered_html_resets_browser_default_block_spacing():
    resume = ResumeVersion(
        id="test-block-reset",
        title="Reset",
        target_language="en-US",
        template_id="classic-a4",
        doc_json={
            "type": "doc",
            "content": [
                {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Name"}]},
                {"type": "paragraph", "content": [{"type": "text", "text": "Intro"}]},
            ],
        },
        plain_text_snapshot="",
        created_at="2026-05-18T00:00:00.000Z",
        updated_at="2026-05-18T00:00:00.000Z",
    )

    html = render_resume_html(resume)

    assert ":where(.td-resume-page h1" in html
    assert ".td-resume-page p" in html
    assert ".td-resume-page ul" in html
    assert "padding-left: 0;" in html


def test_export_layout_matches_editor_box_sizing_and_list_item_typography():
    resume = ResumeVersion(
        id="test-editor-layout-parity",
        title="Layout parity",
        target_language="zh-CN",
        template_id="classic-a4",
        doc_json={"type": "doc", "content": []},
        plain_text_snapshot="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    payload = template_style_payload()
    payload["blocks"]["bulletList"] = {"fontSize": "12px", "lineHeight": 1.5}
    payload["blocks"]["orderedList"] = {"fontSize": "12px", "lineHeight": 1.5}

    html = render_resume_html(resume, TemplateStyleConfig.model_validate(payload))

    assert "body.td-resume-page,\nbody.td-resume-page * {\n  box-sizing: border-box;" in html
    assert ".td-resume-bulletListItem, .td-resume-bulletListText {\n  font-size: 12px;\n  line-height: 1.5;" in html
    assert ".td-resume-orderedListItem, .td-resume-orderedListText {\n  font-size: 12px;\n  line-height: 1.5;" in html
    assert ".td-resume-page li > ol,\n.td-resume-page li > ul {\n  break-inside: avoid;" in html


@pytest.mark.parametrize("container", ["paragraph", "heading1", "heading2", "heading3", "bulletList", "orderedList", "column"])
@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ([], "<br>"),
        ([{"type": "hardBreak"}], "<br><br>"),
        ([{"type": "text", "text": "Before"}, {"type": "hardBreak"}], "Before<br><br>"),
        ([{"type": "text", "text": "Before"}, {"type": "hardBreak"}, {"type": "text", "text": "After"}], "Before<br>After"),
    ],
)
def test_export_preserves_empty_and_trailing_text_lines(container, content, expected):
    text_block = {"type": "paragraph", "content": content}
    if container.startswith("heading"):
        text_block = {"type": "heading", "attrs": {"level": int(container[-1])}, "content": content}
        node = text_block
    elif container in {"bulletList", "orderedList"}:
        node = {"type": container, "content": [{"type": "listItem", "content": [text_block]}]}
    elif container == "column":
        node = {"type": "columns", "content": [{"type": "column", "content": [text_block]}]}
    else:
        node = text_block
    resume = ResumeVersion.new(ResumeVersionCreate(
        title="Blank line layout",
        target_language="en-US",
        template_id="classic-a4",
        doc_json={"type": "doc", "content": [node]},
        plain_text_snapshot="",
    ))

    html = render_resume_html(resume)

    closing_tag = "span" if container == "heading2" else (f"h{container[-1]}" if container.startswith("heading") else "p")
    assert f">{expected}</{closing_tag}>" in html


def test_rendered_html_allows_paragraph_lines_to_split_across_print_pages():
    resume = ResumeVersion(
        id="test-print-line-fragmentation",
        title="Print",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={
            "type": "doc",
            "content": [
                {
                    "type": "bulletList",
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "跨页多行列表项"}],
                                }
                            ],
                        }
                    ],
                }
            ],
        },
        plain_text_snapshot="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    html = render_resume_html(resume)

    assert ":where(.td-resume-page p, .td-resume-page li, .td-resume-page li p)" in html
    assert "orphans: 1;" in html
    assert "widows: 1;" in html
    assert "break-inside: auto;" in html
    assert "page-break-inside: auto;" in html


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


def test_rendered_ordered_list_items_keep_ordered_list_class():
    resume = ResumeVersion(
        id="test-ordered-list",
        title="Test",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={
            "type": "doc",
            "content": [
                {
                    "type": "orderedList",
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "负责简历工作台闭环体验"}],
                                }
                            ],
                        }
                    ],
                }
            ],
        },
        plain_text_snapshot="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    html = render_resume_html(resume)

    assert '<ol class="td-resume-orderedList">' in html
    assert '<li class="td-resume-orderedListItem"><p class="td-resume-paragraph td-resume-orderedListText">负责简历工作台闭环体验</p></li>' in html


def test_rendered_inline_style_marks_are_preserved():
    resume = ResumeVersion(
        id="test-inline-style-mark",
        title="Test",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "text": "普通文本 "},
                        {
                            "type": "text",
                            "text": "重点",
                            "marks": [
                                {
                                    "type": "inlineStyle",
                                    "attrs": {"fontSize": "12px", "color": "#174ea6"},
                                }
                            ],
                        },
                    ],
                }
            ],
        },
        plain_text_snapshot="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    html = render_resume_html(resume)

    assert '<span data-td-inline-style style="font-size: 12px; color: #174ea6">重点</span>' in html


def test_rendered_doc_node_styles_match_editor_toolbar_attrs():
    resume = ResumeVersion(
        id="test-editor-toolbar-attrs",
        title="Test",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "attrs": {"textAlign": "center", "lineHeight": "1.5", "indent": 2},
                    "content": [
                        {
                            "type": "text",
                            "text": "带下划线文本",
                            "marks": [{"type": "underline"}],
                        }
                    ],
                },
                {"type": "horizontalRule"},
                {
                    "type": "bulletList",
                    "attrs": {"listStyleType": "circle"},
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "attrs": {"textAlign": "right"},
                                    "content": [{"type": "text", "text": "无序列表"}],
                                }
                            ],
                        }
                    ],
                },
                {
                    "type": "orderedList",
                    "attrs": {"listStyleType": "lower-alpha"},
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "有序列表"}],
                                }
                            ],
                        }
                    ],
                },
            ],
        },
        plain_text_snapshot="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    html = render_resume_html(resume)

    assert '<p class="td-resume-paragraph" style="text-align: center; line-height: 1.5; margin-left: 3em;"><u>带下划线文本</u></p>' in html
    assert '<hr class="td-resume-divider">' in html
    assert '<ul class="td-resume-bulletList" style="list-style-type: circle;">' in html
    assert '<p class="td-resume-paragraph td-resume-bulletListText" style="text-align: right;">无序列表</p>' in html
    assert '<ol class="td-resume-orderedList" style="list-style-type: lower-alpha;">' in html


def test_list_style_css_splits_structure_and_text_overrides():
    payload = template_style_payload()
    payload["blocks"]["paragraph"] = {"fontSize": "10px", "lineHeight": 1.5}
    payload["blocks"]["bulletList"] = {
        "fontSize": "12px",
        "backgroundColor": "#eeeeee",
        "listStyleType": "disc",
        "paddingLeft": "20px",
    }
    style = TemplateStyleConfig.model_validate(payload)
    resume = ResumeVersion(
        id="test-list-style-css",
        title="Test",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={"type": "doc", "content": []},
        plain_text_snapshot="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    html = render_resume_html(resume, style)

    assert ".td-resume-bulletList {\n  list-style-type: disc;\n  padding-left: 20px;\n}" in html
    assert ".td-resume-bulletListText {\n  font-size: 12px;\n  background-color: #eeeeee;\n}" in html


def test_unknown_doc_nodes_fallback_to_styled_paragraph():
    resume = ResumeVersion(
        id="test-unknown-node",
        title="Test",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={
            "type": "doc",
            "content": [
                {
                    "type": "callout",
                    "content": [{"type": "text", "text": "未知块内容"}],
                }
            ],
        },
        plain_text_snapshot="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    html = render_resume_html(resume)

    assert '<p class="td-resume-paragraph">未知块内容</p>' in html


def test_rendered_columns_sanitize_attrs_like_frontend_renderer():
    resume = ResumeVersion(
        id="test-columns-sanitize",
        title="Test",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={
            "type": "doc",
            "content": [
                {
                    "type": "columns",
                    "attrs": {"count": 9, "gap": "unexpected"},
                    "content": [
                        {
                            "type": "column",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "列内容"}],
                                }
                            ],
                        }
                    ],
                }
            ],
        },
        plain_text_snapshot="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    html = render_resume_html(resume)

    assert (
        '<div class="td-columns" data-count="2" data-gap="default" data-widths="50,50" '
        'style="grid-template-columns: minmax(0, 50fr) minmax(0, 50fr)">'
    ) in html
    assert "align-items: stretch;" in html
    assert "justify-content: center;" in html
    assert '.td-columns[data-count="1"]' not in html


def test_rendered_columns_preserve_custom_widths():
    resume = ResumeVersion(
        id="test-columns-widths",
        title="Test",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={
            "type": "doc",
            "content": [
                {
                    "type": "columns",
                    "attrs": {"count": 2, "gap": "wide", "widths": [65, 35]},
                    "content": [
                        {"type": "column", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "左栏"}]}]},
                        {"type": "column", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "右栏"}]}]},
                    ],
                }
            ],
        },
        plain_text_snapshot="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    html = render_resume_html(resume)

    assert 'data-widths="65,35"' in html
    assert 'style="grid-template-columns: minmax(0, 65fr) minmax(0, 35fr)"' in html


def test_rendered_six_columns_preserve_widths_and_order():
    resume = ResumeVersion(
        id="test-six-columns",
        title="Test",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={
            "type": "doc",
            "content": [{
                "type": "columns",
                "attrs": {"count": 6, "gap": "default", "widths": [20, 15, 15, 15, 15, 20]},
                "content": [
                    {"type": "column", "content": [{"type": "paragraph", "content": [{"type": "text", "text": f"第{index}栏"}]}]}
                    for index in range(1, 7)
                ],
            }],
        },
        plain_text_snapshot="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    html = render_resume_html(resume)

    assert 'data-count="6" data-gap="default" data-widths="20,15,15,15,15,20"' in html
    assert 'grid-template-columns: minmax(0, 20fr) minmax(0, 15fr) minmax(0, 15fr) minmax(0, 15fr) minmax(0, 15fr) minmax(0, 20fr)' in html
    assert all(html.index(f"第{index}栏") < html.index(f"第{index + 1}栏") for index in range(1, 6))
    assert '.td-columns[data-count="6"]' in html

    equal_resume = resume.model_copy(deep=True)
    equal_resume.doc_json["content"][0]["attrs"].pop("widths")
    equal_html = render_resume_html(equal_resume)
    assert 'data-widths="16.6666,16.6666,16.6666,16.6666,16.6666,16.667"' in equal_html


def test_save_generates_preview_pdf(tmp_path, monkeypatch):
    from typedance_sidecar import main as sidecar_main

    def fake_render_and_export_pdf(resume, template_style, output_path):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"%PDF-1.4\n")
        return output_path

    monkeypatch.setattr(sidecar_main, "render_and_export_pdf", fake_render_and_export_pdf)
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = authenticated_client(app)

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
    payload = template_style_payload()
    payload["blocks"]["heading1"] = {
        "fontSize": "28px", "fontWeight": 700, "color": "#1a1a1a", "textAlign": "center",
    }
    payload["blocks"]["paragraph"] = {"fontSize": "10px", "lineHeight": 1.5, "color": "#334155"}
    style = TemplateStyleConfig.model_validate(payload)
    html = render_resume_html(resume, template_style=style)
    assert ".td-resume-heading1" in html
    assert "font-size: 28px;" in html
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
        if template_style:
            captured["heading1_size"] = template_style.blocks.heading1.font_size
        else:
            captured["heading1_size"] = None
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"%PDF-1.4\n")
        return output_path

    monkeypatch.setattr(sidecar_main, "render_and_export_pdf", fake_render_and_export_pdf)
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = authenticated_client(app)

    style_response = client.put(
        "/template-styles/classic-a4",
        json=template_style_payload(),
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
        "heading1_size": "28px",
    }


def test_export_pdf_returns_pdf_download(tmp_path, monkeypatch, mock_playwright):
    """POST /exports/pdf/{id} 返回 200 + PDF 附件下载"""

    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = authenticated_client(app)

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

    response = client.post(
        f"/exports/pdf/{created['id']}",
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "attachment" in response.headers["content-disposition"]
    export_path = Path(unquote(response.headers["X-Pdf-Path"]))
    assert export_path.parent.name == "exports"
    assert export_path.name.startswith(f"{created['id']}-")
    assert export_path.suffix == ".pdf"
    assert "X-Pdf-Path" in response.headers["access-control-expose-headers"]
    assert "X-Html-Path" in response.headers["access-control-expose-headers"]


def test_export_pdf_uses_unique_output_path_per_request(tmp_path, monkeypatch, mock_playwright):
    """重复导出同一份简历时使用不同文件，避免 Windows 下已打开 PDF 锁住旧路径。"""

    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = authenticated_client(app)

    created = client.post(
        "/resume-versions",
        json={
            "title": "Backend Engineer",
            "target_language": "en-US",
            "plain_text_snapshot": "Built reliable PDF export.",
        },
    ).json()

    def fake_pdf_side_effect(**kwargs):
        path = kwargs.get("path")
        if path:
            Path(path).write_bytes(b"%PDF-1.4\n")

    mock_page = mock_playwright
    mock_page.pdf.side_effect = fake_pdf_side_effect

    first = client.post(f"/exports/pdf/{created['id']}")
    second = client.post(f"/exports/pdf/{created['id']}")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.headers["X-Pdf-Path"] != second.headers["X-Pdf-Path"]


def test_export_pdf_writes_to_requested_output_path(tmp_path, monkeypatch, mock_playwright):
    """桌面端传入保存路径时，导出文件和 X-Pdf-Path 都指向用户选择的位置。"""
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path / "data"))
    client = authenticated_client(app)

    created = client.post(
        "/resume-versions",
        json={
            "title": "Backend Engineer",
            "target_language": "en-US",
            "plain_text_snapshot": "Built reliable PDF export.",
        },
    ).json()
    requested_path = tmp_path / "Documents" / "custom-resume.pdf"

    def fake_pdf_side_effect(**kwargs):
        path = kwargs.get("path")
        if path:
            Path(path).write_bytes(b"%PDF-1.4\n")

    mock_page = mock_playwright
    mock_page.pdf.side_effect = fake_pdf_side_effect

    response = client.post(
        f"/exports/pdf/{created['id']}",
        json={"output_path": str(requested_path)},
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert requested_path.exists()
    assert Path(unquote(response.headers["X-Pdf-Path"])) == requested_path
    assert 'filename="custom-resume.pdf"' in response.headers["content-disposition"]


def test_export_html_returns_rendered_html_download(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = authenticated_client(app)

    created = client.post(
        "/resume-versions",
        json={
            "title": "Backend Engineer",
            "target_language": "en-US",
            "plain_text_snapshot": "Built reliable HTML export.",
        },
    ).json()

    response = client.post(
        f"/exports/html/{created['id']}",
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "attachment" in response.headers["content-disposition"]
    export_path = Path(unquote(response.headers["X-Html-Path"]))
    assert export_path.parent.name == "exports"
    assert export_path.suffix == ".html"
    assert "Built reliable HTML export." in response.text


def test_export_html_writes_to_requested_output_path(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path / "data"))
    client = authenticated_client(app)

    created = client.post(
        "/resume-versions",
        json={
            "title": "Backend Engineer",
            "target_language": "en-US",
            "plain_text_snapshot": "Built reliable HTML export.",
        },
    ).json()
    requested_path = tmp_path / "Documents" / "custom-resume.html"

    response = client.post(
        f"/exports/html/{created['id']}",
        json={"output_path": str(requested_path)},
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert requested_path.exists()
    assert Path(unquote(response.headers["X-Html-Path"])) == requested_path
    assert "Built reliable HTML export." in requested_path.read_text(encoding="utf-8")
    assert 'filename="custom-resume.html"' in response.headers["content-disposition"]


def test_export_pdf_header_supports_unicode_output_path(tmp_path, monkeypatch, mock_playwright):
    """X-Pdf-Path 使用 URL 编码，避免中文路径触发 latin-1 header 编码错误。"""
    from pathlib import Path

    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path / "data"))
    client = authenticated_client(app)

    created = client.post(
        "/resume-versions",
        json={
            "title": "中文简历",
            "target_language": "zh-CN",
            "plain_text_snapshot": "导出中文路径。",
        },
    ).json()
    requested_path = tmp_path / "文档" / "中文简历.pdf"

    def fake_pdf_side_effect(**kwargs):
        path = kwargs.get("path")
        if path:
            Path(path).write_bytes(b"%PDF-1.4\n")

    mock_page = mock_playwright
    mock_page.pdf.side_effect = fake_pdf_side_effect

    response = client.post(
        f"/exports/pdf/{created['id']}",
        json={"output_path": str(requested_path)},
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert "%E4%B8%AD%E6%96%87" in response.headers["X-Pdf-Path"]
    assert Path(unquote(response.headers["X-Pdf-Path"])) == requested_path
