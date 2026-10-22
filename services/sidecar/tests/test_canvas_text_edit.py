from copy import deepcopy

import pytest

from typedance_sidecar.canvas_text_edit import prepare_canvas_text_edit


def paragraph(text, **extra):
    return {"type": "paragraph", "content": [{"type": "text", "text": text, **extra}]}


def test_prepares_only_selected_text_and_preserves_marks_without_mutating_document():
    doc = {"type": "doc", "content": [paragraph("其他内容"), paragraph("原始表达", marks=[{"type": "bold"}])]}
    original = deepcopy(doc)
    preview = prepare_canvas_text_edit(doc, 7, 11, "原始表达", "简洁表达")
    assert preview["replacement_content"] == [{"type": "text", "text": "简洁表达", "marks": [{"type": "bold"}]}]
    assert doc == original


def test_positions_use_utf16_and_include_empty_paragraphs_and_nested_lists():
    doc = {"type": "doc", "content": [
        {"type": "paragraph"},
        {"type": "bulletList", "content": [{"type": "listItem", "content": [paragraph("😀原文")]}]},
    ]}
    preview = prepare_canvas_text_edit(doc, 7, 9, "原文", "新文")
    assert preview["original_text"] == "原文"
    assert preview["replacement_content"] == [{"type": "text", "text": "新文"}]


def test_rejects_changed_text_or_a_split_unicode_character():
    doc = {"type": "doc", "content": [paragraph("😀原文")]}
    with pytest.raises(ValueError, match="原文已修改"):
        prepare_canvas_text_edit(doc, 3, 5, "旧文", "新文")
    with pytest.raises(ValueError, match="拆开"):
        prepare_canvas_text_edit(doc, 2, 3, "😀", "表情")


def test_rejects_cross_paragraph_edits_and_keeps_paragraph_structure():
    doc = {"type": "doc", "content": [paragraph("第一段"), paragraph("第二段")]}
    with pytest.raises(ValueError, match="同一段落"):
        prepare_canvas_text_edit(doc, 1, 9, "第一段\n第二段", "合并")
    assert prepare_canvas_text_edit(doc, 1, 4, "第一段", "甲\n乙")["replacement_content"] == [
        {"type": "text", "text": "甲"}, {"type": "hardBreak"}, {"type": "text", "text": "乙"},
    ]
