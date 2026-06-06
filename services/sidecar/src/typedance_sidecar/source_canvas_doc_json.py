from copy import deepcopy
import hashlib
import json
from typing import Any

from .revision_models import SourceDocument, SourceResumeCanvasNode


_LOCATABLE_NODE_TYPES = {
    "heading",
    "paragraph",
    "listItem",
    "tableCell",
    "horizontalRule",
}

_NODE_TYPE_BY_DOC_TYPE = {
    "heading": "heading",
    "paragraph": "paragraph",
    "listItem": "list_item",
    "tableCell": "table_cell",
    "horizontalRule": "divider",
}


def source_canvas_hash(doc_json: dict[str, Any]) -> str:
    payload = json.dumps(doc_json, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def annotate_source_doc_json(
    doc_json: dict[str, Any],
    source: SourceDocument,
) -> tuple[dict[str, Any], list[SourceResumeCanvasNode], str]:
    annotated = deepcopy(doc_json)
    node_map: list[SourceResumeCanvasNode] = []

    def annotate_node(node: dict[str, Any]) -> None:
        node_number = len(node_map) + 1
        source_block_id = f"{source.id}_{node_number:04d}"
        canvas_node_id = f"node_{source_block_id}"
        attrs = dict(node.get("attrs") or {})
        attrs["canvasNodeId"] = canvas_node_id
        attrs["sourceBlockId"] = source_block_id
        node["attrs"] = attrs
        node_map.append(
            SourceResumeCanvasNode(
                canvas_node_id=canvas_node_id,
                node_type=_NODE_TYPE_BY_DOC_TYPE.get(node.get("type"), "unknown"),
                text=_extract_text(node),
                source_block_id=source_block_id,
                source_span={
                    "source_document_id": source.id,
                    "node_index": node_number,
                },
            )
        )

    def has_anchorable_content(node: dict[str, Any]) -> bool:
        if node.get("type") not in {"paragraph", "listItem"}:
            return True
        return bool(_extract_text(node).strip())

    def visit(value: Any, *, inside_list_item: bool = False) -> None:
        if isinstance(value, list):
            for item in value:
                visit(item, inside_list_item=inside_list_item)
            return

        if not isinstance(value, dict):
            return

        node_type = value.get("type")
        is_list_item = node_type == "listItem"
        should_annotate = node_type in _LOCATABLE_NODE_TYPES and not (
            node_type == "paragraph" and inside_list_item
        ) and has_anchorable_content(value)
        if should_annotate:
            annotate_node(value)

        next_inside_list_item = inside_list_item or is_list_item
        content = value.get("content")
        if isinstance(content, list):
            for child in content:
                visit(child, inside_list_item=next_inside_list_item)

    visit(annotated)
    return annotated, node_map, source_canvas_hash(annotated)


def _extract_text(value: Any) -> str:
    if isinstance(value, list):
        return "".join(_extract_text(item) for item in value)
    if not isinstance(value, dict):
        return ""

    text = value.get("text")
    content = value.get("content")
    content_text = _extract_text(content) if isinstance(content, list) else ""
    if isinstance(text, str):
        return text + content_text
    return content_text
