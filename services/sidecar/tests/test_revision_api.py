import pytest
from pathlib import Path
from fastapi.testclient import TestClient

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
    RevisionRun,
    SourceDocument,
    SourceResumeCanvas,
)
from typedance_sidecar.revision_repository import RevisionRepository


@pytest.fixture
def revision_client(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    return TestClient(app), tmp_path


def repo_for(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def seed_workspace(tmp_path) -> RevisionRepository:
    now = utc_now()
    repo = repo_for(tmp_path)
    document = repo.save_document(
        Document(
            id="doc_1",
            pack_id="resume",
            title="张三的简历",
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
            parse_status="parsed",
            created_at=now,
        )
    )
    repo.save_source_resume_canvas(
        SourceResumeCanvas(
            id="canvas_1",
            document_id=document.id,
            old_resume_source_id=source.id,
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
    run = repo.save_revision_run(
        RevisionRun(
            id="run_1",
            document_id=document.id,
            pack_id=document.pack_id,
            run_type="quality_review",
            status="completed",
            source_document_ids=[source.id],
            created_at=now,
            updated_at=now,
        )
    )
    draft = repo.save_draft_version(
        DraftVersion(
            id="draft_1",
            document_id=document.id,
            run_id=run.id,
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
            run_id=run.id,
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
            run_id=run.id,
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


def test_revision_api_creates_document_source_and_run(revision_client):
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

    assert client.get(f"/documents/{document['id']}").json()["title"] == "张三的简历"
    assert client.get("/documents").json()[0]["id"] == document["id"]

    created_source = client.post(
        f"/documents/{document['id']}/sources",
        json={
            "source_type": "pasted_text",
            "title": "粘贴旧简历",
            "raw_text": "项目经历：订单系统重构",
        },
    )
    assert created_source.status_code == 201
    source = created_source.json()
    assert source["document_id"] == document["id"]
    assert client.get(f"/documents/{document['id']}/sources").json()[0]["id"] == source["id"]

    created_run = client.post(
        f"/documents/{document['id']}/revision-runs",
        json={
            "run_type": "import_reconstruct",
            "source_document_ids": [source["id"]],
            "user_intent": "导入旧简历并重构",
        },
    )
    assert created_run.status_code == 201
    run = created_run.json()
    assert run["pack_id"] == "resume"
    assert run["status"] == "completed"
    assert run["target_draft_id"].startswith("draft_")
    assert client.get(f"/revision-runs/{run['id']}").json()["id"] == run["id"]

    workspace = client.get(f"/documents/{document['id']}/workspace-view").json()
    assert workspace["current_draft"]["id"] == run["target_draft_id"]
    assert len(workspace["modules"]) >= 2
    assert workspace["issues"]
    assert workspace["proposals"]
    assert workspace["evidence"]
    assert workspace["render_projection"]["draft_id"] == run["target_draft_id"]


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
    assert workspace["run_status"]["run_id"] == "run_1"
    assert workspace["run_status"]["status"] == "completed"
    assert workspace["coach_summary"]["summary"] == "还有 1 个问题建议处理后再导出。"
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


def test_revision_api_saves_source_resume_canvas_document(revision_client):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)

    response = client.put(
        "/documents/doc_1/source-resume-canvas",
        json={
            "doc_json": {
                "type": "doc",
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": "用户编辑后的旧简历正文"}],
                    }
                ],
            }
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "canvas_1"
    assert payload["doc_json"]["content"][0]["content"][0]["text"] == "用户编辑后的旧简历正文"
    assert payload["node_map"][0]["canvas_node_id"] == "node_1"
    assert payload["module_anchors"][0]["module_id"] == "mod_1"


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


def test_revision_api_runs_blank_guided_generation(revision_client):
    client, _tmp_path = revision_client

    created_document = client.post(
        "/documents",
        json={
            "title": "新简历",
            "pack_id": "resume",
            "target_language": "zh-CN",
            "initial_mode": "blank_guided",
        },
    )
    document = created_document.json()
    created_source = client.post(
        f"/documents/{document['id']}/sources",
        json={
            "source_type": "manual_user_input",
            "title": "空白引导信息",
            "raw_text": "姓名: 张三\n目标方向: 前端工程师\n技能: Vue3、TypeScript",
        },
    )
    source = created_source.json()

    created_run = client.post(
        f"/documents/{document['id']}/revision-runs",
        json={
            "run_type": "blank_guided_generate",
            "source_document_ids": [source["id"]],
            "user_intent": "从空白引导生成基础简历",
        },
    )

    assert created_run.status_code == 201
    run = created_run.json()
    assert run["status"] == "completed"
    assert run["target_draft_id"].startswith("draft_")

    workspace = client.get(f"/documents/{document['id']}/workspace-view").json()
    assert workspace["current_draft"]["id"] == run["target_draft_id"]
    assert {module["type"] for module in workspace["modules"]} >= {
        "BasicInfo",
        "JobIntent",
        "CoreSkills",
        "WorkExperience",
        "ProjectExperience",
    }
    assert workspace["issues"]
    assert workspace["proposals"]
    assert workspace["render_projection"]["draft_id"] == run["target_draft_id"]


def test_revision_api_runs_quality_review(revision_client):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)

    created_run = client.post(
        "/documents/doc_1/revision-runs",
        json={
            "run_type": "quality_review",
            "base_draft_id": "draft_1",
            "user_intent": "运行基础质量检查",
        },
    )

    assert created_run.status_code == 201
    run = created_run.json()
    assert run["status"] == "completed"
    assert run["target_draft_id"] == "draft_1"

    workspace = client.get("/documents/doc_1/workspace-view").json()
    issue_types = {issue["type"] for issue in workspace["issues"]}
    assert {"missing_basic_info", "missing_skills", "missing_result"} <= issue_types
    assert len(workspace["proposals"]) >= 2
    assert workspace["quality_gate"]["status"] == "blocked"


def test_revision_api_runs_opportunity_calibration(revision_client):
    client, tmp_path = revision_client
    repo = seed_workspace(tmp_path)
    repo.save_source_document(
        SourceDocument(
            id="src_opp",
            document_id="doc_1",
            source_type="external_context",
            title="前端岗位",
            raw_text="要求：React、TypeScript、Node.js",
            parse_status="pending",
            created_at=utc_now(),
        )
    )

    created_run = client.post(
        "/documents/doc_1/revision-runs",
        json={
            "run_type": "opportunity_calibrate",
            "source_document_ids": ["src_opp"],
            "base_draft_id": "draft_1",
            "user_intent": "生成岗位版本",
        },
    )

    assert created_run.status_code == 201
    run = created_run.json()
    assert run["status"] == "completed"
    assert run["target_draft_id"] != "draft_1"

    workspace = client.get("/documents/doc_1/workspace-view").json()
    assert workspace["current_draft"]["id"] == run["target_draft_id"]
    assert workspace["current_draft"]["variant_type"] == "opportunity"
    assert any(issue["type"] == "missing_opportunity_requirement" for issue in workspace["issues"])
    assert workspace["proposals"]


def test_revision_api_runs_issue_action(revision_client):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)

    created_run = client.post(
        "/documents/doc_1/revision-runs",
        json={
            "run_type": "issue_action",
            "base_draft_id": "draft_1",
            "selected_module_id": "mod_1",
            "selected_issue_id": "issue_1",
            "user_intent": "上线后接口错误率下降 30%。",
        },
    )

    assert created_run.status_code == 201
    run = created_run.json()
    assert run["status"] == "completed"
    assert run["target_draft_id"] == "draft_1"
    assert "局部改稿建议" in run["output_summary"]

    repo = repo_for(tmp_path)
    proposals = [proposal for proposal in repo.list_revision_proposals("draft_1") if proposal.run_id == run["id"]]
    assert len(proposals) == 1
    assert proposals[0].related_issue_ids == ["issue_1"]
    assert proposals[0].proposed_snapshot["text"].endswith("上线后接口错误率下降 30%。")

    confirmations = repo.list_user_confirmations("doc_1")
    assert any(
        confirmation.issue_id == "issue_1"
        and confirmation.claim_id == "claim_1"
        and confirmation.note == "上线后接口错误率下降 30%。"
        for confirmation in confirmations
    )


def test_revision_api_exports_draft_pdf_with_gate(revision_client, monkeypatch):
    client, tmp_path = revision_client
    seed_workspace(tmp_path)

    def fake_render_html_to_pdf(html: str, output_path: Path) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"%PDF-1.4\n")
        assert "订单系统重构" in html
        return output_path

    monkeypatch.setattr(
        "typedance_sidecar.revision_export_gate.render_html_to_pdf",
        fake_render_html_to_pdf,
    )

    blocked_response = client.post("/drafts/draft_1/export/pdf")

    assert blocked_response.status_code == 409
    assert blocked_response.json()["detail"]["warning_issue_ids"] == ["issue_1"]

    response = client.post(
        "/drafts/draft_1/export/pdf",
        json={"force_with_risk": True},
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["X-Export-Review-Status"] == "forced_with_risk"
    assert response.headers["X-Export-Artifact-Id"].startswith("export_")
    export_path = Path(response.headers["X-Pdf-Path"])
    assert export_path.parent.name == "exports"
    assert "X-Export-Artifact-Id" in response.headers["access-control-expose-headers"]


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
