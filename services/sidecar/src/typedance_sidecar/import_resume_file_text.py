from __future__ import annotations

from pathlib import Path


TEXT_IMPORT_EXTENSIONS = {"txt", "md", "markdown"}
DOCUMENT_IMPORT_EXTENSIONS = {"pdf", "docx", "doc"}
SUPPORTED_IMPORT_EXTENSIONS = TEXT_IMPORT_EXTENSIONS | DOCUMENT_IMPORT_EXTENSIONS


class ImportResumeFileError(ValueError):
    pass


def extract_import_resume_file_text(
    data: bytes,
    *,
    filename: str,
    mime_type: str | None = None,
) -> str:
    extension = _extension_for(filename)
    if extension not in SUPPORTED_IMPORT_EXTENSIONS:
        raise ImportResumeFileError(f"Unsupported import file type: .{extension or 'unknown'}")

    if extension in TEXT_IMPORT_EXTENSIONS:
        text = _decode_text_file(data)
    else:
        text = _extract_with_sharepoint2text(data, extension)

    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        raise ImportResumeFileError("Import file has no extractable text")
    return normalized


def _extension_for(filename: str) -> str:
    return Path(filename).suffix.lower().lstrip(".")


def _decode_text_file(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _extract_with_sharepoint2text(data: bytes, extension: str) -> str:
    try:
        import sharepoint2text

        results = sharepoint2text.read_bytes(
            data,
            extension=extension,
            ignore_images=True,
            include_attachments=False,
        )
        return "\n\n".join(result.get_full_text() for result in results)
    except Exception as exc:
        raise ImportResumeFileError(f"Failed to extract text from .{extension} file") from exc
