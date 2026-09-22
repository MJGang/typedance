from pathlib import Path

from fixtures.heading2_styles import template_style_payload
from typedance_sidecar.db import connect
from typedance_sidecar.models import TemplateStyleConfig, utc_now
from typedance_sidecar.revision_export import RevisionExportService
from typedance_sidecar.revision_models import (
    Document,
    DraftVersion,
    RevisionIssue,
    SourceDocument,
    SourceResumeCanvas,
)
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.source_canvas_doc_json import source_canvas_hash


def make_repository(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def canvas_doc_json(text: str) -> dict:
    return {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "attrs": {"canvasNodeId": "node_export", "sourceBlockId": "block_export"},
                "content": [{"type": "text", "text": text}],
            }
        ],
    }


def seed_export_workspace(
    repo: RevisionRepository,
    *,
    issue_severity: str | None = None,
    with_draft: bool = True,
) -> tuple[Document, DraftVersion | None]:
    now = utc_now()
    document = repo.save_document(
        Document(
            id="doc_export",
            pack_id="resume",
            title="当前画布简历",
            template_id="classic-a4",
            status="active",
            target_language="zh-CN",
            current_draft_id="draft_export",
            created_at=now,
            updated_at=now,
        )
    )
    source = repo.save_source_document(
        SourceDocument(
            id="src_export",
            document_id=document.id,
            source_type="old_resume",
            title="旧简历",
            raw_text="当前画布内容",
            parse_status="recognized",
            created_at=now,
        )
    )
    doc_json = canvas_doc_json("当前画布内容")
    repo.save_source_resume_canvas(
        SourceResumeCanvas(
            id="canvas_export",
            document_id=document.id,
            old_resume_source_id=source.id,
            version=1,
            source_snapshot_hash=source_canvas_hash(doc_json),
            doc_json=doc_json,
            node_map=[
                {
                    "canvas_node_id": "node_export",
                    "source_block_id": "block_export",
                    "node_type": "paragraph",
                    "text": "当前画布内容",
                    "source_span": {"line": 1},
                    "module_id": "mod_export",
                }
            ],
            module_anchors=[
                {
                    "module_id": "mod_export",
                    "canvas_node_ids": ["node_export"],
                    "title": "项目经历",
                    "order": 0,
                }
            ],
            created_at=now,
            updated_at=now,
        )
    )
    run_id = "hrun_export"
    if not with_draft:
        return document, None

    draft = repo.save_draft_version(
        DraftVersion(
            id="draft_export",
            document_id=document.id,
            run_id=run_id,
            pack_id=document.pack_id,
            status="accepted",
            summary="当前草稿",
            created_at=now,
            updated_at=now,
        )
    )
    if issue_severity is not None:
        repo.save_revision_issue(
            RevisionIssue(
                id=f"issue_{issue_severity}",
                run_id=run_id,
                document_id=document.id,
                draft_id=draft.id,
                type="missing_result",
                severity=issue_severity,
                title="仍需处理",
                message="当前问题不影响文件导出。",
                reason="质量检查与导出互不阻塞。",
                status="open",
                created_by_agent="ResumeReviewer",
                created_at=now,
            )
        )
    return document, draft


def fake_pdf_renderer(html: str, output_path: Path, page_margin: dict[str, str] | None = None) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(b"%PDF-1.4\n")
    assert "当前画布内容" in html
    return output_path


def test_revision_export_writes_pdf_from_current_canvas_and_page_margins(tmp_path):
    repo = make_repository(tmp_path)
    document, draft = seed_export_workspace(repo)
    rendered: list[tuple[str, dict[str, str] | None]] = []

    def recording_pdf_renderer(html: str, output_path: Path, page_margin: dict[str, str] | None = None) -> Path:
        rendered.append((html, page_margin))
        return fake_pdf_renderer(html, output_path, page_margin)

    artifact = RevisionExportService(
        repo,
        output_dir=tmp_path / "exports",
        pdf_renderer=recording_pdf_renderer,
    ).export_pdf(
        document.id,
        page_margins={"top": 88, "bottom": 72, "left": 42, "right": 48},
        template_style=TemplateStyleConfig.model_validate({
            **template_style_payload(),
            "blocks": {
                **template_style_payload()["blocks"],
                "paragraph": {"fontSize": "15px", "color": "#123456"},
            },
        }),
    )

    assert len(rendered) == 1
    assert rendered[0][1] == {"top": "88px", "bottom": "72px", "left": "42px", "right": "48px"}
    assert "font-size: 15px" in rendered[0][0]
    assert "#123456" in rendered[0][0]
    assert "td-module-interaction-layer" not in rendered[0][0]
    assert "模块大纲" not in rendered[0][0]
    assert artifact.status == "succeeded"
    assert artifact.file_path is not None
    assert Path(artifact.file_path).exists()
    assert repo.list_export_artifacts(document.id) == [artifact]
    assert draft is not None
    exported_draft = repo.get_draft_version(draft.id)
    assert exported_draft is not None
    assert exported_draft.status == "accepted"
    assert exported_draft.render_projection_id is None


def test_revision_export_ignores_open_issues(tmp_path):
    repo = make_repository(tmp_path)
    document, _draft = seed_export_workspace(repo, issue_severity="blocking")

    artifact = RevisionExportService(
        repo,
        output_dir=tmp_path / "exports",
        pdf_renderer=fake_pdf_renderer,
    ).export_pdf(document.id)

    assert artifact.status == "succeeded"
    assert artifact.file_path is not None
    assert Path(artifact.file_path).exists()


def test_revision_export_uses_request_canvas_snapshot(tmp_path):
    repo = make_repository(tmp_path)
    document, _draft = seed_export_workspace(repo)
    rendered_html: list[str] = []

    def recording_pdf_renderer(html: str, output_path: Path, page_margin: dict[str, str] | None = None) -> Path:
        rendered_html.append(html)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"%PDF-1.4\n")
        return output_path

    artifact = RevisionExportService(
        repo,
        output_dir=tmp_path / "exports",
        pdf_renderer=recording_pdf_renderer,
    ).export_pdf(document.id, source_doc_json=canvas_doc_json("未保存的当前画布"))

    assert artifact.file_path is not None
    assert "未保存的当前画布" in rendered_html[0]
    assert "当前画布内容" not in rendered_html[0]


def test_revision_export_writes_html_with_current_style_and_page_margins(tmp_path):
    repo = make_repository(tmp_path)
    document, _draft = seed_export_workspace(repo)

    artifact = RevisionExportService(
        repo,
        output_dir=tmp_path / "exports",
        pdf_renderer=fake_pdf_renderer,
    ).export_html(
        document.id,
        page_margins={"top": 88, "bottom": 72, "left": 42, "right": 48},
        template_style=TemplateStyleConfig.model_validate({
            **template_style_payload(),
            "blocks": {
                **template_style_payload()["blocks"],
                "paragraph": {"fontSize": "15px", "color": "#123456"},
            },
        }),
    )

    assert artifact.format == "html"
    assert artifact.file_path is not None
    html = Path(artifact.file_path).read_text(encoding="utf-8")
    assert "当前画布内容" in html
    assert "font-size: 15px" in html
    assert "#123456" in html
    assert "td-export-content" in html
    assert "data-td-export-pages" not in html
    assert "padding: 88px 48px 72px 42px;" in html
    assert "@page {\n    size: A4;\n    margin: 88px 48px 72px 42px;" in html


def test_revision_export_allows_source_canvas_before_draft_exists(tmp_path):
    repo = make_repository(tmp_path)
    document, draft = seed_export_workspace(repo, with_draft=False)
    rendered_html: list[str] = []

    def recording_pdf_renderer(html: str, output_path: Path, page_margin: dict[str, str] | None = None) -> Path:
        rendered_html.append(html)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"%PDF-1.4\n")
        return output_path

    artifact = RevisionExportService(
        repo,
        output_dir=tmp_path / "exports",
        pdf_renderer=recording_pdf_renderer,
    ).export_pdf(document.id)

    assert draft is None
    assert artifact.draft_id is None
    assert artifact.status == "succeeded"
    assert artifact.file_path is not None
    assert "当前画布内容" in rendered_html[0]
