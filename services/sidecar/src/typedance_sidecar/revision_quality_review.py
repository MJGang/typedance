from uuid import uuid4

from .models import utc_now
from .resume_agent_outputs import ResumeReviewOutput, RevisionIssueDraft, register_resume_agent_output_schemas
from .resume_reviewer_runner import (
    ResumeReviewerRunRequest,
    ResumeReviewerRunner,
    build_resume_reviewer_runner,
)
from .revision_agent_runtime import AgentInputRef, AgentRuntime, AgentRuntimeError, AgentSchemaRegistry, build_agent_context
from .revision_models import (
    AgentStep,
    Document,
    DocumentClaim,
    DocumentModule,
    DraftVersion,
    EvidenceLink,
    RevisionIssue,
    RevisionProposal,
    RevisionRun,
)
from .revision_repository import RevisionRepository
from .revision_services import RenderService, RevisionServiceError


class RevisionQualityReviewService:
    def __init__(
        self,
        repository: RevisionRepository,
        reviewer_runner: ResumeReviewerRunner | None = None,
    ) -> None:
        self.repository = repository
        self.reviewer_runner = reviewer_runner or build_resume_reviewer_runner()

    def run_quality_review(self, document_id: str, run_id: str) -> RevisionRun:
        document = self.repository.get_document(document_id)
        if document is None:
            raise RevisionServiceError(f"Document not found: {document_id}")

        run = self.repository.get_revision_run(run_id)
        if run is None:
            raise RevisionServiceError(f"Revision run not found: {run_id}")
        if run.run_type != "quality_review":
            raise RevisionServiceError(f"Unsupported quality review run type: {run.run_type}")

        try:
            return self._run(document, run)
        except AgentRuntimeError as exc:
            raise RevisionServiceError(exc.message) from exc
        except RevisionServiceError as exc:
            self.repository.save_revision_run(
                run.model_copy(
                    update={
                        "status": "failed_retryable",
                        "output_summary": str(exc),
                        "updated_at": utc_now(),
                    }
                )
            )
            raise

    def _run(self, document: Document, run: RevisionRun) -> RevisionRun:
        draft = self._base_draft(document, run)
        if draft is None:
            raise RevisionServiceError("Quality review requires a draft")

        modules = self.repository.list_document_modules(draft.id)
        claims = self.repository.list_document_claims(draft.id)
        evidence_links = self.repository.list_evidence_links(document.id)

        self._save_step(run.id, "InspectDraft")
        review_output, reviewer_step = self._invoke_reviewer_agent(
            document,
            run,
            draft,
            modules,
            claims,
            evidence_links,
        )
        issues = self._build_issues(document, run, draft, review_output.issues)
        for issue in issues:
            self.repository.save_revision_issue(issue)
        self.repository.save_agent_step(
            reviewer_step.model_copy(
                update={"output_refs": [f"RevisionIssue:{issue.id}" for issue in issues]}
            )
        )

        proposals = self._build_proposals(document, run, draft, issues, evidence_links)
        for proposal in proposals:
            self.repository.save_revision_proposal(proposal)
        self._save_step(run.id, "BuildQualityTasks")

        updated_draft = draft.model_copy(
            update={
                "unresolved_issue_ids": [*draft.unresolved_issue_ids, *[issue.id for issue in issues]],
                "updated_at": utc_now(),
            }
        )
        self.repository.save_draft_version(updated_draft)
        if updated_draft.render_projection_id is None:
            RenderService(self.repository).build_projection_for_draft(updated_draft.id)
        self._save_step(run.id, "RefreshPreview")

        completed_run = run.model_copy(
            update={
                "status": "completed",
                "target_draft_id": updated_draft.id,
                "output_summary": f"基础质量检查完成，发现 {len(issues)} 个待处理问题。",
                "updated_at": utc_now(),
            }
        )
        self.repository.save_revision_run(completed_run)
        return completed_run

    def _base_draft(self, document: Document, run: RevisionRun) -> DraftVersion | None:
        if run.base_draft_id:
            draft = self.repository.get_draft_version(run.base_draft_id)
            if draft is not None:
                return draft
        if document.current_draft_id:
            draft = self.repository.get_draft_version(document.current_draft_id)
            if draft is not None:
                return draft

        drafts = self.repository.list_draft_versions(document.id)
        return drafts[-1] if drafts else None

    def _invoke_reviewer_agent(
        self,
        document: Document,
        run: RevisionRun,
        draft: DraftVersion,
        modules: list[DocumentModule],
        claims: list[DocumentClaim],
        evidence_links: list[EvidenceLink],
    ):
        runtime = AgentRuntime(
            self.repository,
            register_resume_agent_output_schemas(AgentSchemaRegistry()),
        )
        input_refs = [
            AgentInputRef(object_type="DraftVersion", object_id=draft.id),
            *[AgentInputRef(object_type="DocumentModule", object_id=module.id) for module in modules],
            *[AgentInputRef(object_type="DocumentClaim", object_id=claim.id) for claim in claims],
            *[AgentInputRef(object_type="EvidenceLink", object_id=evidence.id) for evidence in evidence_links],
        ]
        context = build_agent_context(
            run,
            agent_name="ResumeReviewer",
            input_refs=input_refs,
            target_language=document.target_language,
        )
        request = ResumeReviewerRunRequest(
            modules=modules,
            claims=claims,
            evidence_links=evidence_links,
        )

        def runner(received_context):
            return self.reviewer_runner(received_context, request)

        result = runtime.invoke(context, runner)
        if not isinstance(result.payload, ResumeReviewOutput):
            raise RevisionServiceError("ResumeReviewer returned unexpected payload")
        return result.payload, result.step

    def _build_issues(
        self,
        document: Document,
        run: RevisionRun,
        draft: DraftVersion,
        issue_drafts: list[RevisionIssueDraft],
    ) -> list[RevisionIssue]:
        now = utc_now()
        issues: list[RevisionIssue] = []
        for issue_draft in issue_drafts:
            target = issue_draft.target
            issues.append(
                RevisionIssue(
                    id=f"issue_{uuid4().hex}",
                    run_id=run.id,
                    document_id=document.id,
                    draft_id=draft.id,
                    module_id=target.module_id,
                    item_id=target.item_id,
                    claim_id=target.claim_id,
                    type=issue_draft.type,
                    severity=issue_draft.severity,
                    title=issue_draft.title,
                    message=issue_draft.message,
                    reason=issue_draft.reason,
                    status="needs_user_input" if issue_draft.severity == "blocking" else "open",
                    original_text=issue_draft.original_text,
                    evidence_link_ids=issue_draft.evidence_link_refs,
                    created_by_agent="ResumeReviewer",
                    created_at=now,
                )
            )
        return issues

    def _build_proposals(
        self,
        document: Document,
        run: RevisionRun,
        draft: DraftVersion,
        issues: list[RevisionIssue],
        evidence_links: list[EvidenceLink],
    ) -> list[RevisionProposal]:
        now = utc_now()
        evidence_by_claim = {evidence.claim_id: evidence for evidence in evidence_links}
        proposals: list[RevisionProposal] = []

        for issue in issues:
            evidence = evidence_by_claim.get(issue.claim_id)
            if issue.type == "missing_result" and issue.original_text:
                operation = "replace_claim"
                proposed_snapshot = {
                    "text": f"{issue.original_text}，并补充可确认的业务结果、影响范围或量化指标。"
                }
                summary = "补成结果导向表达"
            elif issue.type == "claim_needs_confirmation":
                operation = "update_field"
                proposed_snapshot = {
                    "confirmation_required": True,
                    "question": "这条经历是否真实发生？请补充证据或改成更保守的表述。",
                }
                summary = "确认高风险事实"
            else:
                operation = "insert_claim"
                proposed_snapshot = {
                    "instruction": "补充真实信息后继续生成更完整的模块内容。"
                }
                summary = "补充缺失模块"

            proposals.append(
                RevisionProposal(
                    id=f"prop_{uuid4().hex}",
                    run_id=run.id,
                    document_id=document.id,
                    draft_id=draft.id,
                    target={"module_id": issue.module_id, "claim_id": issue.claim_id},
                    operation=operation,
                    original_snapshot={"text": issue.original_text} if issue.original_text else None,
                    proposed_snapshot=proposed_snapshot,
                    summary=summary,
                    rationale="基础质量检查发现该处会影响投递可信度或导出质量。",
                    related_issue_ids=[issue.id],
                    evidence_link_ids=[evidence.id] if evidence else issue.evidence_link_ids,
                    confidence=0.74,
                    risk_level="high" if issue.severity == "blocking" else "medium",
                    requires_user_confirmation=issue.severity == "blocking",
                    status="pending",
                    created_by_agent="QualityReviewOrchestrator",
                    created_at=now,
                )
            )

        return proposals

    def _save_step(self, run_id: str, agent_name: str) -> None:
        now = utc_now()
        self.repository.save_agent_step(
            AgentStep(
                id=f"step_{uuid4().hex}",
                run_id=run_id,
                agent_name=agent_name,
                status="completed",
                started_at=now,
                finished_at=now,
            )
        )
