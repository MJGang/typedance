from uuid import uuid4

from .models import utc_now
from .markdown_doc_json import MarkdownDocJsonConverter, TiptapMarkdownDocJsonConverter
from .revision_models import (
    DocumentModule,
    ModuleAnchor,
    ParsedBlock,
    SourceDocument,
    SourceResumeCanvas,
    SourceResumeCanvasNode,
)


class SourceResumeCanvasBuilder:
    def __init__(self, markdown_converter: MarkdownDocJsonConverter | None = None) -> None:
        self.markdown_converter = markdown_converter or TiptapMarkdownDocJsonConverter()

    def build(
        self,
        *,
        source: SourceDocument,
        parsed_blocks: list[ParsedBlock],
        modules: list[DocumentModule],
        module_source_refs: dict[str, list[str]],
    ) -> SourceResumeCanvas:
        now = utc_now()
        sorted_blocks = sorted(
            [block for block in parsed_blocks if block.source_document_id == source.id],
            key=lambda block: block.order,
        )
        enhanced_module_source_refs = self._include_adjacent_module_headings(
            sorted_blocks,
            module_source_refs,
        )
        module_by_block = self._module_by_block(enhanced_module_source_refs)
        attrs_by_block: dict[str, dict[str, object]] = {}
        conversion_blocks: list[dict[str, object]] = []
        for block in sorted_blocks:
            attrs = self._doc_attrs(block, self._canvas_node_id(block.id), module_by_block.get(block.id))
            attrs_by_block[block.id] = attrs
            conversion_blocks.append(
                {
                    "id": block.id,
                    "text": block.text,
                    "fallbackType": self._fallback_type(block),
                    "attrs": attrs,
                }
            )
        converted_nodes = self.markdown_converter.convert_blocks(conversion_blocks)
        doc_nodes = []
        node_map = []

        for block in sorted_blocks:
            canvas_node_id = self._canvas_node_id(block.id)
            module_id = module_by_block.get(block.id)
            doc_nodes.extend(
                converted_nodes.get(block.id)
                or [self._doc_node(block, attrs_by_block[block.id])]
            )
            node_map.append(
                SourceResumeCanvasNode(
                    canvas_node_id=canvas_node_id,
                    source_block_id=block.id,
                    node_type=self._node_type(block),
                    text=block.text,
                    source_span=block.source_span,
                    module_id=module_id,
                )
            )

        return SourceResumeCanvas(
            id=f"canvas_{uuid4().hex}",
            document_id=source.document_id,
            old_resume_source_id=source.id,
            doc_json={"type": "doc", "content": doc_nodes},
            node_map=node_map,
            module_anchors=self._module_anchors(
                modules,
                enhanced_module_source_refs,
                valid_block_ids={block.id for block in sorted_blocks},
            ),
            created_at=now,
            updated_at=now,
        )

    def blank(
        self,
        *,
        document_id: str,
        source_id: str,
        title: str = "新简历",
    ) -> SourceResumeCanvas:
        now = utc_now()
        node_id = "node_blank_start"
        return SourceResumeCanvas(
            id=f"canvas_{uuid4().hex}",
            document_id=document_id,
            old_resume_source_id=source_id,
            doc_json={
                "type": "doc",
                "content": [
                    {
                        "type": "heading",
                        "attrs": {
                            "level": 1,
                            "canvasNodeId": node_id,
                            "sourceBlockId": source_id,
                        },
                        "content": [{"type": "text", "text": title}],
                    }
                ],
            },
            node_map=[
                SourceResumeCanvasNode(
                    canvas_node_id=node_id,
                    source_block_id=source_id,
                    node_type="heading",
                    text=title,
                    source_span={},
                )
            ],
            module_anchors=[],
            created_at=now,
            updated_at=now,
        )

    def _doc_node(
        self,
        block: ParsedBlock,
        attrs: dict[str, object],
    ) -> dict[str, object]:
        if block.type == "heading":
            return {
                "type": "heading",
                "attrs": {**attrs, "level": 2},
                "content": [{"type": "text", "text": block.text}],
            }

        if block.type == "list":
            return {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "attrs": attrs,
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": block.text,
                                    }
                                ],
                            }
                        ],
                    }
                ],
            }

        return {
            "type": "paragraph",
            "attrs": attrs,
            "content": [{"type": "text", "text": block.text}],
        }

    def _doc_attrs(
        self,
        block: ParsedBlock,
        canvas_node_id: str,
        module_id: str | None,
    ) -> dict[str, object]:
        attrs: dict[str, object] = {
            "canvasNodeId": canvas_node_id,
            "sourceBlockId": block.id,
        }
        if module_id:
            attrs["moduleId"] = module_id
        return attrs

    def _fallback_type(self, block: ParsedBlock) -> str:
        if block.type == "heading":
            return "heading"
        if block.type == "list":
            return "list"
        return "paragraph"

    def _node_type(self, block: ParsedBlock) -> str:
        if block.type == "heading":
            return "heading"
        if block.type == "list":
            return "list_item"
        if block.type in {"paragraph", "contact", "date_range"}:
            return "paragraph"
        return "unknown"

    def _include_adjacent_module_headings(
        self,
        sorted_blocks: list[ParsedBlock],
        module_source_refs: dict[str, list[str]],
    ) -> dict[str, list[str]]:
        enhanced_refs = {
            module_id: list(block_ids)
            for module_id, block_ids in module_source_refs.items()
        }
        block_positions = {block.id: index for index, block in enumerate(sorted_blocks)}
        assigned_block_ids = {
            block_id
            for block_ids in enhanced_refs.values()
            for block_id in block_ids
        }

        for module_id, block_ids in enhanced_refs.items():
            valid_positions = [
                block_positions[block_id]
                for block_id in block_ids
                if block_id in block_positions
            ]
            if not valid_positions:
                continue
            first_position = min(valid_positions)
            if sorted_blocks[first_position].type == "heading":
                continue
            if first_position == 0:
                continue
            previous_block = sorted_blocks[first_position - 1]
            if previous_block.type != "heading" or previous_block.id in assigned_block_ids:
                continue
            block_ids.insert(0, previous_block.id)
            assigned_block_ids.add(previous_block.id)

        return enhanced_refs

    def _module_by_block(self, module_source_refs: dict[str, list[str]]) -> dict[str, str]:
        result: dict[str, str] = {}
        for module_id, block_ids in module_source_refs.items():
            for block_id in block_ids:
                result[block_id] = module_id
        return result

    def _module_anchors(
        self,
        modules: list[DocumentModule],
        module_source_refs: dict[str, list[str]],
        valid_block_ids: set[str],
    ) -> list[ModuleAnchor]:
        anchors: list[ModuleAnchor] = []
        visible_modules = [module for module in modules if module.visibility == "visible"]
        for module in sorted(visible_modules, key=lambda item: item.order):
            node_ids = [
                self._canvas_node_id(block_id)
                for block_id in module_source_refs.get(module.id, [])
                if block_id in valid_block_ids
            ]
            if not node_ids:
                continue
            anchors.append(
                ModuleAnchor(
                    module_id=module.id,
                    canvas_node_ids=node_ids,
                    title=module.title,
                    order=module.order,
                )
            )
        return anchors

    def _canvas_node_id(self, block_id: str) -> str:
        return f"node_{block_id}"
