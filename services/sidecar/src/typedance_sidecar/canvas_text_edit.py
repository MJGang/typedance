"""Prepare a plain-text edit against a caller's current canvas without saving it."""

from copy import deepcopy
from typing import Any


def _utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def _node_size(node: dict[str, Any]) -> int:
    if node.get("type") == "text":
        return _utf16_length(node.get("text", ""))
    children = node.get("content", [])
    if node.get("type") == "doc":
        return sum(_node_size(child) for child in children)
    if node.get("type") in {"hardBreak", "horizontalRule", "image"}:
        return 1
    return sum(_node_size(child) for child in children) + 2


def prepare_canvas_text_edit(
    doc_json: dict[str, Any], start: int, end: int, expected_text: str, replacement: str,
) -> dict[str, Any]:
    if doc_json.get("type") != "doc" or start < 0 or end <= start:
        raise ValueError("引用范围无效，请重新选择原文。")

    def find_block(node: dict[str, Any], position: int) -> tuple[dict[str, Any], int] | None:
        if node.get("type") in {"paragraph", "heading", "codeBlock"}:
            content_start = position + 1
            if content_start <= start < end <= position + _node_size(node) - 1:
                return node, content_start
            return None
        offset = position if node.get("type") == "doc" else position + 1
        for child in node.get("content", []):
            found = find_block(child, offset)
            if found:
                return found
            offset += _node_size(child)
        return None

    found = find_block(doc_json, 0)
    if found is None:
        raise ValueError("局部改写需要选中同一段落内的文字，请分段引用。")
    block, content_start = found
    if any(child.get("type") not in {"text", "hardBreak"} for child in block.get("content", [])):
        raise ValueError("这段包含特殊内容，请仅选择普通文字。")
    text = "".join(child.get("text", "") if child.get("type") == "text" else "\n" for child in block.get("content", []))
    encoded = text.encode("utf-16-le")
    try:
        selected = encoded[(start - content_start) * 2:(end - content_start) * 2].decode("utf-16-le")
    except UnicodeDecodeError as exc:
        raise ValueError("引用范围不能拆开一个字符，请重新选择。") from exc
    if selected != expected_text:
        raise ValueError("原文已修改，请重新引用后生成建议。")

    marks: list[dict[str, Any]] = []
    offset = content_start
    for child in block.get("content", []):
        if child.get("type") == "text" and offset <= start < offset + _node_size(child):
            marks = deepcopy(child.get("marks", []))
            break
        offset += _node_size(child)
    if block.get("type") == "codeBlock" and "\n" in replacement:
        content = [{"type": "text", "text": replacement}]
    else:
        content = []
        for index, line in enumerate(replacement.split("\n")):
            if index:
                content.append({"type": "hardBreak"})
            if line:
                content.append({"type": "text", "text": line, **({"marks": marks} if marks else {})})
    return {"original_text": selected, "replacement": replacement, "replacement_content": content}
