from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from typedance_sidecar.import_resume_file_text import (
    ImportResumeFileError,
    extract_import_resume_file_text,
)


def test_extracts_text_from_uploaded_pdf():
    text = extract_import_resume_file_text(
        _minimal_pdf("Resume Order Platform"),
        filename="resume.pdf",
        mime_type="application/pdf",
    )

    assert "Resume Order Platform" in text


def test_extracts_text_from_uploaded_docx():
    text = extract_import_resume_file_text(
        _minimal_docx("Resume import project"),
        filename="resume.docx",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )

    assert text == "Resume import project"


def test_decodes_plain_text_and_markdown_without_document_extractor():
    assert extract_import_resume_file_text("张三\n项目经历".encode(), filename="resume.txt") == "张三\n项目经历"
    assert extract_import_resume_file_text("# 张三\n\n项目经历".encode(), filename="resume.md") == "# 张三\n\n项目经历"


def test_legacy_doc_uses_unified_document_extractor(monkeypatch):
    calls: list[tuple[bytes, str]] = []

    def fake_extract(data: bytes, extension: str) -> str:
        calls.append((data, extension))
        return "legacy doc resume text"

    monkeypatch.setattr("typedance_sidecar.import_resume_file_text._extract_with_sharepoint2text", fake_extract)

    text = extract_import_resume_file_text(b"\xd0\xcf\x11\xe0", filename="resume.doc")

    assert text == "legacy doc resume text"
    assert calls == [(b"\xd0\xcf\x11\xe0", "doc")]


def test_rejects_unsupported_resume_import_file_type():
    with pytest.raises(ImportResumeFileError, match="Unsupported import file type"):
        extract_import_resume_file_text(b"{}", filename="resume.json")


def _minimal_docx(text: str) -> bytes:
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>""",
        )
        archive.writestr(
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>""",
        )
        archive.writestr(
            "word/document.xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body>
</w:document>""",
        )
    return output.getvalue()


def _minimal_pdf(text: str) -> bytes:
    stream = f"BT /F1 24 Tf 100 700 Td ({text}) Tj ET".encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    output = BytesIO()
    output.write(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(output.tell())
        output.write(f"{index} 0 obj\n".encode())
        output.write(obj)
        output.write(b"\nendobj\n")
    xref_offset = output.tell()
    output.write(f"xref\n0 {len(objects) + 1}\n".encode())
    output.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.write(f"{offset:010d} 00000 n \n".encode())
    output.write(
        f"trailer\n<< /Root 1 0 R /Size {len(objects) + 1} >>\nstartxref\n{xref_offset}\n%%EOF\n".encode()
    )
    return output.getvalue()
