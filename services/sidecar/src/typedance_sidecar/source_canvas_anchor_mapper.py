from __future__ import annotations

import re

from .models import utc_now
from .revision_models import DocumentModule, ModuleAnchor, ParsedBlock, SourceResumeCanvas


MARKDOWN_HEADING_RE = re.compile(r"^\s*#{1,6}\s+(.+?)\s*#*\s*$")
MARKDOWN_QUOTE_RE = re.compile(r"^\s*>+\s*")
MARKDOWN_LIST_MARKER_RE = re.compile(r"^\s*(?:[-*+•·]|\d+[.)])\s+")


class SourceCanvasAnchorMapper:
    def apply_module_anchors(
        self,
        *,
        canvas: SourceResumeCanvas,
        modules: list[DocumentModule],
        parsed_blocks: list[ParsedBlock],
        module_source_refs: dict[str, list[str]],
    ) -> SourceResumeCanvas:
        node_by_block = self._node_by_block_text(canvas, parsed_blocks)
        module_by_node_id: dict[str, str] = {}
        anchors: list[ModuleAnchor] = []
        owned_node_ids: set[str] = set()

        for module in sorted(
            (item for item in modules if item.visibility == "visible"),
            key=lambda item: item.order,
        ):
            node_ids: list[str] = []
            for block_id in module_source_refs.get(module.id, []):
                node_id = node_by_block.get(block_id)
                if node_id is None or node_id in node_ids or node_id in owned_node_ids:
                    continue
                node_ids.append(node_id)
                owned_node_ids.add(node_id)
                module_by_node_id[node_id] = module.id
            if node_ids:
                anchors.append(
                    ModuleAnchor(
                        module_id=module.id,
                        canvas_node_ids=node_ids,
                        title=module.title,
                        order=module.order,
                    )
                )

        return canvas.model_copy(
            update={
                "node_map": [
                    node.model_copy(
                        update={"module_id": module_by_node_id.get(node.canvas_node_id)}
                    )
                    for node in canvas.node_map
                ],
                "module_anchors": anchors,
                "updated_at": utc_now(),
            }
        )

    def _node_by_block_text(
        self,
        canvas: SourceResumeCanvas,
        parsed_blocks: list[ParsedBlock],
    ) -> dict[str, str]:
        available_nodes = list(canvas.node_map)
        available_node_ids = {node.canvas_node_id for node in available_nodes}
        node_by_block: dict[str, str] = {}

        for block in sorted(parsed_blocks, key=lambda item: item.order):
            span_node_id = block.source_span.get("canvas_node_id")
            if isinstance(span_node_id, str) and span_node_id in available_node_ids:
                node_by_block[block.id] = span_node_id
                available_node_ids.remove(span_node_id)
                available_nodes = [
                    node for node in available_nodes if node.canvas_node_id != span_node_id
                ]
                continue

            block_text = self._normalize_text(block.text)
            if not block_text:
                continue
            for index, node in enumerate(available_nodes):
                if self._normalize_text(node.text) != block_text:
                    continue
                node_by_block[block.id] = node.canvas_node_id
                available_node_ids.remove(node.canvas_node_id)
                del available_nodes[index]
                break

        return node_by_block

    def _normalize_text(self, text: str) -> str:
        heading_match = MARKDOWN_HEADING_RE.match(text)
        normalized = heading_match.group(1) if heading_match else text
        normalized = MARKDOWN_QUOTE_RE.sub("", normalized)
        normalized = MARKDOWN_LIST_MARKER_RE.sub("", normalized)
        normalized = normalized.replace("**", "").replace("__", "")
        return re.sub(r"\s+", "", normalized)
