from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_models import (
    DocumentModule,
    ParsedBlock,
    SourceDocument,
    SourceResumeCanvas,
    SourceResumeCanvasNode,
)
from typedance_sidecar.revision_source_canvas import BlankSourceResumeCanvasBuilder
from typedance_sidecar.source_canvas_anchor_mapper import SourceCanvasAnchorMapper
from typedance_sidecar.source_canvas_doc_json import annotate_source_doc_json


def test_revision_source_canvas_only_exposes_blank_builder():
    builder = BlankSourceResumeCanvasBuilder()
    canvas = builder.blank(document_id="doc_blank", source_id="src_blank", title="新简历")

    assert canvas.doc_json["content"][0]["type"] == "heading"
    assert canvas.version == 1
    assert canvas.source_snapshot_hash.startswith("sha256:")


def test_anchor_mapper_maps_parsed_blocks_to_existing_canvas_nodes():
    now = utc_now()
    canvas = SourceResumeCanvas(
        id="canvas_1",
        document_id="doc_1",
        old_resume_source_id="src_1",
        version=1,
        source_snapshot_hash="sha256:source",
        doc_json={"type": "doc", "content": []},
        node_map=[
            SourceResumeCanvasNode(
                canvas_node_id="node_heading",
                node_type="heading",
                text="工作经历",
                source_block_id="src_1_0001",
            ),
            SourceResumeCanvasNode(
                canvas_node_id="node_body",
                node_type="paragraph",
                text="负责订单系统重构",
                source_block_id="src_1_0002",
            ),
        ],
        module_anchors=[],
        created_at=now,
        updated_at=now,
    )
    blocks = [
        ParsedBlock(
            id="block_heading",
            source_document_id="src_1",
            type="heading",
            text="工作经历",
            order=0,
            source_span={"line": 1},
        ),
        ParsedBlock(
            id="block_body",
            source_document_id="src_1",
            type="paragraph",
            text="- 负责订单系统重构",
            order=1,
            source_span={"line": 2},
        ),
    ]
    module = DocumentModule(
        id="mod_work",
        draft_id="draft_1",
        pack_id="resume",
        type="WorkExperience",
        title="工作经历",
        order=1,
        visibility="visible",
        status="needs_review",
        data={},
        created_at=now,
        updated_at=now,
    )

    updated = SourceCanvasAnchorMapper().apply_module_anchors(
        canvas=canvas,
        modules=[module],
        parsed_blocks=blocks,
        module_source_refs={"mod_work": ["block_heading", "block_body"]},
    )

    assert updated.module_anchors[0].canvas_node_ids == ["node_heading", "node_body"]
    assert [node.module_id for node in updated.node_map] == ["mod_work", "mod_work"]


def test_anchor_mapper_keeps_canvas_node_owned_by_first_visible_module():
    now = utc_now()
    canvas = SourceResumeCanvas(
        id="canvas_1",
        document_id="doc_1",
        old_resume_source_id="src_1",
        version=1,
        source_snapshot_hash="sha256:source",
        doc_json={"type": "doc", "content": []},
        node_map=[
            SourceResumeCanvasNode(
                canvas_node_id="node_shared",
                node_type="paragraph",
                text="负责订单系统重构",
                source_block_id="src_1_0001",
            ),
        ],
        module_anchors=[],
        created_at=now,
        updated_at=now,
    )
    blocks = [
        ParsedBlock(
            id="block_shared",
            source_document_id="src_1",
            type="paragraph",
            text="负责订单系统重构",
            order=0,
            source_span={"line": 1},
        ),
    ]
    first_module = DocumentModule(
        id="mod_work",
        draft_id="draft_1",
        pack_id="resume",
        type="WorkExperience",
        title="工作经历",
        order=1,
        visibility="visible",
        status="needs_review",
        data={},
        created_at=now,
        updated_at=now,
    )
    second_module = first_module.model_copy(
        update={
            "id": "mod_project",
            "type": "ProjectExperience",
            "title": "项目经历",
            "order": 2,
        }
    )

    updated = SourceCanvasAnchorMapper().apply_module_anchors(
        canvas=canvas,
        modules=[second_module, first_module],
        parsed_blocks=blocks,
        module_source_refs={
            "mod_work": ["block_shared"],
            "mod_project": ["block_shared"],
        },
    )

    assert [anchor.module_id for anchor in updated.module_anchors] == ["mod_work"]
    assert updated.node_map[0].module_id == "mod_work"


def test_anchor_mapper_normalizes_markdown_list_and_quote_markers():
    now = utc_now()
    canvas = SourceResumeCanvas(
        id="canvas_1",
        document_id="doc_1",
        old_resume_source_id="src_1",
        version=1,
        source_snapshot_hash="sha256:source",
        doc_json={"type": "doc", "content": []},
        node_map=[
            SourceResumeCanvasNode(
                canvas_node_id="node_plus",
                node_type="list_item",
                text="项目A",
                source_block_id="src_1_0001",
            ),
            SourceResumeCanvasNode(
                canvas_node_id="node_ordered",
                node_type="list_item",
                text="项目B",
                source_block_id="src_1_0002",
            ),
            SourceResumeCanvasNode(
                canvas_node_id="node_quote",
                node_type="paragraph",
                text="项目C",
                source_block_id="src_1_0003",
            ),
        ],
        module_anchors=[],
        created_at=now,
        updated_at=now,
    )
    blocks = [
        ParsedBlock(
            id="block_plus",
            source_document_id="src_1",
            type="list",
            text="+ 项目A",
            order=0,
            source_span={"line": 1},
        ),
        ParsedBlock(
            id="block_ordered",
            source_document_id="src_1",
            type="list",
            text="1. 项目B",
            order=1,
            source_span={"line": 2},
        ),
        ParsedBlock(
            id="block_quote",
            source_document_id="src_1",
            type="paragraph",
            text="> 项目C",
            order=2,
            source_span={"line": 3},
        ),
    ]
    module = DocumentModule(
        id="mod_project",
        draft_id="draft_1",
        pack_id="resume",
        type="ProjectExperience",
        title="项目经历",
        order=1,
        visibility="visible",
        status="needs_review",
        data={},
        created_at=now,
        updated_at=now,
    )

    updated = SourceCanvasAnchorMapper().apply_module_anchors(
        canvas=canvas,
        modules=[module],
        parsed_blocks=blocks,
        module_source_refs={"mod_project": ["block_plus", "block_ordered", "block_quote"]},
    )

    assert updated.module_anchors[0].canvas_node_ids == [
        "node_plus",
        "node_ordered",
        "node_quote",
    ]
    assert [node.module_id for node in updated.node_map] == [
        "mod_project",
        "mod_project",
        "mod_project",
    ]


def test_anchor_mapper_prefers_source_span_canvas_node_id_for_nested_list_items():
    now = utc_now()
    canvas = SourceResumeCanvas(
        id="canvas_1",
        document_id="doc_1",
        old_resume_source_id="src_1",
        version=1,
        source_snapshot_hash="sha256:source",
        doc_json={"type": "doc", "content": []},
        node_map=[
            SourceResumeCanvasNode(
                canvas_node_id="node_outer",
                node_type="list_item",
                text="TypeDance初始化 source canvas",
                source_block_id="src_1_0001",
            ),
            SourceResumeCanvasNode(
                canvas_node_id="node_inner",
                node_type="list_item",
                text="初始化 source canvas",
                source_block_id="src_1_0002",
            ),
        ],
        module_anchors=[],
        created_at=now,
        updated_at=now,
    )
    blocks = [
        ParsedBlock(
            id="block_outer",
            source_document_id="src_1",
            type="list",
            text="TypeDance",
            order=0,
            source_span={"canvas_node_id": "node_outer"},
        ),
        ParsedBlock(
            id="block_inner",
            source_document_id="src_1",
            type="list",
            text="初始化 source canvas",
            order=1,
            source_span={"canvas_node_id": "node_inner"},
        ),
    ]
    module = DocumentModule(
        id="mod_project",
        draft_id="draft_1",
        pack_id="resume",
        type="ProjectExperience",
        title="项目经历",
        order=1,
        visibility="visible",
        status="needs_review",
        data={},
        created_at=now,
        updated_at=now,
    )

    updated = SourceCanvasAnchorMapper().apply_module_anchors(
        canvas=canvas,
        modules=[module],
        parsed_blocks=blocks,
        module_source_refs={"mod_project": ["block_outer", "block_inner"]},
    )

    assert updated.module_anchors[0].canvas_node_ids == ["node_outer", "node_inner"]
    assert [node.module_id for node in updated.node_map] == ["mod_project", "mod_project"]


def test_annotates_nested_list_items_with_canvas_node_ids():
    now = utc_now()
    source = SourceDocument(
        id="src_md",
        document_id="doc_1",
        source_type="old_resume",
        title="旧简历",
        raw_text="一级\n二级",
        parse_status="recognized",
        created_at=now,
    )
    doc_json = {
        "type": "doc",
        "content": [
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [{"type": "text", "text": "一级"}],
                            },
                            {
                                "type": "bulletList",
                                "content": [
                                    {
                                        "type": "listItem",
                                        "content": [
                                            {
                                                "type": "paragraph",
                                                "content": [
                                                    {"type": "text", "text": "二级"}
                                                ],
                                            }
                                        ],
                                    }
                                ],
                            },
                        ],
                    }
                ],
            }
        ],
    }

    annotated, node_map, source_hash = annotate_source_doc_json(doc_json, source)

    outer_item = annotated["content"][0]["content"][0]
    inner_item = outer_item["content"][1]["content"][0]
    assert outer_item["attrs"]["canvasNodeId"] == "node_src_md_0001"
    assert inner_item["attrs"]["canvasNodeId"] == "node_src_md_0002"
    assert [node.node_type for node in node_map] == ["list_item", "list_item"]
    assert node_map[0].source_span["node_index"] == 1
    assert node_map[1].source_span["node_index"] == 2
    assert [node.text for node in node_map] == ["一级二级", "二级"]
    assert source_hash.startswith("sha256:")
    assert "attrs" not in doc_json["content"][0]["content"][0]
    assert "attrs" not in doc_json["content"][0]["content"][0]["content"][1]["content"][0]


def test_annotate_skips_malformed_and_empty_source_nodes_without_consuming_ids():
    now = utc_now()
    source = SourceDocument(
        id="src_edge",
        document_id="doc_1",
        source_type="old_resume",
        title="旧简历",
        raw_text="有效段落",
        parse_status="recognized",
        created_at=now,
    )
    doc_json = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": 1},
            {"type": "paragraph", "content": []},
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "content": [],
                    }
                ],
            },
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": "有效段落"}],
            },
        ],
    }

    annotated, node_map, _source_hash = annotate_source_doc_json(doc_json, source)

    assert len(node_map) == 1
    assert "attrs" not in annotated["content"][0]
    assert "attrs" not in annotated["content"][1]
    assert "attrs" not in annotated["content"][2]["content"][0]
    assert annotated["content"][3]["attrs"]["canvasNodeId"] == "node_src_edge_0001"
    assert node_map[0].source_block_id == "src_edge_0001"
    assert node_map[0].source_span["node_index"] == 1
    assert node_map[0].text == "有效段落"
