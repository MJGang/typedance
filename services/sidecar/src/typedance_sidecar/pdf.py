"""
Generate resume preview/export PDFs from saved TipTap JSON.

The sidecar owns the final PDF artifact. HTML is only an internal template
format used to get CSS-based A4 layout before writing the PDF.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .models import ResumeVersion, TemplateStyleConfig
from .style_renderer import generate_full_css


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
    return rendered


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


def _render_block(node: object) -> str:
    if not _is_tiptap_node(node):
        return ""

    content = node.get("content")
    children = content if isinstance(content, list) else []
    node_type = node.get("type")

    if node_type == "heading":
        attrs = node.get("attrs")
        raw_level = attrs.get("level") if isinstance(attrs, dict) else 2
        level = raw_level if isinstance(raw_level, int) and 1 <= raw_level <= 3 else 2
        cls = _block_class(node)
        return f"<h{level} class=\"{cls}\">{''.join(_render_inline(child) for child in children)}</h{level}>"

    if node_type == "paragraph":
        cls = _block_class(node)
        body = "".join(_render_inline(child) for child in children)
        return f"<p class=\"{cls}\">{body}</p>" if body else ""

    if node_type in {"bulletList", "orderedList"}:
        cls = _block_class(node)
        tag = "ol" if node_type == "orderedList" else "ul"
        items = "\n".join(_render_block(child) for child in children)
        return f"<{tag} class=\"{cls}\">{items}</{tag}>" if items else ""

    if node_type == "listItem":
        cls = _block_class(node)
        body = "".join(
            _render_inline(child) if _is_tiptap_node(child) and child.get("type") == "paragraph" else _render_block(child)
            for child in children
        )
        return f"<li class=\"{cls}\">{body}</li>" if body else ""

    body = "".join(_render_inline(child) for child in children)
    return f"<p>{body}</p>" if body else ""


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


def render_resume_html(resume: ResumeVersion, template_style: TemplateStyleConfig | None = None) -> str:
    template_style_css = _render_template_style_css(template_style)
    return f"""<!doctype html>
<html lang="{resume.target_language}">
  <head>
    <meta charset="utf-8">
    <style>
      {template_style_css}
    </style>
  </head>
  <body class="td-resume-page">
    {_render_doc_body(resume)}
  </body>
</html>"""


def export_resume_pdf(
    resume: ResumeVersion,
    exports_dir: Path,
    template_style: TemplateStyleConfig | None = None,
) -> Path:
    from weasyprint import HTML

    exports_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = exports_dir / f"{resume.id}.pdf"
    html = render_resume_html(resume, template_style)

    HTML(string=html, base_url=str(exports_dir)).write_pdf(pdf_path)

    return pdf_path
