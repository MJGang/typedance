import re
from pathlib import Path
from typing import Any
from uuid import uuid4

from .markdown_doc_json import MarkdownDocJsonConverter, TiptapMarkdownDocJsonConverter
from .models import utc_now
from .revision_models import SourceDocument, SourceResumeCanvas
from .source_canvas_docx import DocxSourceCanvasAdapter, DocxSourceCanvasError
from .source_canvas_doc_json import annotate_source_doc_json
from .source_section_rules import SECTION_ALIASES


class SourceCanvasInitializationError(RuntimeError):
    pass


MARKDOWN_MIME_TYPES = {"text/markdown", "text/x-markdown"}
MARKDOWN_EXTENSIONS = {".md", ".markdown"}
DOCX_MIME_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
DOCX_EXTENSIONS = {".docx"}
TEXT_DOCUMENT_MIME_TYPES = {"application/pdf", "application/msword"}
TEXT_DOCUMENT_EXTENSIONS = {".pdf", ".doc"}
TEXT_FILE_EXTENSIONS = {".txt"}
KNOWN_SOURCE_EXTENSIONS = (
    MARKDOWN_EXTENSIONS | DOCX_EXTENSIONS | TEXT_DOCUMENT_EXTENSIONS | TEXT_FILE_EXTENSIONS
)
MARKDOWN_SYNTAX_RE = re.compile(
    r"^\s{0,3}(?:#{1,6}\s+\S.*|[-*+]\s+\S.*|\d+\.\s+\S.*|>\s+\S.*|```|\|.+\|)\s*$"
)


class SourceCanvasInitializer:
    def __init__(
        self,
        markdown_converter: MarkdownDocJsonConverter | None = None,
        docx_adapter: DocxSourceCanvasAdapter | None = None,
    ) -> None:
        self.markdown_converter = markdown_converter or TiptapMarkdownDocJsonConverter()
        self.docx_adapter = docx_adapter or DocxSourceCanvasAdapter()

    def initialize(self, source: SourceDocument) -> SourceResumeCanvas:
        if self._uses_docx_adapter(source):
            if not source.file_path:
                raise SourceCanvasInitializationError("DOCX source has no saved file path")
            try:
                doc_json = self.docx_adapter.to_doc_json(Path(source.file_path))
            except DocxSourceCanvasError as exc:
                raise SourceCanvasInitializationError(str(exc)) from exc
        else:
            raw_text = source.raw_text or ""
            if not raw_text.strip():
                raise SourceCanvasInitializationError("Import source has no readable content")

            if self._uses_markdown_adapter(source, raw_text):
                doc_json = self.markdown_converter.convert_markdown(raw_text)
            else:
                doc_json = self._text_doc_json(raw_text)

        annotated_doc_json, node_map, source_snapshot_hash = annotate_source_doc_json(
            doc_json,
            source,
        )
        now = utc_now()
        return SourceResumeCanvas(
            id=f"canvas_{uuid4().hex}",
            document_id=source.document_id,
            old_resume_source_id=source.id,
            version=1,
            source_snapshot_hash=source_snapshot_hash,
            doc_json=annotated_doc_json,
            node_map=node_map,
            module_anchors=[],
            created_at=now,
            updated_at=now,
        )

    def _uses_docx_adapter(self, source: SourceDocument) -> bool:
        mime_type = (source.mime_type or "").split(";", maxsplit=1)[0].strip().lower()
        extension = self._source_extension(source)
        return mime_type in DOCX_MIME_TYPES or extension in DOCX_EXTENSIONS

    def _uses_markdown_adapter(self, source: SourceDocument, raw_text: str) -> bool:
        mime_type = (source.mime_type or "").split(";", maxsplit=1)[0].strip().lower()
        extension = self._source_extension(source)
        if mime_type in MARKDOWN_MIME_TYPES:
            return True
        if extension in MARKDOWN_EXTENSIONS:
            return True
        if mime_type in DOCX_MIME_TYPES:
            return False
        if extension in DOCX_EXTENSIONS:
            return False
        if mime_type in TEXT_DOCUMENT_MIME_TYPES:
            return False
        if extension in TEXT_DOCUMENT_EXTENSIONS:
            return False
        if extension in TEXT_FILE_EXTENSIONS:
            return False
        if mime_type == "text/plain" and extension not in KNOWN_SOURCE_EXTENSIONS:
            return self._looks_like_markdown(raw_text)
        if mime_type or extension:
            return False
        return self._looks_like_markdown(raw_text)

    def _source_extension(self, source: SourceDocument) -> str:
        candidates = [
            source.file_path,
            source.original_uri,
            source.title,
        ]
        fallback_extension = ""
        for candidate in candidates:
            if not candidate:
                continue
            normalized = candidate.split("?", maxsplit=1)[0].split("#", maxsplit=1)[0]
            suffix = Path(normalized).suffix.lower()
            if suffix in KNOWN_SOURCE_EXTENSIONS:
                return suffix
            if suffix and not fallback_extension:
                fallback_extension = suffix
        return fallback_extension

    def _looks_like_markdown(self, raw_text: str) -> bool:
        for line in raw_text.splitlines():
            if MARKDOWN_SYNTAX_RE.match(line):
                return True
            if "**" in line or "__" in line:
                return True
        return False

    def _text_doc_json(self, raw_text: str) -> dict[str, Any]:
        content = [self._text_node(line.strip()) for line in raw_text.splitlines() if line.strip()]
        return {"type": "doc", "content": content}

    def _text_node(self, text: str) -> dict[str, Any]:
        if self._is_section_heading(text):
            return {
                "type": "heading",
                "attrs": {"level": 2},
                "content": [{"type": "text", "text": text}],
            }
        return {
            "type": "paragraph",
            "content": [{"type": "text", "text": text}],
        }

    def _is_section_heading(self, text: str) -> bool:
        normalized = text.strip().rstrip(":：")
        return any(normalized in aliases for aliases, _module_type, _title in SECTION_ALIASES)
