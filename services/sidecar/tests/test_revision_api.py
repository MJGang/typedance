import pytest
from pathlib import Path
from fastapi.testclient import TestClient

from fixtures.heading2_styles import template_style_payload
from typedance_sidecar.db import connect
from typedance_sidecar.main import app
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_models import (
    Document,
    DocumentClaim,
    DocumentModule,
    DraftVersion,
    EvidenceLink,
    RevisionIssue,
    RevisionProposal,
    SourceDocument,
    SourceResumeCanvas,
)
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.source_canvas_doc_json import source_canvas_hash


@pytest.fixture
def revision_client(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    return TestClient(app), tmp_path


def repo_for(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def test_create_blank_resume_initializes_an_editable_empty_canvas(revision_client):
    client, _ = revision_client
    response = client.post("/documents", json={"title": "未命名简历", "initial_mode": "blank"})
    assert response.status_code == 201
    document_id = response.json()["id"]
    workspace = client.get(f"/documents/{document_id}/workspace-view").json()
    assert workspace["document"]["title"] == "未命名简历"
    assert workspace.get("current_draft") is None
    canvas = workspace["source_resume_canvas"]
    assert canvas["doc_json"]["content"][0]["type"] == "paragraph"
    assert "content" not in canvas["doc_json"]["content"][0]
    assert canvas["node_map"][0]["text"] == ""
    assert workspace["source_summaries"][0]["raw_text"] == ""
    saved = client.put(f"/documents/{document_id}/source-resume-canvas", json={"doc_json": {
        "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "我的第一段经历"}]}],
    }})
    assert saved.status_code == 200
    reloaded = client.get(f"/documents/{document_id}/workspace-view").json()
    assert reloaded["source_resume_canvas"]["doc_json"] == saved.json()["doc_json"]


def seed_workspace(tmp_path) -> RevisionRepository:
    now = utc_now()
    repo = repo_for(tmp_path)
    document = repo.save_document(
        Document(
            id="doc_1",
            pack_id="resume",
            title="张三的简历",
            template_id="classic-a4",
            status="active",
            target_language="zh-CN",
            current_draft_id="draft_1",
            created_at=now,
            updated_at=now,
        )
    )
    source = repo.save_source_document(
        SourceDocument(
            id="src_1",
            document_id=document.id,
            source_type="old_resume",
            title="旧简历",
            raw_text="负责订单系统重构",
            parse_status="recognized",
            created_at=now,
        )
    )
    repo.save_source_resume_canvas(
        SourceResumeCanvas(
            id="canvas_1",
            document_id=document.id,
            old_resume_source_id=source.id,
            version=1,
            source_snapshot_hash="sha256:old",
            doc_json={"type": "doc", "content": []},
            node_map=[
                {
                    "canvas_node_id": "node_1",
                    "source_block_id": "blk_1",
                    "node_type": "paragraph",
                    "text": "负责订单系统重构",
                    "source_span": {"line": 1},
                    "module_id": "mod_1",
                }
            ],
            module_anchors=[
                {
                    "module_id": "mod_1",
                    "canvas_node_ids": ["node_1"],
                    "title": "项目经历",
                    "order": 0,
                }
            ],
            created_at=now,
            updated_at=now,
        )
    )
    run_id = "hrun_1"
    draft = repo.save_draft_version(
        DraftVersion(
            id="draft_1",
            document_id=document.id,
            run_id=run_id,
            pack_id=document.pack_id,
            status="in_review",
            summary="结构化草稿",
            unresolved_issue_ids=["issue_1"],
            created_at=now,
            updated_at=now,
        )
    )
    module = repo.save_document_module(
        DocumentModule(
            id="mod_1",
            draft_id=draft.id,
            pack_id=document.pack_id,
            type="ProjectExperience",
            title="项目经历",
            order=0,
            visibility="visible",
            status="needs_review",
            data={
                "items": [
                    {
                        "title": "订单系统重构",
                        "role": "核心开发",
                        "description": "负责核心链路重构。",
                    }
                ]
            },
            created_at=now,
            updated_at=now,
        )
    )
    claim = repo.save_document_claim(
        DocumentClaim(
            id="claim_1",
            draft_id=draft.id,
            module_id=module.id,
            text="负责订单系统重构",
            claim_type="responsibility",
            confidence="inferred",
            created_at=now,
            updated_at=now,
        )
    )
    evidence = repo.save_evidence_link(
        EvidenceLink(
            id="ev_1",
            document_id=document.id,
            source_document_id=source.id,
            claim_id=claim.id,
            support_level="partial",
            confidence=0.7,
            user_confirmed=False,
            created_at=now,
        )
    )
    issue = repo.save_revision_issue(
        RevisionIssue(
            id="issue_1",
            run_id=run_id,
            document_id=document.id,
            draft_id=draft.id,
            module_id=module.id,
            claim_id=claim.id,
            type="missing_result",
            severity="warning",
            title="缺少结果",
            message="这条经历看不出业务结果。",
            reason="需要补充影响范围。",
            status="open",
            created_by_agent="ResumeReviewer",
            evidence_link_ids=[evidence.id],
            created_at=now,
        )
    )
    repo.save_revision_proposal(
        RevisionProposal(
            id="prop_1",
            run_id=run_id,
            document_id=document.id,
            draft_id=draft.id,
            target={"claim_id": claim.id},
            operation="replace_claim",
            original_snapshot={"text": claim.text},
            proposed_snapshot={"text": "主导订单系统重构，提升核心链路稳定性。"},
            summary="改成结果导向表达",
            rationale="原文只有动作。",
            related_issue_ids=[issue.id],
            evidence_link_ids=[evidence.id],
            confidence=0.8,
            risk_level="medium",
            requires_user_confirmation=True,
            status="pending",
            created_by_agent="ResumeRewriter",
            created_at=now,
        )
    )
    return repo


def test_revision_api_creates_document_and_source(revision_client):
    client, _tmp_path = revision_client

    created_document = client.post(
        "/documents",
        json={
            "title": "张三的简历",
            "pack_id": "resume",
            "target_language": "zh-CN",
            "initial_mode": "import_old_resume",
        },
    )
    assert created_document.status_code == 201
    document = created_document.json()
    assert document["id"].startswith("doc_")
    assert document["template_id"] == "classic-a4"

    assert client.get(f"/documents/{document['id']}").json()["title"] == "张三的简历"
    assert client.get("/documents").json()[0]["id"] == document["id"]

    created_source = client.post(
        f"/documents/{document['id']}/sources",
        json={
            "source_type": "pasted_text",
            "title": "粘贴旧简历",
            "raw_text": "## 项目经历\n\n- **订单系统**: 重构",
            "mime_type": "text/markdown; charset=utf-8",
        },
    )
    assert created_source.status_code == 201
    source = created_source.json()
    assert source["document_id"] == document["id"]
    assert source["parse_status"] == "initialized"
    assert source["metadata"]["initializer_adapter"] == "markdown"
    assert client.get(f"/documents/{document['id']}/sources").json()[0]["id"] == source["id"]

    workspace_after_source = client.get(f"/documents/{document['id']}/workspace-view").json()
    canvas = workspace_after_source["source_resume_canvas"]
    assert canvas["old_resume_source_id"] == source["id"]
    assert canvas["doc_json"]["content"][0]["type"] == "heading"
    assert canvas["version"] == 1
    assert "current_draft" not in workspace_after_source
    assert "render_projection" not in workspace_after_source

def test_revision_api_creates_uploaded_resume_source(revision_client, monkeypatch):
    client, tmp_path = revision_client

    created_document = client.post(
        "/documents",
        json={
            "title": "张三的简历",
            "pack_id": "resume",
            "target_language": "zh-CN",
            "initial_mode": "import_old_resume",
        },
    )
    document = created_document.json()

    monkeypatch.setattr(
        "typedance_sidecar.revision_api.extract_import_resume_file_text",
        lambda data, filename, mime_type=None: f"extracted from {filename}: {data.decode()}",
    )

    created_source = client.post(
        f"/documents/{document['id']}/sources/import-file",
        files={"file": ("resume.md", b"# resume import", "text/markdown")},
    )

    assert created_source.status_code == 201
    source = created_source.json()
    assert source["document_id"] == document["id"]
    assert source["source_type"] == "old_resume"
    assert source["title"] == "resume.md"
    assert source["mime_type"] == "text/markdown"
    assert source["original_uri"] == "resume.md"
    assert source["raw_text"] == "extracted from resume.md: # resume import"
    assert source["file_path"].endswith("resume.md")
    assert source["parse_status"] == "initialized"
    assert source["metadata"]["import_extension"] == "md"
    workspace = client.get(f"/documents/{document['id']}/workspace-view").json()
    assert workspace["source_resume_canvas"]["old_resume_source_id"] == source["id"]
    assert (tmp_path / "files" / "sources" / document["id"] / "resume.md").read_bytes() == b"# resume import"


def test_revision_api_returns_workspace_and_renders_draft(revision_client):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)

    workspace_response = client.get("/documents/doc_1/workspace-view")
    assert workspace_response.status_code == 200
    workspace = workspace_response.json()
    assert workspace["document"]["id"] == "doc_1"
    assert workspace["current_draft"]["id"] == "draft_1"
    assert workspace["modules"][0]["id"] == "mod_1"
    assert workspace["source_resume_canvas"]["id"] == "canvas_1"
    assert workspace["coach_summary"]["summary"] == "还有 1 个问题建议处理。"
    assert [action["action_type"] for action in workspace["available_actions"]] == [
        "dismiss_issue",
        "accept_proposal",
        "reject_proposal",
    ]

    render_response = client.post("/drafts/draft_1/render", json={"render_profile": "default-a4"})
    assert render_response.status_code == 201
    projection = render_response.json()
    assert "订单系统重构" in projection["html"]
    assert projection["doc_json"]["type"] == "doc"

    draft = client.get("/drafts/draft_1").json()
    assert draft["render_projection_id"] == projection["id"]

    accepted = client.post("/drafts/draft_1/accept")
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"


def test_revision_api_updates_document_title(revision_client):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)
    previous = repo_for(tmp_path).get_document("doc_1")

    response = client.patch("/documents/doc_1", json={"title": "  前端负责人简历  "})

    assert response.status_code == 200
    payload = response.json()
    assert payload["title"] == "前端负责人简历"
    assert payload["current_draft_id"] == "draft_1"
    assert payload["updated_at"] >= previous.updated_at
    assert repo_for(tmp_path).get_document("doc_1").title == "前端负责人简历"


def test_revision_api_updates_document_template_without_changing_title(revision_client):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)

    response = client.patch(
        "/documents/doc_1",
        json={"template_id": "custom-theme-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["template_id"] == "custom-theme-1"
    assert payload["title"] == "张三的简历"
    persisted = repo_for(tmp_path).get_document("doc_1")
    assert persisted is not None
    assert persisted.template_id == "custom-theme-1"


@pytest.mark.parametrize("title", ["", "   "])
def test_revision_api_rejects_blank_document_title(revision_client, title):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)

    response = client.patch("/documents/doc_1", json={"title": title})

    assert response.status_code == 422
    assert repo_for(tmp_path).get_document("doc_1").title == "张三的简历"


def test_revision_api_returns_404_when_updating_missing_document(revision_client):
    client, _tmp_path = revision_client

    response = client.patch("/documents/doc_missing", json={"title": "新标题"})

    assert response.status_code == 404


def test_revision_api_deletes_document(revision_client):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)

    response = client.delete("/documents/doc_1")

    assert response.status_code == 204
    assert client.get("/documents/doc_1").status_code == 404
    assert all(document["id"] != "doc_1" for document in client.get("/documents").json())
    assert client.get("/documents/doc_1/workspace-view").status_code == 404


def test_revision_api_returns_404_when_deleting_missing_document(revision_client):
    client, _tmp_path = revision_client

    response = client.delete("/documents/doc_missing")

    assert response.status_code == 404


def test_revision_api_saves_source_resume_canvas_document(revision_client):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)

    next_doc_json = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "attrs": {"canvasNodeId": "node_1", "moduleId": "mod_1"},
                "content": [{"type": "text", "text": "用户编辑后的旧简历正文"}],
            }
        ],
    }
    response = client.put(
        "/documents/doc_1/source-resume-canvas",
        json={"doc_json": next_doc_json},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "canvas_1"
    assert payload["version"] == 2
    assert payload["source_snapshot_hash"] == source_canvas_hash(next_doc_json)
    assert payload["source_snapshot_hash"] != "sha256:old"
    assert payload["doc_json"]["content"][0]["content"][0]["text"] == "用户编辑后的旧简历正文"
    assert payload["node_map"][0]["canvas_node_id"] == "node_1"
    assert payload["node_map"][0]["text"] == payload["doc_json"]["content"][0]["content"][0]["text"]
    assert payload["module_anchors"][0]["module_id"] == "mod_1"


@pytest.mark.parametrize(
    "doc_json",
    [
        {},
        {"type": "paragraph", "content": []},
        {"type": "doc", "content": {}},
    ],
)
def test_revision_api_rejects_invalid_source_resume_canvas_document(revision_client, doc_json):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)

    response = client.put(
        "/documents/doc_1/source-resume-canvas",
        json={"doc_json": doc_json},
    )

    assert response.status_code == 422


def test_revision_api_returns_404_when_source_resume_canvas_document_missing(revision_client):
    client, _tmp_path = revision_client

    response = client.put(
        "/documents/doc_missing/source-resume-canvas",
        json={"doc_json": {"type": "doc", "content": []}},
    )

    assert response.status_code == 404


def test_revision_api_returns_400_for_duplicate_source_resume_canvas_node_ids(revision_client):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)

    response = client.put(
        "/documents/doc_1/source-resume-canvas",
        json={
            "doc_json": {
                "type": "doc",
                "content": [
                    {"type": "paragraph", "attrs": {"canvasNodeId": "node_1"}},
                    {"type": "paragraph", "attrs": {"canvasNodeId": "node_1"}},
                ],
            }
        },
    )

    assert response.status_code == 400


def test_revision_api_returns_404_when_source_resume_canvas_missing(revision_client):
    client, _tmp_path = revision_client
    created_document = client.post(
        "/documents",
        json={
            "title": "没有旧画布的简历",
            "pack_id": "resume",
            "target_language": "zh-CN",
        },
    )
    document = created_document.json()

    response = client.put(
        f"/documents/{document['id']}/source-resume-canvas",
        json={"doc_json": {"type": "doc", "content": []}},
    )

    assert response.status_code == 404


def test_revision_api_exports_document_pdf_without_gate(revision_client, monkeypatch):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)
    captured_margin: list[dict[str, str] | None] = []

    def fake_render_html_to_pdf(html: str, output_path: Path, page_margin: dict[str, str] | None = None) -> Path:
        captured_margin.append(page_margin)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"%PDF-1.4\n")
        assert "订单系统重构" in html
        assert "font-size: 15px" in html
        assert "#123456" in html
        return output_path

    monkeypatch.setattr(
        "typedance_sidecar.revision_export.render_html_to_pdf",
        fake_render_html_to_pdf,
    )
    style_payload = template_style_payload()
    style_payload["blocks"]["paragraph"] = {"fontSize": "15px", "color": "#123456"}

    response = client.post(
        "/documents/doc_1/export/pdf",
        json={
            "source_doc_json": {
                "type": "doc",
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": "订单系统重构"}],
                    }
                ],
            },
            "page_margins": {"top": 88, "bottom": 72, "left": 42, "right": 48},
            "template_style": style_payload,
        },
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["X-Export-Artifact-Id"].startswith("export_")
    assert "X-Export-Review-Status" not in response.headers
    assert captured_margin == [{"top": "88px", "bottom": "72px", "left": "42px", "right": "48px"}]
    export_path = Path(response.headers["X-Pdf-Path"])
    assert export_path.parent.name == "exports"
    assert "X-Export-Artifact-Id" in response.headers["access-control-expose-headers"]
    assert "X-Export-Review-Status" not in response.headers["access-control-expose-headers"]


def test_revision_api_exports_document_html_with_current_style(revision_client):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)
    style_payload = template_style_payload()
    style_payload["blocks"]["paragraph"] = {"fontSize": "15px", "color": "#123456"}

    response = client.post(
        "/documents/doc_1/export/html",
        json={
            "source_doc_json": {
                "type": "doc",
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": "订单系统重构"}],
                    }
                ],
            },
            "page_margins": {"top": 88, "bottom": 72, "left": 42, "right": 48},
            "template_style": style_payload,
        },
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["X-Export-Artifact-Id"].startswith("export_")
    assert "X-Html-Path" in response.headers
    assert "font-size: 15px" in response.text
    assert "#123456" in response.text
    assert "padding: 88px 48px 72px 42px" in response.text


def test_revision_api_handles_issues_proposals_and_confirmations(revision_client):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)

    issues = client.get("/drafts/draft_1/issues")
    assert issues.status_code == 200
    assert issues.json()[0]["id"] == "issue_1"

    dismissed = client.post("/issues/issue_1/dismiss")
    assert dismissed.status_code == 200
    assert dismissed.json()["status"] == "dismissed"

    proposal = client.get("/proposals/prop_1")
    assert proposal.status_code == 200
    assert proposal.json()["status"] == "pending"

    accepted_proposal = client.post("/proposals/prop_1/accept")
    assert accepted_proposal.status_code == 200
    assert accepted_proposal.json()["status"] == "applied"
    draft = client.get("/drafts/draft_1").json()
    assert draft["applied_proposal_ids"] == ["prop_1"]

    confirmation = client.post(
        "/claims/claim_1/confirm",
        json={
            "document_id": "doc_1",
            "confirmation_type": "truth_confirmed",
            "evidence_link_id": "ev_1",
            "issue_id": "issue_1",
            "note": "用户确认这段经历真实发生。",
        },
    )
    assert confirmation.status_code == 201
    assert confirmation.json()["claim_id"] == "claim_1"

    confirmed_evidence = client.post("/evidence-links/ev_1/confirm")
    assert confirmed_evidence.status_code == 200
    assert confirmed_evidence.json()["user_confirmed"] is True
