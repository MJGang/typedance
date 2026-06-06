import re
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree


WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
STRICT_WORD_NAMESPACE = "http://purl.oclc.org/ooxml/wordprocessingml/main"
SUPPORTED_WORD_NAMESPACES = {WORD_NAMESPACE, STRICT_WORD_NAMESPACE}
HEADING_STYLE_RE = re.compile(r"^Heading\s*([1-6])$", re.IGNORECASE)
FALSE_MARK_VALUES = {"0", "false", "off", "none"}


class DocxSourceCanvasError(RuntimeError):
    pass


class DocxSourceCanvasAdapter:
    def to_doc_json(self, path: Path) -> dict[str, Any]:
        try:
            with zipfile.ZipFile(path) as archive:
                try:
                    document_xml = archive.read("word/document.xml")
                except KeyError as exc:
                    raise DocxSourceCanvasError(
                        "DOCX source is missing word/document.xml"
                    ) from exc
        except DocxSourceCanvasError:
            raise
        except (OSError, RuntimeError, zipfile.BadZipFile) as exc:
            raise DocxSourceCanvasError(f"Failed to read DOCX source: {exc}") from exc

        try:
            root = ElementTree.fromstring(document_xml)
        except ElementTree.ParseError as exc:
            raise DocxSourceCanvasError(f"DOCX source has invalid document.xml: {exc}") from exc

        word = self._word_namespace_prefix(root)
        content: list[dict[str, Any]] = []
        list_stack: list[dict[str, Any]] = []

        for paragraph in root.iter(f"{word}p"):
            text_nodes = self._text_nodes(paragraph, word)
            if not self._has_readable_text(text_nodes):
                continue

            list_level = self._list_level(paragraph, word)
            if list_level is not None:
                self._append_list_item(content, list_stack, list_level, text_nodes)
                continue

            list_stack.clear()
            heading_level = self._heading_level(paragraph, word)
            if heading_level is not None:
                content.append(
                    {
                        "type": "heading",
                        "attrs": {"level": heading_level},
                        "content": text_nodes,
                    }
                )
            else:
                content.append({"type": "paragraph", "content": text_nodes})

        if not content:
            return {"type": "doc", "content": [{"type": "paragraph"}]}
        return {"type": "doc", "content": content}

    def _word_namespace_prefix(self, root: ElementTree.Element) -> str:
        namespace = self._tag_namespace(root.tag)
        if namespace in SUPPORTED_WORD_NAMESPACES:
            return f"{{{namespace}}}"
        raise DocxSourceCanvasError(
            "DOCX source uses unsupported WordprocessingML namespace"
        )

    def _tag_namespace(self, tag: str) -> str | None:
        if not tag.startswith("{"):
            return None
        namespace, _separator, _local_name = tag[1:].partition("}")
        return namespace or None

    def _append_list_item(
        self,
        root_content: list[dict[str, Any]],
        list_stack: list[dict[str, Any]],
        raw_level: int,
        text_nodes: list[dict[str, Any]],
    ) -> None:
        level = max(0, raw_level)
        if not list_stack and level > 0:
            level = 0
        elif level > len(list_stack):
            level = len(list_stack)

        del list_stack[level + 1 :]
        if level == len(list_stack):
            list_node = {"type": "bulletList", "content": []}
            if level == 0:
                root_content.append(list_node)
            else:
                parent_item = list_stack[level - 1]["content"][-1]
                parent_item.setdefault("content", []).append(list_node)
            list_stack.append(list_node)

        list_item = {
            "type": "listItem",
            "content": [{"type": "paragraph", "content": text_nodes}],
        }
        list_stack[level]["content"].append(list_item)

    def _text_nodes(self, paragraph: ElementTree.Element, word: str) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        for run in paragraph.iter(f"{word}r"):
            text = self._run_text(run, word)
            if not text:
                continue

            node: dict[str, Any] = {"type": "text", "text": text}
            marks = self._run_marks(run, word)
            if marks:
                node["marks"] = marks
            nodes.append(node)
        return nodes

    def _run_text(self, run: ElementTree.Element, word: str) -> str:
        parts: list[str] = []
        for child in run:
            if child.tag == f"{word}t":
                parts.append(child.text or "")
            elif child.tag == f"{word}tab":
                parts.append("\t")
            elif child.tag == f"{word}br":
                parts.append("\n")
        return "".join(parts)

    def _run_marks(self, run: ElementTree.Element, word: str) -> list[dict[str, str]]:
        run_properties = run.find(f"{word}rPr")
        if run_properties is None:
            return []

        marks: list[dict[str, str]] = []
        if self._has_enabled_property(run_properties, "b", word):
            marks.append({"type": "bold"})
        if self._has_enabled_property(run_properties, "i", word):
            marks.append({"type": "italic"})
        if self._has_enabled_property(run_properties, "u", word):
            marks.append({"type": "underline"})
        return marks

    def _has_enabled_property(
        self, parent: ElementTree.Element, tag_name: str, word: str
    ) -> bool:
        property_node = parent.find(f"{word}{tag_name}")
        if property_node is None:
            return False
        value = self._word_value(property_node, word)
        return value.lower() not in FALSE_MARK_VALUES if value else True

    def _heading_level(self, paragraph: ElementTree.Element, word: str) -> int | None:
        paragraph_style = paragraph.find(f"{word}pPr/{word}pStyle")
        if paragraph_style is None:
            return None

        style_value = self._word_value(paragraph_style, word)
        if not style_value:
            return None

        match = HEADING_STYLE_RE.match(style_value.replace(" ", ""))
        if not match:
            return None
        return int(match.group(1))

    def _list_level(self, paragraph: ElementTree.Element, word: str) -> int | None:
        numbering_properties = paragraph.find(f"{word}pPr/{word}numPr")
        if numbering_properties is None:
            return None

        level_node = numbering_properties.find(f"{word}ilvl")
        if level_node is None:
            return 0

        level_value = self._word_value(level_node, word)
        try:
            return int(level_value) if level_value is not None else 0
        except ValueError:
            return 0

    def _word_value(self, node: ElementTree.Element, word: str) -> str | None:
        return node.attrib.get(f"{word}val") or node.attrib.get("val")

    def _has_readable_text(self, nodes: list[dict[str, Any]]) -> bool:
        return any(str(node.get("text", "")).strip() for node in nodes)
