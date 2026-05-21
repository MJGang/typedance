from typedance_sidecar.db import ResumeRepository, TemplateStyleRepository, connect
from typedance_sidecar.models import ResumeVersion, TemplateStyleConfig
from typedance_sidecar.revision_legacy_adapter import LegacyResumeAdapterService
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.revision_services import WorkspaceService


def test_legacy_resume_projects_to_revision_workspace(tmp_path):
    connection = connect(tmp_path / "typedance.sqlite")
    resume_repo = ResumeRepository(connection)
    style_repo = TemplateStyleRepository(connection)
    revision_repo = RevisionRepository(connection)
    resume = resume_repo.save(
        ResumeVersion(
            id="resume_legacy",
            title="旧简历",
            template_id="classic-a4",
            target_language="zh-CN",
            doc_json={
                "type": "doc",
                "content": [
                    {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "张三"}]},
                    {"type": "paragraph", "content": [{"type": "text", "text": "前端工程师"}]},
                    {
                        "type": "bulletList",
                        "content": [
                            {
                                "type": "listItem",
                                "content": [
                                    {
                                        "type": "paragraph",
                                        "content": [{"type": "text", "text": "负责订单系统重构"}],
                                    }
                                ],
                            }
                        ],
                    },
                ],
            },
            plain_text_snapshot="张三\n前端工程师\n负责订单系统重构",
            created_at="2026-05-21T08:00:00.000Z",
            updated_at="2026-05-21T08:00:00.000Z",
        )
    )
    style_repo.save(
        TemplateStyleConfig(
            template_id="classic-a4",
            blocks={"paragraph": {"fontSize": "11px"}},
            updated_at="2026-05-21T08:00:00.000Z",
        )
    )

    document = LegacyResumeAdapterService(revision_repo, resume_repo, style_repo).project_resume_version(resume.id)

    workspace = WorkspaceService(revision_repo).get_workspace_view(document.id)
    assert workspace.document.id == "doc_legacy_resume_legacy"
    assert workspace.current_draft is not None
    assert workspace.current_draft.status == "accepted"
    assert workspace.render_projection is not None
    assert workspace.render_projection.doc_json == resume.doc_json
    assert workspace.render_projection.render_profile == "legacy-classic-a4"
    assert "负责订单系统重构" in (workspace.render_projection.html or "")
    assert {module.type for module in workspace.modules} == {"BasicInfo", "LegacyContent"}
    assert workspace.claims
    assert workspace.evidence


def test_legacy_projection_creates_new_draft_when_legacy_resume_changes(tmp_path):
    connection = connect(tmp_path / "typedance.sqlite")
    resume_repo = ResumeRepository(connection)
    style_repo = TemplateStyleRepository(connection)
    revision_repo = RevisionRepository(connection)
    service = LegacyResumeAdapterService(revision_repo, resume_repo, style_repo)
    resume = ResumeVersion(
        id="resume_legacy",
        title="旧简历",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={"type": "doc", "content": []},
        plain_text_snapshot="第一版",
        created_at="2026-05-21T08:00:00.000Z",
        updated_at="2026-05-21T08:00:00.000Z",
    )

    first = service.project_resume_version(resume_repo.save(resume).id)
    second_resume = resume.model_copy(
        update={
            "plain_text_snapshot": "第二版",
        }
    )
    second = service.project_resume_version(resume_repo.save(second_resume).id)

    assert first.id == second.id
    assert first.current_draft_id != second.current_draft_id
    assert revision_repo.get_document(first.id).current_draft_id == second.current_draft_id
