import zipfile
from pathlib import Path

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
    file_path: str | None = None,
    title: str = "旧简历",
    source_type: str = "uploaded_file",
) -> SourceDocument:
    return SourceDocument(
        id="src_init",
        document_id="doc_init",
        source_type=source_type,
        title=title,
        mime_type=mime_type,
        original_uri=original_uri,
        file_path=file_path,
        raw_text=raw_text,
        parse_status="pending",
        created_at=utc_now(),
    )


def write_minimal_docx(path: Path, document_xml: str) -> Path:
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""
    relationships = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", relationships)
        archive.writestr("word/document.xml", document_xml)
    return path


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


def test_detects_untyped_markdown_canvas_with_nested_list_structure():
    source = make_source(
        raw_text="## 项目经历\n\n- TypeDance\n  - 初始化 source canvas",
    )

    canvas = SourceCanvasInitializer().initialize(source)

    heading = canvas.doc_json["content"][0]
    list_node = canvas.doc_json["content"][1]
    outer_item = list_node["content"][0]
    inner_list = outer_item["content"][1]

    assert heading["type"] == "heading"
    assert list_node["type"] == "bulletList"
    assert outer_item["type"] == "listItem"
    assert inner_list["type"] == "bulletList"
    assert inner_list["content"][0]["type"] == "listItem"


def test_detects_pasted_text_plain_markdown_with_nested_list_structure():
    source = make_source(
        raw_text="## 项目经历\n\n- TypeDance\n  - 初始化 source canvas",
        mime_type="text/plain",
        source_type="old_resume",
    )

    canvas = SourceCanvasInitializer().initialize(source)

    heading = canvas.doc_json["content"][0]
    list_node = canvas.doc_json["content"][1]
    outer_item = list_node["content"][0]

    assert heading["type"] == "heading"
    assert list_node["type"] == "bulletList"
    assert outer_item["content"][1]["type"] == "bulletList"


def test_prefers_known_markdown_extension_over_earlier_unknown_extension():
    source = make_source(
        raw_text="## 项目经历\n\n- TypeDance",
        file_path="cache.tmp",
        original_uri="resume.md",
    )

    canvas = SourceCanvasInitializer().initialize(source)

    assert [node["type"] for node in canvas.doc_json["content"]] == [
        "heading",
        "bulletList",
    ]


def test_initializes_txt_markdown_like_text_with_text_adapter():
    source = make_source(
        raw_text="## 项目经历\n\n- TypeDance",
        mime_type="text/plain",
        original_uri="resume.txt",
    )

    canvas = SourceCanvasInitializer().initialize(source)

    assert [node["type"] for node in canvas.doc_json["content"]] == [
        "paragraph",
        "paragraph",
    ]


@pytest.mark.parametrize(
    "raw_text",
    [
        "## 项目经历",
        "- TypeDance",
        "1. 负责优化",
        "> 求职目标",
    ],
)
def test_detects_common_multichar_markdown_syntax(raw_text: str):
    assert SourceCanvasInitializer()._looks_like_markdown(raw_text)


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


@pytest.mark.parametrize(
    ("mime_type", "original_uri", "raw_text", "expected_text"),
    [
        (
            "application/pdf",
            "resume.pdf",
            "项目经历\n\n- 负责支付系统优化",
            "- 负责支付系统优化",
        ),
        (
            "application/msword",
            "resume.doc",
            "项目经历\n\n1. 负责支付系统优化",
            "1. 负责支付系统优化",
        ),
    ],
)
def test_initializes_pdf_and_doc_raw_text_with_text_adapter(
    monkeypatch: pytest.MonkeyPatch,
    mime_type: str,
    original_uri: str,
    raw_text: str,
    expected_text: str,
):
    monkeypatch.setattr(
        SourceCanvasInitializer,
        "_looks_like_markdown",
        lambda self, raw_text: True,
    )
    source = make_source(
        raw_text=raw_text,
        mime_type=mime_type,
        original_uri=original_uri,
    )

    canvas = SourceCanvasInitializer().initialize(source)

    assert [node["type"] for node in canvas.doc_json["content"]] == [
        "heading",
        "paragraph",
    ]
    assert canvas.doc_json["content"][0]["attrs"]["level"] == 2
    assert canvas.doc_json["content"][1]["content"][0]["text"] == expected_text
    assert canvas.node_map[0].text == "项目经历"
    assert [node.text for node in canvas.node_map] == [
        "项目经历",
        expected_text,
    ]


def test_initializer_preserves_docx_heading_list_and_bold(tmp_path: Path):
    docx_path = write_minimal_docx(
        tmp_path / "resume.docx",
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>项目经历</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:r><w:rPr><w:b/></w:rPr><w:t>架构升级</w:t></w:r>
      <w:r><w:t>：Monorepo</w:t></w:r>
    </w:p>
  </w:body>
</w:document>
""",
    )
    source = make_source(
        raw_text=None,
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        original_uri="resume.docx",
        file_path=str(docx_path),
    )

    canvas = SourceCanvasInitializer().initialize(source)

    heading = canvas.doc_json["content"][0]
    list_node = canvas.doc_json["content"][1]
    list_item = list_node["content"][0]
    list_paragraph = list_item["content"][0]
    bold_text = list_paragraph["content"][0]
    plain_text = list_paragraph["content"][1]

    assert heading["type"] == "heading"
    assert heading["attrs"]["level"] == 1
    assert heading["content"][0]["text"] == "项目经历"
    assert list_node["type"] == "bulletList"
    assert list_item["type"] == "listItem"
    assert bold_text == {
        "type": "text",
        "marks": [{"type": "bold"}],
        "text": "架构升级",
    }
    assert plain_text == {"type": "text", "text": "：Monorepo"}
    assert [node.node_type for node in canvas.node_map] == ["heading", "list_item"]
    assert canvas.node_map[1].text == "架构升级：Monorepo"


def test_initializer_preserves_docx_nested_list_levels(tmp_path: Path):
    docx_path = write_minimal_docx(
        tmp_path / "resume.docx",
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:r><w:t>TypeDance</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:r><w:t>source canvas 初始化</w:t></w:r>
    </w:p>
  </w:body>
</w:document>
""",
    )
    source = make_source(
        raw_text="fallback raw text should not be used",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        original_uri="resume.docx",
        file_path=str(docx_path),
    )

    canvas = SourceCanvasInitializer().initialize(source)

    list_node = canvas.doc_json["content"][0]
    outer_item = list_node["content"][0]
    inner_list = outer_item["content"][1]
    inner_item = inner_list["content"][0]

    assert list_node["type"] == "bulletList"
    assert outer_item["content"][0]["content"][0]["text"] == "TypeDance"
    assert inner_list["type"] == "bulletList"
    assert inner_item["content"][0]["content"][0]["text"] == "source canvas 初始化"
    assert [node.node_type for node in canvas.node_map] == ["list_item", "list_item"]
    assert canvas.node_map[1].text == "source canvas 初始化"


def test_initializer_returns_empty_paragraph_for_empty_docx(tmp_path: Path):
    docx_path = write_minimal_docx(
        tmp_path / "empty.docx",
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>   </w:t></w:r></w:p>
  </w:body>
</w:document>
""",
    )
    source = make_source(
        raw_text=None,
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        original_uri="empty.docx",
        file_path=str(docx_path),
    )

    canvas = SourceCanvasInitializer().initialize(source)

    assert canvas.doc_json["content"] == [{"type": "paragraph"}]
    assert canvas.node_map == []


def test_initializer_rejects_docx_without_saved_file_path():
    source = make_source(
        raw_text=None,
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        original_uri="resume.docx",
    )

    with pytest.raises(
        SourceCanvasInitializationError,
        match="DOCX source has no saved file path",
    ):
        SourceCanvasInitializer().initialize(source)


def test_rejects_empty_source_content():
    source = make_source(raw_text=" \n\t", original_uri="resume.txt")

    with pytest.raises(
        SourceCanvasInitializationError,
        match="Import source has no readable content",
    ):
        SourceCanvasInitializer().initialize(source)
