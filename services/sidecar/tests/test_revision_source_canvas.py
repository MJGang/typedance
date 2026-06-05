from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_models import DocumentModule, ParsedBlock, SourceDocument
from typedance_sidecar.revision_source_canvas import SourceResumeCanvasBuilder


def test_builder_preserves_original_blocks_and_canvas_node_ids():
    now = utc_now()
    source = SourceDocument(
        id="src_1",
        document_id="doc_1",
        source_type="old_resume",
        title="旧简历",
        raw_text="张三\n工作经历\n负责订单系统重构",
        parse_status="parsed",
        created_at=now,
    )
    blocks = [
        ParsedBlock(
            id="block_1",
            source_document_id=source.id,
            type="paragraph",
            text="张三",
            order=0,
            source_span={"line": 1},
        ),
        ParsedBlock(
            id="block_2",
            source_document_id=source.id,
            type="heading",
            text="工作经历",
            order=1,
            source_span={"line": 2},
        ),
        ParsedBlock(
            id="block_3",
            source_document_id=source.id,
            type="paragraph",
            text="负责订单系统重构",
            order=2,
            source_span={"line": 3},
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

    canvas = SourceResumeCanvasBuilder().build(
        source=source,
        parsed_blocks=blocks,
        modules=[module],
        module_source_refs={"mod_work": ["block_2", "block_3"]},
    )

    assert canvas.old_resume_source_id == "src_1"
    assert canvas.doc_json["content"][0]["attrs"]["canvasNodeId"] == "node_block_1"
    assert canvas.node_map[2].text == "负责订单系统重构"
    assert canvas.node_map[2].module_id == "mod_work"
    assert canvas.module_anchors[0].canvas_node_ids == ["node_block_2", "node_block_3"]


def test_builder_includes_adjacent_heading_before_module_body():
    now = utc_now()
    source = SourceDocument(
        id="src_1",
        document_id="doc_1",
        source_type="old_resume",
        title="旧简历",
        raw_text="张三\n工作经历\n负责订单系统重构",
        parse_status="parsed",
        created_at=now,
    )
    blocks = [
        ParsedBlock(
            id="block_1",
            source_document_id=source.id,
            type="paragraph",
            text="张三",
            order=0,
            source_span={"line": 1},
        ),
        ParsedBlock(
            id="block_2",
            source_document_id=source.id,
            type="heading",
            text="工作经历",
            order=1,
            source_span={"line": 2},
        ),
        ParsedBlock(
            id="block_3",
            source_document_id=source.id,
            type="paragraph",
            text="负责订单系统重构",
            order=2,
            source_span={"line": 3},
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

    module_source_refs = {"mod_work": ["block_3"]}
    canvas = SourceResumeCanvasBuilder().build(
        source=source,
        parsed_blocks=blocks,
        modules=[module],
        module_source_refs=module_source_refs,
    )

    assert canvas.node_map[1].module_id == "mod_work"
    assert canvas.doc_json["content"][1]["attrs"]["moduleId"] == "mod_work"
    assert canvas.module_anchors[0].canvas_node_ids == ["node_block_2", "node_block_3"]
    assert module_source_refs == {"mod_work": ["block_3"]}


def test_builder_does_not_include_adjacent_heading_before_explicit_module_heading():
    now = utc_now()
    source = SourceDocument(
        id="src_1",
        document_id="doc_1",
        source_type="old_resume",
        title="旧简历",
        raw_text="工作经历\n项目经历\n负责订单系统重构",
        parse_status="parsed",
        created_at=now,
    )
    blocks = [
        ParsedBlock(
            id="work_heading",
            source_document_id=source.id,
            type="heading",
            text="工作经历",
            order=0,
            source_span={"line": 1},
        ),
        ParsedBlock(
            id="project_heading",
            source_document_id=source.id,
            type="heading",
            text="项目经历",
            order=1,
            source_span={"line": 2},
        ),
        ParsedBlock(
            id="project_body",
            source_document_id=source.id,
            type="paragraph",
            text="负责订单系统重构",
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

    canvas = SourceResumeCanvasBuilder().build(
        source=source,
        parsed_blocks=blocks,
        modules=[module],
        module_source_refs={"mod_project": ["project_heading", "project_body"]},
    )

    assert canvas.module_anchors[0].canvas_node_ids == [
        "node_project_heading",
        "node_project_body",
    ]


def test_builder_renders_markdown_list_syntax_but_keeps_original_source_text():
    now = utc_now()
    source = SourceDocument(
        id="src_1",
        document_id="doc_1",
        source_type="old_resume",
        title="旧简历",
        raw_text="- 负责订单系统重构",
        parse_status="parsed",
        created_at=now,
    )
    block = ParsedBlock(
        id="block_1",
        source_document_id=source.id,
        type="list",
        text="- 负责订单系统重构",
        order=0,
        source_span={"line": 1},
    )

    canvas = SourceResumeCanvasBuilder().build(
        source=source,
        parsed_blocks=[block],
        modules=[],
        module_source_refs={},
    )

    paragraph = canvas.doc_json["content"][0]["content"][0]["content"][0]
    assert paragraph["content"][0]["text"] == "负责订单系统重构"
    assert canvas.node_map[0].text == "- 负责订单系统重构"


def test_builder_renders_markdown_heading_bold_and_divider_syntax():
    now = utc_now()
    source = SourceDocument(
        id="src_1",
        document_id="doc_1",
        source_type="old_resume",
        title="旧简历",
        raw_text="## 核心能力\n- **前端架构**: Vue\n---",
        parse_status="parsed",
        created_at=now,
    )
    blocks = [
        ParsedBlock(
            id="block_heading",
            source_document_id=source.id,
            type="heading",
            text="## 核心能力",
            order=0,
            source_span={"line": 1},
        ),
        ParsedBlock(
            id="block_list",
            source_document_id=source.id,
            type="list",
            text="- **前端架构**: Vue",
            order=1,
            source_span={"line": 2},
        ),
        ParsedBlock(
            id="block_rule",
            source_document_id=source.id,
            type="paragraph",
            text="---",
            order=2,
            source_span={"line": 3},
        ),
    ]
    module = DocumentModule(
        id="mod_skills",
        draft_id="draft_1",
        pack_id="resume",
        type="CoreSkills",
        title="核心能力",
        order=1,
        visibility="visible",
        status="needs_review",
        data={},
        created_at=now,
        updated_at=now,
    )

    canvas = SourceResumeCanvasBuilder().build(
        source=source,
        parsed_blocks=blocks,
        modules=[module],
        module_source_refs={"mod_skills": ["block_heading", "block_list"]},
    )

    heading = canvas.doc_json["content"][0]
    list_paragraph = canvas.doc_json["content"][1]["content"][0]["content"][0]
    divider = canvas.doc_json["content"][2]

    assert heading["type"] == "heading"
    assert heading["attrs"]["canvasNodeId"] == "node_block_heading"
    assert heading["content"][0]["text"] == "核心能力"
    assert list_paragraph["content"] == [
        {"type": "text", "text": "前端架构", "marks": [{"type": "bold"}]},
        {"type": "text", "text": ": Vue"},
    ]
    assert divider["type"] == "horizontalRule"
    assert divider["attrs"]["canvasNodeId"] == "node_block_rule"


def test_builder_filters_module_anchors_to_current_source_blocks():
    now = utc_now()
    source = SourceDocument(
        id="src_1",
        document_id="doc_1",
        source_type="old_resume",
        title="旧简历",
        raw_text="工作经历",
        parse_status="parsed",
        created_at=now,
    )
    block = ParsedBlock(
        id="block_1",
        source_document_id=source.id,
        type="heading",
        text="工作经历",
        order=0,
        source_span={"line": 1},
    )
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

    canvas = SourceResumeCanvasBuilder().build(
        source=source,
        parsed_blocks=[block],
        modules=[module],
        module_source_refs={"mod_work": ["block_1", "block_other_source"]},
    )

    assert canvas.module_anchors[0].canvas_node_ids == ["node_block_1"]
    assert "node_block_other_source" not in canvas.module_anchors[0].canvas_node_ids
