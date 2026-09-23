"""
Render resume HTML with template styles and export to PDF via Playwright.

HTML rendering functions generate styled HTML from TipTap JSON content;
PDF conversion is handled by Playwright (Chromium headless).
"""

from __future__ import annotations

import math
import os
import threading
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

from .models import Heading2DecorationStyle, ResumeVersion, TemplateStyleConfig
from .style_renderer import generate_template_css


# Default A4 page padding mirrors the editor's default page margins.
PDF_PAGE_MARGIN = {"top": "86px", "bottom": "86px", "left": "50px", "right": "50px"}
# Playwright must not add another margin layer when the HTML provides @page margins.
PDF_PRINT_MARGIN = {"top": "0", "bottom": "0", "left": "0", "right": "0"}
PdfPageMargin = dict[str, str]
MIN_COLUMN_WIDTH_PERCENT = 15


def _resolve_browser_config() -> dict:
    """杩斿洖浼犵粰 playwright.chromium.launch() 鐨勫弬鏁?

    浼樺厛绾э細
    1. TYPEDANCE_CHROMIUM_PATH 鐜鍙橀噺锛堟墦鍖呮ā寮忥紝鐢?Tauri 璁剧疆锛?
    2. 鍥為€€鍒扮郴缁熸祻瑙堝櫒锛堝紑鍙戞ā寮忥紝浣跨敤宸插畨瑁呯殑 Edge/Chrome锛?
    """
    env_path = os.environ.get("TYPEDANCE_CHROMIUM_PATH")
    if env_path:
        return {"executable_path": env_path}
    return {"channel": "msedge"}


def escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _is_tiptap_node(value: object) -> bool:
    return isinstance(value, dict) and isinstance(value.get("type"), str)


def _equal_column_widths(count: int) -> list[float]:
    width = math.floor(100 / count * 10_000) / 10_000
    widths = [width] * count
    widths[-1] = round(100 - sum(widths[:-1]), 4)
    return widths


def _normalize_column_widths(value: object, count: int) -> list[float]:
    if not isinstance(value, list) or len(value) != count:
        return _equal_column_widths(count)

    try:
        raw_widths = [float(width) for width in value]
    except (TypeError, ValueError):
        return _equal_column_widths(count)
    if any(not math.isfinite(width) or width <= 0 for width in raw_widths):
        return _equal_column_widths(count)

    total = sum(raw_widths)
    if total <= 0:
        return _equal_column_widths(count)
    widths = [round(width / total * 100, 4) for width in raw_widths]
    widths[-1] = round(100 - sum(widths[:-1]), 4)
    if any(width < MIN_COLUMN_WIDTH_PERCENT for width in widths):
        return _equal_column_widths(count)
    return widths


def _format_column_width(width: float) -> str:
    return f"{width:.4f}".rstrip("0").rstrip(".")


def _column_grid_template(widths: list[float]) -> str:
    return " ".join(f"minmax(0, {_format_column_width(width)}fr)" for width in widths)


def _node_text(node: object) -> str:
    if not _is_tiptap_node(node):
        return ""

    if isinstance(node.get("text"), str):
        return node["text"]

    if node.get("type") == "hardBreak":
        return "\n"

    content = node.get("content")
    if not isinstance(content, list):
        return ""

    return "".join(_node_text(child) for child in content)


def _doc_json_lines(doc_json: dict[str, Any]) -> list[str]:
    content = doc_json.get("content")
    if not isinstance(content, list):
        return []

    lines: list[str] = []
    for node in content:
        if not _is_tiptap_node(node):
            continue

        if node.get("type") in {"bulletList", "orderedList"}:
            list_items = node.get("content")
            if not isinstance(list_items, list):
                continue
            for item in list_items:
                text = _node_text(item).strip()
                if text:
                    lines.append(text)
            continue

        text = _node_text(node).strip()
        if text:
            lines.append(text)

    return lines


def resume_lines_for_pdf(resume: ResumeVersion) -> list[str]:
    lines = _doc_json_lines(resume.doc_json)
    if lines:
        return lines

    return [line.strip() for line in resume.plain_text_snapshot.splitlines() if line.strip()]


def _render_marks(text: str, marks: list[dict[str, Any]] | None) -> str:
    rendered = escape_html(text)
    for mark in marks or []:
        if mark.get("type") == "bold":
            rendered = f"<strong>{rendered}</strong>"
        elif mark.get("type") == "italic":
            rendered = f"<em>{rendered}</em>"
        elif mark.get("type") == "underline":
            rendered = f"<u>{rendered}</u>"
        elif mark.get("type") == "inlineStyle":
            style = _inline_style_css(mark.get("attrs"))
            if style:
                rendered = f'<span data-td-inline-style style="{escape_html(style)}">{rendered}</span>'
    return rendered


def _inline_style_css(attrs: object) -> str:
    if not isinstance(attrs, dict):
        return ""

    rules: list[str] = []
    font_size = attrs.get("fontSize")
    if isinstance(font_size, str) and font_size.endswith("px"):
        rules.append(f"font-size: {font_size}")

    color = attrs.get("color")
    if isinstance(color, str) and _is_hex_color(color):
        rules.append(f"color: {color}")

    background_color = attrs.get("backgroundColor")
    if isinstance(background_color, str) and _is_hex_color(background_color):
        rules.append(f"background-color: {background_color}")

    return "; ".join(rules)


def _block_style_css(attrs: object) -> str:
    if not isinstance(attrs, dict):
        return ""

    rules: list[str] = []
    text_align = attrs.get("textAlign")
    if text_align in {"left", "center", "right", "justify"}:
        rules.append(f"text-align: {text_align}")

    line_height = attrs.get("lineHeight")
    if isinstance(line_height, str) and line_height != "default":
        rules.append(f"line-height: {line_height}")

    indent = attrs.get("indent")
    if isinstance(indent, int | float) and indent > 0:
        rules.append(f"margin-left: {indent * 1.5:g}em")

    return "; ".join(rules)


def _list_style_css(attrs: object) -> str:
    if not isinstance(attrs, dict):
        return ""

    list_style_type = attrs.get("listStyleType")
    if list_style_type == "dash":
        return "list-style-type: '-  '"
    if list_style_type == "circle":
        return "list-style-type: circle"
    if list_style_type == "lower-alpha":
        return "list-style-type: lower-alpha"
    if list_style_type == "decimal-nested":
        return "list-style-type: decimal"
    return ""


def _style_attr(style: str) -> str:
    return f' style="{escape_html(style)};"' if style else ""


def _is_hex_color(value: str) -> bool:
    if len(value) != 7 or not value.startswith("#"):
        return False
    return all(char in "0123456789abcdefABCDEF" for char in value[1:])


def _block_class(node: Any) -> str:
    """Map a TipTap node to its td-resume-* CSS class name."""
    node_type = node.get("type")
    if node_type == "heading":
        attrs = node.get("attrs")
        raw_level = attrs.get("level") if isinstance(attrs, dict) else 2
        level = raw_level if isinstance(raw_level, int) and 1 <= raw_level <= 3 else 2
        return f'td-resume-heading{level}'
    if node_type == "paragraph":
        return "td-resume-paragraph"
    if node_type == "bulletList":
        return "td-resume-bulletList"
    if node_type == "orderedList":
        return "td-resume-orderedList"
    if node_type == "listItem":
        return "td-resume-paragraph"
    return ""


def _render_inline(node: object) -> str:
    if not _is_tiptap_node(node):
        return ""

    if isinstance(node.get("text"), str):
        marks = node.get("marks")
        return _render_marks(node["text"], marks if isinstance(marks, list) else None)

    if node.get("type") == "hardBreak":
        return "<br>"

    content = node.get("content")
    if not isinstance(content, list):
        return ""

    return "".join(_render_inline(child) for child in content)


def _render_block(
    node: object,
    parent_list_class: str | None = None,
    heading2_style: Heading2DecorationStyle = "minimal-line",
) -> str:
    if not _is_tiptap_node(node):
        return ""

    content = node.get("content")
    children = content if isinstance(content, list) else []
    node_type = node.get("type")

    if node_type == "columns":
        attrs = node.get("attrs")
        count = attrs.get("count") if isinstance(attrs, dict) else 2
        gap = attrs.get("gap") if isinstance(attrs, dict) else "default"
        widths = attrs.get("widths") if isinstance(attrs, dict) else None
        safe_count = count if isinstance(count, int) and count in {2, 3, 4, 5, 6} else 2
        safe_gap = gap if isinstance(gap, str) and gap in {"default", "compact", "wide"} else "default"
        safe_gap = escape_html(safe_gap)
        safe_widths = _normalize_column_widths(widths, safe_count)
        serialized_widths = ",".join(_format_column_width(width) for width in safe_widths)
        grid_template = _column_grid_template(safe_widths)
        columns = "\n".join(_render_block(child, heading2_style=heading2_style) for child in children)
        return (
            f'<div class="td-columns" data-count="{safe_count}" data-gap="{safe_gap}" '
            f'data-widths="{serialized_widths}" style="grid-template-columns: {grid_template}">'
            f"{columns}</div>"
            if columns
            else ""
        )

    if node_type == "column":
        body = "\n".join(_render_block(child, heading2_style=heading2_style) for child in children)
        return f"<div class=\"td-column\">{body}</div>"

    if node_type == "horizontalRule":
        return '<hr class="td-resume-divider">'

    if node_type == "heading":
        attrs = node.get("attrs")
        raw_level = attrs.get("level") if isinstance(attrs, dict) else 2
        level = raw_level if isinstance(raw_level, int) and 1 <= raw_level <= 3 else 2
        cls = _block_class(node)
        style = _block_style_css(attrs)
        body = "".join(_render_inline(child) for child in children)
        if level == 2:
            return (
                f'<h2 class="{cls}" data-heading-style="{heading2_style}"{_style_attr(style)}>'
                '<span class="td-heading-prefix" aria-hidden="true"></span>'
                f'<span class="td-heading-content">{body}</span>'
                '<span class="td-heading-suffix" aria-hidden="true"></span>'
                "</h2>"
            )
        return f"<h{level} class=\"{cls}\"{_style_attr(style)}>{body}</h{level}>"

    if node_type == "paragraph":
        cls = _block_class(node)
        body = "".join(_render_inline(child) for child in children)
        style = _block_style_css(node.get("attrs"))
        return f"<p class=\"{cls}\"{_style_attr(style)}>{body}</p>" if body else ""

    if node_type in {"bulletList", "orderedList"}:
        cls = _block_class(node)
        tag = "ol" if node_type == "orderedList" else "ul"
        style = _list_style_css(node.get("attrs"))
        items = "\n".join(_render_block(child, cls, heading2_style) for child in children)
        return f"<{tag} class=\"{cls}\"{_style_attr(style)}>{items}</{tag}>" if items else ""

    if node_type == "listItem":
        cls = parent_list_class or _block_class(node)
        body = "".join(
            (
                f"<p class=\"td-resume-paragraph {cls}Text\"{_style_attr(_block_style_css(child.get('attrs')))}>{_render_inline(child)}</p>"
                if _is_tiptap_node(child) and child.get("type") == "paragraph"
                else _render_block(child, heading2_style=heading2_style)
            )
            for child in children
        )
        return f"<li class=\"{cls}Item\">{body}</li>" if body else ""

    body = "".join(_render_inline(child) for child in children)
    return f"<p class=\"td-resume-paragraph\">{body}</p>" if body else ""


def _render_doc_body(resume: ResumeVersion, template_style: TemplateStyleConfig | None) -> str:
    heading2_style = (
        template_style.blocks.heading2.decoration_style
        if template_style is not None
        else "minimal-line"
    )
    content = resume.doc_json.get("content")
    if isinstance(content, list):
        body = "\n".join(
            block
            for block in (_render_block(node, heading2_style=heading2_style) for node in content)
            if block
        )
        if body:
            return body

    lines = resume_lines_for_pdf(resume)
    if not lines:
        return '<p class="muted">Start writing your resume.</p>'

    return "\n".join(f"<p>{escape_html(line)}</p>" for line in lines)


def _render_template_style_css(template_style: TemplateStyleConfig | None) -> str:
    if template_style is None:
        return ""
    return generate_template_css(template_style)


def _normalized_page_margin(page_margin: PdfPageMargin | None) -> PdfPageMargin:
    return page_margin or PDF_PAGE_MARGIN


def _render_export_page_css(page_margin: PdfPageMargin | None) -> str:
    page_margin = _normalized_page_margin(page_margin)
    top = page_margin["top"]
    right = page_margin["right"]
    bottom = page_margin["bottom"]
    left = page_margin["left"]
    return f"""
body.td-export-document {{
  margin: 0;
  background: #f4f1ea;
}}
.td-export-content {{
  box-sizing: border-box;
  width: 794px;
  min-height: 1123px;
  margin: 24px auto;
  padding: {top} {right} {bottom} {left};
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 12px 32px rgba(15, 23, 42, 0.14);
}}
@media screen {{
  html {{
    background: #f4f1ea;
  }}
}}
@media print {{
  @page {{
    size: A4;
    margin: {top} {right} {bottom} {left};
  }}
  html,
  body.td-export-document {{
    background: #ffffff;
  }}
  .td-export-content {{
    width: auto;
    min-height: 0;
    margin: 0;
    padding: 0;
    background: transparent;
    box-shadow: none;
  }}
}}
"""


LAYOUT_CSS = """
body.td-resume-page {
  margin: 0;
}
:where(.td-resume-page h1, .td-resume-page h2, .td-resume-page h3, .td-resume-page p, .td-resume-page ul, .td-resume-page ol) {
  margin: 0;
}
:where(.td-resume-page ul, .td-resume-page ol) {
  padding-left: 0;
}
:where(.td-resume-page p, .td-resume-page li, .td-resume-page li p) {
  orphans: 1;
  widows: 1;
  break-inside: auto;
  page-break-inside: auto;
}
.td-columns {
  display: grid;
  align-items: stretch;
  gap: 10px;
  margin: 0 0 8px;
}
.td-columns[data-count="2"] {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.td-columns[data-count="3"] {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.td-columns[data-count="4"] {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.td-columns[data-count="5"] {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
.td-columns[data-count="6"] {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
.td-columns[data-gap="compact"] {
  gap: 6px;
}
.td-columns[data-gap="wide"] {
  gap: 16px;
}
.td-column {
  min-width: 0;
  min-height: 24px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-block: 3px;
}
.td-columns .td-column > :last-child {
  margin-bottom: 0;
}
.td-resume-divider {
  border: 0;
  border-top: 1px solid #d1d5db;
  margin: 8px 0;
}
"""


def render_resume_html(
    resume: ResumeVersion,
    template_style: TemplateStyleConfig | None = None,
    html_page_margin: PdfPageMargin | None = None,
) -> str:
    template_style_css = _render_template_style_css(template_style)
    export_page_css = _render_export_page_css(html_page_margin)
    doc_body = _render_doc_body(resume, template_style)
    return f"""<!doctype html>
<html lang="{resume.target_language}">
  <head>
    <meta charset="utf-8">
    <style>
      {template_style_css}
      {LAYOUT_CSS}
      {export_page_css}
    </style>
  </head>
  <body class="td-resume-page td-export-document" data-td-natural-print>
    <main class="td-export-content">
      {doc_body}
    </main>
  </body>
</html>"""


def _pdf_margin_for_html(html: str, page_margin: PdfPageMargin | None) -> PdfPageMargin:
    if "data-td-natural-print" in html:
        return PDF_PRINT_MARGIN
    return page_margin or PDF_PAGE_MARGIN


_pw = None
_browser = None
_lock = threading.Lock()


def _get_browser():
    """鍏ㄥ眬鍗曚緥锛屽鐢?Chromium 杩涚▼锛堢嚎绋嬪畨鍏級"""
    global _pw, _browser
    if _browser is None:
        with _lock:
            if _browser is None:  # double-checked locking
                _pw = sync_playwright().start()
                config = _resolve_browser_config()
                _browser = _pw.chromium.launch(**config)
    return _browser


def render_and_export_pdf(
    resume: ResumeVersion,
    template_style: TemplateStyleConfig | None,
    output_path: Path,
) -> Path:
    """鐢熸垚 styled HTML 鈫?Playwright 娓叉煋 鈫?PDF 鏂囦欢"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    html = render_resume_html(resume, template_style)
    browser = _get_browser()
    page = browser.new_page()
    try:
        page.set_content(html, wait_until="load")
        page.pdf(
            path=str(output_path),
            format="A4",
            print_background=True,
            prefer_css_page_size=True,
            margin=_pdf_margin_for_html(html, None),
        )
    finally:
        page.close()
    return output_path


def render_html_to_pdf(html: str, output_path: Path, page_margin: PdfPageMargin | None = None) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    browser = _get_browser()
    page = browser.new_page()
    try:
        page.set_content(html, wait_until="load")
        page.pdf(
            path=str(output_path),
            format="A4",
            print_background=True,
            prefer_css_page_size=True,
            margin=_pdf_margin_for_html(html, page_margin),
        )
    finally:
        page.close()
    return output_path


def cleanup_browser():
    """搴旂敤鍏抽棴鏃舵竻鐞?Chromium 杩涚▼"""
    global _browser, _pw
    if _browser:
        _browser.close()
        _browser = None
    if _pw:
        _pw.stop()
        _pw = None
