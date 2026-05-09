"""
Pure-Python PDF export using fpdf2.

No native library dependencies. Supports Unicode/CJK text via system font detection.
"""

from __future__ import annotations

import platform
from pathlib import Path
from typing import Sequence

from fpdf import FPDF

from .models import ResumeVersion

# ── line wrapping ──────────────────────────────────────────────────


def _wrap_lines(text: str, max_width: float, font_size: float, cjk: bool) -> list[str]:
    """Split text into lines that fit within max_width."""
    # CJK characters are roughly 2x the width of Latin characters in proportional fonts.
    # We use a simple heuristic: count CJK vs Latin chars.
    cjk_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff' or '\u3000' <= c <= '\u30ff')
    latin_chars = len(text) - cjk_chars
    char_width = 1.8 if cjk else 1.0  # approximate
    avg_width = (cjk_chars * char_width + latin_chars * 1.0) / max(len(text), 1)
    chars_per_line = max(int(max_width / (font_size * 0.5 * avg_width)), 1)

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
    return lines if lines else [""]


# ── font detection ─────────────────────────────────────────────────

_FONT_CANDIDATES: dict[str, Sequence[tuple[str, str]]] = {
    "Windows": [
        ("C:\\Windows\\Fonts\\msyh.ttc", "Microsoft YaHei"),       # Simplified Chinese
        ("C:\\Windows\\Fonts\\simsun.ttc", "SimSun"),              # Chinese (serif)
        ("C:\\Windows\\Fonts\\mingliu.ttc", "MingLiU"),            # Traditional Chinese
        ("C:\\Windows\\Fonts\\msgothic.ttc", "MS Gothic"),         # Japanese
    ],
    "Darwin": [
        ("/System/Library/Fonts/PingFang.ttc", "PingFang"),         # macOS Chinese
        ("/System/Library/Fonts/STHeiti Light.ttc", "STHeiti"),
        ("/Library/Fonts/Arial Unicode.ttf", "Arial Unicode"),
    ],
    "Linux": [
        ("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", "Noto Sans CJK"),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "Noto Sans CJK"),
        ("/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc", "Noto Sans CJK"),
    ],
}


def _find_cjk_font() -> tuple[str, str] | None:
    """Try to locate a system CJK font. Returns (path, name) or None."""
    system = platform.system()
    candidates = _FONT_CANDIDATES.get(system, [])
    for path, name in candidates:
        if Path(path).exists():
            return (path, name)
    return None


# ── resume HTML rendering (kept for compatibility) ─────────────────


def escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render_resume_html(resume: ResumeVersion) -> str:
    """Render a ResumeVersion to an HTML string (used for A4 preview, not for PDF anymore)."""
    lines = [line.strip() for line in resume.plain_text_snapshot.splitlines() if line.strip()]
    body = "".join(f"<p>{escape_html(line)}</p>" for line in lines)
    if not body:
        body = '<p class="muted">Start writing your resume.</p>'

    return f"""<!doctype html>
<html lang="{resume.target_language}">
  <head>
    <meta charset="utf-8">
    <style>
      @page {{ size: A4; margin: 18mm; }}
      body {{ font-family: Arial, "Noto Sans SC", sans-serif; color: #1f2933; line-height: 1.45; }}
      h1 {{ font-size: 22px; margin: 0 0 12px; }}
      p {{ margin: 0 0 8px; font-size: 11px; }}
      .muted {{ color: #697586; }}
    </style>
  </head>
  <body>
    <h1>{escape_html(resume.title)}</h1>
    {body}
  </body>
</html>"""


# ── PDF export ─────────────────────────────────────────────────────

_PAGE_W = 210  # A4 width in mm
_PAGE_H = 297  # A4 height in mm
_MARGIN = 18   # mm
_BODY_W = _PAGE_W - 2 * _MARGIN  # usable width


def _write_resume_pdf(resume: ResumeVersion, pdf_path: Path) -> None:
    """Generate a PDF from a ResumeVersion using fpdf2."""
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=_MARGIN)
    pdf.add_page()

    # ── font setup ──
    cjk_font = _find_cjk_font()
    if cjk_font:
        font_path, font_name = cjk_font
        pdf.add_font("CJK", "", font_path, uni=True)
        main_font = "CJK"
        is_cjk = True
    else:
        # Fallback to built-in DejaVu (good for Latin/ASCII, blank for CJK)
        main_font = pdf.font_name  # fpdf2 default
        is_cjk = False

    # ── title ──
    pdf.set_font(main_font, size=16, style="B")
    pdf.cell(_BODY_W, 10, text=resume.title, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # ── body ──
    pdf.set_font(main_font, size=11)
    for line in _wrap_lines(resume.plain_text_snapshot, _BODY_W, 11, is_cjk):
        pdf.cell(_BODY_W, 6, text=line, new_x="LMARGIN", new_y="NEXT")

    pdf.output(str(pdf_path))


def export_resume_pdf(resume: ResumeVersion, exports_dir: Path) -> Path:
    """Export a ResumeVersion to PDF.

    Returns the Path to the generated PDF file.
    """
    exports_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = exports_dir / f"{resume.id}.pdf"
    _write_resume_pdf(resume, pdf_path)
    return pdf_path
