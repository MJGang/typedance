"""
Generate resume preview/export PDFs from saved TipTap JSON.

The sidecar owns the final PDF artifact. HTML is only an internal template
format used to get CSS-based A4 layout before writing the PDF.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fpdf import FPDF

from .models import ResumeVersion


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
        return f"<h{level}>{''.join(_render_inline(child) for child in children)}</h{level}>"

    if node_type == "paragraph":
        body = "".join(_render_inline(child) for child in children)
        return f"<p>{body}</p>" if body else ""

    if node_type in {"bulletList", "orderedList"}:
        tag = "ol" if node_type == "orderedList" else "ul"
        items = "\n".join(_render_block(child) for child in children)
        return f"<{tag}>{items}</{tag}>" if items else ""

    if node_type == "listItem":
        body = "".join(
            _render_inline(child) if _is_tiptap_node(child) and child.get("type") == "paragraph" else _render_block(child)
            for child in children
        )
        return f"<li>{body}</li>" if body else ""

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


def render_resume_html(resume: ResumeVersion) -> str:
    return f"""<!doctype html>
<html lang="{resume.target_language}">
  <head>
    <meta charset="utf-8">
    <style>
      @page {{ size: A4; margin: 18mm 20mm; }}
      body {{
        color: #1f2937;
        font-family: "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif;
        font-size: 10.5pt;
        line-height: 1.48;
      }}
      h1 {{
        color: #111827;
        font-size: 22pt;
        letter-spacing: 0;
        line-height: 1.12;
        margin: 0 0 8pt;
        padding-bottom: 8pt;
        border-bottom: 1.5pt solid #174ea6;
      }}
      h2 {{
        color: #174ea6;
        font-size: 12pt;
        margin: 14pt 0 5pt;
        text-transform: uppercase;
      }}
      h3 {{
        color: #111827;
        font-size: 10.5pt;
        margin: 9pt 0 3pt;
      }}
      p {{ margin: 0 0 6pt; }}
      ul, ol {{ margin: 0 0 8pt 14pt; padding: 0; }}
      li {{ margin: 0 0 3pt; padding-left: 2pt; }}
      strong {{ color: #111827; font-weight: 700; }}
      em {{ color: #4b5563; }}
      .muted {{ color: #6b7280; }}
    </style>
  </head>
  <body>
    {_render_doc_body(resume)}
  </body>
</html>"""


def export_resume_pdf(resume: ResumeVersion, exports_dir: Path) -> Path:
    exports_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = exports_dir / f"{resume.id}.pdf"
    html = render_resume_html(resume)

    try:
        from weasyprint import HTML

        HTML(string=html, base_url=str(exports_dir)).write_pdf(pdf_path)
    except (ImportError, OSError):
        _write_fpdf_fallback(resume, pdf_path)

    return pdf_path


_PAGE_W = 210
_MARGIN = 18
_BODY_W = _PAGE_W - 2 * _MARGIN


def _wrap_lines(text: str, max_width: float, font_size: float, cjk: bool) -> list[str]:
    if not text:
        return []

    cjk_chars = sum(1 for char in text if "\u4e00" <= char <= "\u9fff" or "\u3000" <= char <= "\u30ff")
    latin_chars = len(text) - cjk_chars
    char_width = 1.8 if cjk else 1.0
    avg_width = (cjk_chars * char_width + latin_chars) / max(len(text), 1)
    chars_per_line = max(int(max_width / max(font_size * 0.5 * avg_width, 1)), 1)

    lines: list[str] = []
    for paragraph in text.split("\n"):
        while len(paragraph) > chars_per_line:
            split_at = paragraph.rfind(" ", 0, chars_per_line)
            if split_at < 1:
                split_at = chars_per_line
            lines.append(paragraph[:split_at])
            paragraph = paragraph[split_at:].lstrip()
        if paragraph:
            lines.append(paragraph)
    return lines


def _find_cjk_font() -> str | None:
    candidates = [
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\simsun.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None


def _write_fpdf_fallback(resume: ResumeVersion, pdf_path: Path) -> None:
    lines = resume_lines_for_pdf(resume)
    title = lines[0] if lines else resume.title
    body = "\n".join(lines[1:])

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=_MARGIN)
    pdf.set_compression(False)
    pdf.add_page()

    cjk_font = _find_cjk_font()
    if cjk_font:
        pdf.add_font("CJK", "", cjk_font)
        pdf.add_font("CJK", "B", cjk_font)
        font = "CJK"
        is_cjk = True
    else:
        font = pdf.font_name
        is_cjk = False

    pdf.set_font(font, size=16, style="B")
    pdf.cell(_BODY_W, 10, text=title, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font(font, size=11)
    for line in _wrap_lines(body, _BODY_W, 11, is_cjk):
        pdf.cell(_BODY_W, 6, text=line, new_x="LMARGIN", new_y="NEXT")

    pdf.output(str(pdf_path))
