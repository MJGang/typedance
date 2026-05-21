import pytest

from typedance_sidecar.db import connect
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_models import DocumentModule, DraftVersion
from typedance_sidecar.revision_render_projection import DraftProjectionBuilder, RenderProjectionError
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.revision_services import RenderService


def make_draft() -> DraftVersion:
    now = utc_now()
    return DraftVersion(
        id="draft_1",
        document_id="doc_1",
        run_id="run_1",
        pack_id="resume",
        status="in_review",
        summary="结构化草稿",
        created_at=now,
        updated_at=now,
    )


def make_module(
    module_id: str,
    module_type: str,
    title: str,
    order: int,
    data: dict,
    *,
    visibility: str = "visible",
    status: str = "clean",
) -> DocumentModule:
    now = utc_now()
    return DocumentModule(
        id=module_id,
        draft_id="draft_1",
        pack_id="resume",
        type=module_type,
        title=title,
        order=order,
        visibility=visibility,
        status=status,
        data=data,
        created_at=now,
        updated_at=now,
    )


def sample_modules() -> list[DocumentModule]:
    return [
        make_module(
            "mod_basic",
            "BasicInfo",
            "基本信息",
            0,
            {
                "name": "张三",
                "headline": "前端工程师",
                "phone": "13800000000",
                "email": "zhangsan@example.com",
            },
        ),
        make_module(
            "mod_project",
            "ProjectExperience",
            "项目经历",
            1,
            {
                "items": [
                    {
                        "title": "订单系统重构",
                        "role": "核心开发",
                        "time_range": "2024.01 - 2024.06",
                        "description": "负责核心链路重构。",
                        "bullets": ["拆分结算模块", "降低发布风险"],
                    }
                ]
            },
        ),
        make_module(
            "mod_hidden",
            "SelfEvaluation",
            "自我评价",
            2,
            {"items": ["隐藏内容"]},
            visibility="hidden",
        ),
    ]


def test_projection_builder_renders_visible_modules_to_html_and_doc_json():
    projection = DraftProjectionBuilder().build(make_draft(), sample_modules())

    assert projection.render_profile == "default-a4"
    assert projection.html is not None
    assert "张三" in projection.html
    assert "订单系统重构" in projection.html
    assert "自我评价" not in projection.html
    assert projection.doc_json["type"] == "doc"
    assert projection.doc_json["content"][0]["type"] == "heading"
    assert projection.doc_json["content"][0]["attrs"]["level"] == 1
    assert projection.layout_warnings == []


def test_projection_builder_rejects_unsupported_profile():
    with pytest.raises(RenderProjectionError, match="Unsupported render profile"):
        DraftProjectionBuilder().build(
            make_draft(),
            sample_modules(),
            render_profile="poster",
        )


def test_projection_builder_warns_for_empty_or_unready_drafts():
    warning_module = make_module(
        "mod_skills",
        "CoreSkills",
        "核心技能",
        0,
        {"items": ["Vue", "TypeScript"]},
        status="needs_confirmation",
    )
    projection = DraftProjectionBuilder().build(make_draft(), [warning_module])
    empty_projection = DraftProjectionBuilder().build(make_draft(), [])

    assert any(item["code"] == "module_needs_attention" for item in projection.layout_warnings)
    assert any(item["code"] == "empty_draft" for item in empty_projection.layout_warnings)


def test_projection_builder_warns_for_long_content():
    long_text = "负责订单系统重构。" * 400
    long_module = make_module(
        "mod_project",
        "ProjectExperience",
        "项目经历",
        0,
        {"items": [{"title": "订单系统", "description": long_text}]},
    )

    projection = DraftProjectionBuilder().build(
        make_draft(),
        [long_module],
        render_profile="compact-a4",
    )

    assert any(item["code"] == "content_may_overflow" for item in projection.layout_warnings)


def test_render_service_saves_projection_and_updates_draft(tmp_path):
    repo = RevisionRepository(connect(tmp_path / "typedance.sqlite"))
    draft = repo.save_draft_version(make_draft())
    for module in sample_modules():
        repo.save_document_module(module)

    projection = RenderService(repo).build_projection_for_draft(draft.id)
    updated_draft = repo.get_draft_version(draft.id)

    assert repo.get_render_projection(projection.id) == projection
    assert updated_draft is not None
    assert updated_draft.render_projection_id == projection.id
