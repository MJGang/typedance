from pathlib import Path

from .models import ResumeVersion


def escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render_resume_html(resume: ResumeVersion) -> str:
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


def _pdf_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _write_basic_pdf(resume: ResumeVersion, pdf_path: Path) -> None:
    lines = [resume.title, "", *resume.plain_text_snapshot.splitlines()]
    y = 800
    text_commands = ["BT", "/F1 12 Tf", "72 800 Td"]
    for index, raw_line in enumerate(lines[:55]):
        line = raw_line.encode("latin-1", errors="replace").decode("latin-1")
        if index:
            y -= 16
            text_commands.append(f"0 -16 Td")
        text_commands.append(f"({_pdf_escape(line)}) Tj")
    text_commands.append("ET")
    stream = "\n".join(text_commands).encode("latin-1")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]

    chunks = [b"%PDF-1.4\n"]
    offsets = [0]
    for number, payload in enumerate(objects, start=1):
        offsets.append(sum(len(chunk) for chunk in chunks))
        chunks.append(f"{number} 0 obj\n".encode("ascii") + payload + b"\nendobj\n")

    xref_offset = sum(len(chunk) for chunk in chunks)
    xref = [b"xref\n", f"0 {len(objects) + 1}\n".encode("ascii"), b"0000000000 65535 f \n"]
    for offset in offsets[1:]:
        xref.append(f"{offset:010d} 00000 n \n".encode("ascii"))
    chunks.extend(xref)
    chunks.append(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    pdf_path.write_bytes(b"".join(chunks))


def export_resume_pdf(resume: ResumeVersion, exports_dir: Path) -> Path:
    exports_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = exports_dir / f"{resume.id}.pdf"
    try:
        from weasyprint import HTML

        HTML(string=render_resume_html(resume)).write_pdf(pdf_path)
    except OSError:
        _write_basic_pdf(resume, pdf_path)
    return pdf_path
