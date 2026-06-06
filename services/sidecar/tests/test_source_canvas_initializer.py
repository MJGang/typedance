import pytest

from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_models import SourceDocument
from typedance_sidecar.source_canvas_initializer import (
    SourceCanvasInitializationError,
    SourceCanvasInitializer,
)


def make_source(
    *,
    raw_text: str | None,
    mime_type: str | None = None,
    original_uri: str | None = None,
) -> SourceDocument:
    return SourceDocument(
        id="src_init",
        document_id="doc_init",
        source_type="uploaded_file",
        title="旧简历",
        mime_type=mime_type,
        original_uri=original_uri,
        raw_text=raw_text,
        parse_status="pending",
        created_at=utc_now(),
    )


def test_initializes_markdown_canvas_with_nested_list_structure():
    source = make_source(
        raw_text="## 项目经历\n\n- TypeDance\n  - 初始化 source canvas",
        mime_type="text/markdown",
        original_uri="resume.md",
    )

    canvas = SourceCanvasInitializer().initialize(source)

    assert canvas.version == 1
    assert canvas.old_resume_source_id == source.id
    assert canvas.source_snapshot_hash.startswith("sha256:")
    assert canvas.module_anchors == []

    heading = canvas.doc_json["content"][0]
    list_node = canvas.doc_json["content"][1]
    outer_item = list_node["content"][0]
    inner_item = outer_item["content"][1]["content"][0]

    assert heading["type"] == "heading"
    assert heading["attrs"]["canvasNodeId"] == "node_src_init_0001"
    assert list_node["type"] == "bulletList"
    assert outer_item["type"] == "listItem"
    assert inner_item["type"] == "listItem"
    assert [node.node_type for node in canvas.node_map] == [
        "heading",
        "list_item",
        "list_item",
    ]
    assert canvas.node_map[0].text == "项目经历"
    assert canvas.node_map[2].text == "初始化 source canvas"


def test_initializes_txt_canvas_from_non_empty_lines():
    source = make_source(
        raw_text="张三\n\n工作经历\n负责订单系统重构",
        mime_type="text/plain",
        original_uri="resume.txt",
    )

    canvas = SourceCanvasInitializer().initialize(source)

    assert [node["type"] for node in canvas.doc_json["content"]] == [
        "paragraph",
        "heading",
        "paragraph",
    ]
    assert canvas.doc_json["content"][1]["attrs"]["level"] == 2
    assert [node.text for node in canvas.node_map] == [
        "张三",
        "工作经历",
        "负责订单系统重构",
    ]


@pytest.mark.parametrize("extension", ["pdf", "doc"])
def test_initializes_pdf_and_doc_raw_text_with_text_adapter(extension: str):
    source = make_source(
        raw_text="项目经历\nTypeDance\n负责源画布初始化",
        mime_type=f"application/{extension}",
        original_uri=f"resume.{extension}",
    )

    canvas = SourceCanvasInitializer().initialize(source)

    first_node = canvas.doc_json["content"][0]
    assert first_node["type"] == "heading"
    assert first_node["attrs"]["level"] == 2
    assert canvas.node_map[0].text == "项目经历"
    assert [node.text for node in canvas.node_map] == [
        "项目经历",
        "TypeDance",
        "负责源画布初始化",
    ]


def test_rejects_empty_source_content():
    source = make_source(raw_text=" \n\t", original_uri="resume.txt")

    with pytest.raises(
        SourceCanvasInitializationError,
        match="Import source has no readable content",
    ):
        SourceCanvasInitializer().initialize(source)
