"""
Render resume HTML with template styles and export to PDF via Playwright.

HTML rendering functions generate styled HTML from TipTap JSON content;
PDF conversion is handled by Playwright (Chromium headless).
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

from .models import ResumeVersion, TemplateStyleConfig
from .style_renderer import generate_full_css


# Keep Playwright's printable area aligned with tiptap-pagination-plus in the editor.
PDF_PAGE_MARGIN = {"top": "86px", "bottom": "86px", "left": "50px", "right": "50px"}


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


def _render_block(node: object, parent_list_class: str | None = None) -> str:
    if not _is_tiptap_node(node):
        return ""

    content = node.get("content")
    children = content if isinstance(content, list) else []
    node_type = node.get("type")

    if node_type == "columns":
        attrs = node.get("attrs")
        count = attrs.get("count") if isinstance(attrs, dict) else 2
        gap = attrs.get("gap") if isinstance(attrs, dict) else "default"
        safe_count = count if count in {1, 2, 3} else 2
        safe_gap = gap if gap in {"default", "compact", "wide"} else "default"
        safe_gap = escape_html(safe_gap)
        columns = "\n".join(_render_block(child) for child in children)
        return f"<div class=\"td-columns\" data-count=\"{safe_count}\" data-gap=\"{safe_gap}\">{columns}</div>" if columns else ""

    if node_type == "column":
        body = "\n".join(_render_block(child) for child in children)
        return f"<div class=\"td-column\">{body}</div>"

    if node_type == "horizontalRule":
        return '<hr class="td-resume-divider">'

    if node_type == "heading":
        attrs = node.get("attrs")
        raw_level = attrs.get("level") if isinstance(attrs, dict) else 2
        level = raw_level if isinstance(raw_level, int) and 1 <= raw_level <= 3 else 2
        cls = _block_class(node)
        style = _block_style_css(attrs)
        return f"<h{level} class=\"{cls}\"{_style_attr(style)}>{''.join(_render_inline(child) for child in children)}</h{level}>"

    if node_type == "paragraph":
        cls = _block_class(node)
        body = "".join(_render_inline(child) for child in children)
        style = _block_style_css(node.get("attrs"))
        return f"<p class=\"{cls}\"{_style_attr(style)}>{body}</p>" if body else ""

    if node_type in {"bulletList", "orderedList"}:
        cls = _block_class(node)
        tag = "ol" if node_type == "orderedList" else "ul"
        style = _list_style_css(node.get("attrs"))
        items = "\n".join(_render_block(child, cls) for child in children)
        return f"<{tag} class=\"{cls}\"{_style_attr(style)}>{items}</{tag}>" if items else ""

    if node_type == "listItem":
        cls = parent_list_class or _block_class(node)
        body = "".join(
            (
                f"<p class=\"td-resume-paragraph {cls}Text\"{_style_attr(_block_style_css(child.get('attrs')))}>{_render_inline(child)}</p>"
                if _is_tiptap_node(child) and child.get("type") == "paragraph"
                else _render_block(child)
            )
            for child in children
        )
        return f"<li>{body}</li>" if body else ""

    body = "".join(_render_inline(child) for child in children)
    return f"<p class=\"td-resume-paragraph\">{body}</p>" if body else ""


def _render_doc_body(resume: ResumeVersion) -> str:
    content = resume.doc_json.get("content")
    if isinstance(content, list):
        body = "\n".join(block for block in (_render_block(node) for node in content) if block)
        if body:
            return body

    lines = resume_lines_for_pdf(resume)
    if not lines:
        return '<p class="muted">Start writing your resume.</p>'

    return "\n".join(f"<p>{escape_html(line)}</p>" for line in lines)


def _render_template_style_css(template_style: TemplateStyleConfig | None) -> str:
    if template_style is None:
        return ""
    # Convert BlockStyle models to dicts with camelCase keys for style_renderer
    blocks_dict = {
        name: block.model_dump(by_alias=True, exclude_none=True)
        for name, block in template_style.blocks.items()
    }
    return generate_full_css(blocks_dict)


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
.td-columns {
  display: grid;
  gap: 10px;
  margin: 0 0 8px;
}
.td-columns[data-count="1"] {
  grid-template-columns: minmax(0, 1fr);
}
.td-columns[data-count="2"] {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.td-columns[data-count="3"] {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.td-columns[data-gap="compact"] {
  gap: 6px;
}
.td-columns[data-gap="wide"] {
  gap: 16px;
}
.td-column {
  min-width: 0;
}
.td-resume-divider {
  border: 0;
  border-top: 1px solid #d1d5db;
  margin: 8px 0;
}
"""


def render_resume_html(resume: ResumeVersion, template_style: TemplateStyleConfig | None = None) -> str:
    template_style_css = _render_template_style_css(template_style)
    return f"""<!doctype html>
<html lang="{resume.target_language}">
  <head>
    <meta charset="utf-8">
    <style>
      {template_style_css}
      {LAYOUT_CSS}
    </style>
  </head>
  <body class="td-resume-page">
    {_render_doc_body(resume)}
  </body>
</html>"""


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
        page.pdf(path=str(output_path), format="A4", print_background=True, margin=PDF_PAGE_MARGIN)
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
