from typing import TypedDict
from uuid import uuid4

from langgraph.graph import END, START, StateGraph

from .models import utc_now
from .resume_agent_outputs import ResumeRewriteOutput, RevisionProposalDraft, register_resume_agent_output_schemas
from .resume_rewriter_runner import (
    ResumeRewriterRunRequest,
    ResumeRewriterRunner,
    build_resume_rewriter_runner,
)
from .revision_agent_runtime import AgentInputRef, AgentRuntime, AgentRuntimeError, AgentSchemaRegistry, build_agent_context
from .revision_models import (
    AgentStep,
    Document,
    DocumentClaim,
    DraftVersion,
    RevisionIssue,
    RevisionProposal,
    RevisionRun,
    UserConfirmation,
)
from .revision_repository import RevisionRepository
from .revision_services import RevisionServiceError


class IssueActionGraphState(TypedDict, total=False):
    user_intent: str
    module_id: str | None
    claim_id: str | None
    original_text: str | None
    confirmation_id: str | None
    proposal_id: str
    proposal_text: str


class RevisionIssueActionService:
    def __init__(
        self,
        repository: RevisionRepository,
        rewriter_runner: ResumeRewriterRunner | None = None,
    ) -> None:
        self.repository = repository
        self.rewriter_runner = rewriter_runner or build_resume_rewriter_runner()

    def run_issue_action(self, document_id: str, run_id: str) -> RevisionRun:
        document = self.repository.get_document(document_id)
        if document is None:
            raise RevisionServiceError(f"Document not found: {document_id}")

        run = self.repository.get_revision_run(run_id)
        if run is None:
            raise RevisionServiceError(f"Revision run not found: {run_id}")
        if run.run_type != "issue_action":
            raise RevisionServiceError(f"Unsupported issue action run type: {run.run_type}")

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
            raise RevisionServiceError("Issue action requires a draft")

        issue = self._selected_issue(run, draft)
        user_intent = (run.user_intent or "").strip()
        if not user_intent:
            raise RevisionServiceError("Issue action requires user intent")

        self.repository.save_revision_run(
            run.model_copy(update={"status": "generating", "updated_at": utc_now()})
        )
        self._invoke_graph(document, run, draft, issue, user_intent)

        completed_run = run.model_copy(
            update={
                "status": "completed",
                "target_draft_id": draft.id,
                "output_summary": "已根据当前问题补充事实生成 1 条局部改稿建议。",
                "updated_at": utc_now(),
            }
        )
        self.repository.save_revision_run(completed_run)
        return completed_run

    def _invoke_graph(
        self,
        document: Document,
        run: RevisionRun,
        draft: DraftVersion,
        issue: RevisionIssue,
        user_intent: str,
    ) -> IssueActionGraphState:
        graph = self._build_graph(document, run, draft, issue)
        result = graph.invoke({"user_intent": user_intent})
        return IssueActionGraphState(**result)

    def _build_graph(
        self,
        document: Document,
        run: RevisionRun,
        draft: DraftVersion,
        issue: RevisionIssue,
    ):
        builder = StateGraph(IssueActionGraphState)

        def collect_issue_context(state: IssueActionGraphState) -> IssueActionGraphState:
            user_intent = state["user_intent"].strip()
            claim = self._selected_claim(issue, draft)
            confirmation_id = None
            if claim is not None:
                confirmation = self._save_confirmation(document, issue, claim, user_intent)
                confirmation_id = confirmation.id

            self._save_step(run.id, "CollectIssueContext")
            return {
                "user_intent": user_intent,
                "module_id": issue.module_id,
                "claim_id": claim.id if claim is not None else issue.claim_id,
                "original_text": claim.text if claim is not None else issue.original_text,
                "confirmation_id": confirmation_id,
            }

        def build_issue_proposal(state: IssueActionGraphState) -> IssueActionGraphState:
            user_intent = state["user_intent"].strip()
            claim = self._selected_claim(issue, draft)
            proposal_id = f"prop_{uuid4().hex}"
            rewrite_output = self._invoke_rewriter_agent(
                document,
                run,
                draft,
                issue,
                claim,
                user_intent,
                proposal_id,
                state.get("confirmation_id"),
            )
            proposal = self._build_proposal(
                document,
                run,
                draft,
                issue,
                claim,
                rewrite_output.proposals[0],
                proposal_id,
            )
            self.repository.save_revision_proposal(proposal)
            return {
                "proposal_id": proposal.id,
                "proposal_text": proposal.proposed_snapshot["text"],
            }

        builder.add_node("collect_issue_context", collect_issue_context)
        builder.add_node("build_issue_proposal", build_issue_proposal)
        builder.add_edge(START, "collect_issue_context")
        builder.add_edge("collect_issue_context", "build_issue_proposal")
        builder.add_edge("build_issue_proposal", END)
        return builder.compile()

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

    def _selected_issue(self, run: RevisionRun, draft: DraftVersion) -> RevisionIssue:
        if not run.selected_issue_id:
            raise RevisionServiceError("Issue action requires selected issue")

        issue = self.repository.get_revision_issue(run.selected_issue_id)
        if issue is None:
            raise RevisionServiceError(f"Issue not found: {run.selected_issue_id}")
        if issue.draft_id != draft.id:
            raise RevisionServiceError(f"Issue does not belong to draft: {issue.id}")
        return issue

    def _selected_claim(
        self,
        issue: RevisionIssue,
        draft: DraftVersion,
    ) -> DocumentClaim | None:
        if not issue.claim_id:
            return None
        return next(
            (
                claim
                for claim in self.repository.list_document_claims(draft.id)
                if claim.id == issue.claim_id
            ),
            None,
        )

    def _save_confirmation(
        self,
        document: Document,
        issue: RevisionIssue,
        claim: DocumentClaim,
        user_intent: str,
    ) -> UserConfirmation:
        return self.repository.save_user_confirmation(
            UserConfirmation(
                id=f"confirm_{uuid4().hex}",
                document_id=document.id,
                confirmation_type="truth_confirmed",
                claim_id=claim.id,
                issue_id=issue.id,
                note=user_intent,
                created_at=utc_now(),
            )
        )

    def _invoke_rewriter_agent(
        self,
        document: Document,
        run: RevisionRun,
        draft: DraftVersion,
        issue: RevisionIssue,
        claim: DocumentClaim | None,
        user_intent: str,
        proposal_id: str,
        confirmation_id: str | None,
    ) -> ResumeRewriteOutput:
        runtime = AgentRuntime(
            self.repository,
            register_resume_agent_output_schemas(AgentSchemaRegistry()),
        )
        input_refs = [
            AgentInputRef(object_type="DraftVersion", object_id=draft.id),
            AgentInputRef(object_type="RevisionIssue", object_id=issue.id),
        ]
        if claim is not None:
            input_refs.append(AgentInputRef(object_type="DocumentClaim", object_id=claim.id))
        if confirmation_id is not None:
            input_refs.append(AgentInputRef(object_type="UserConfirmation", object_id=confirmation_id))

        context = build_agent_context(
            run,
            agent_name="ResumeRewriter",
            input_refs=input_refs,
            target_language=document.target_language,
        )

        request = ResumeRewriterRunRequest(
            proposal_id=proposal_id,
            issue_id=issue.id,
            issue_type=issue.type,
            issue_title=issue.title,
            issue_message=issue.message,
            issue_reason=issue.reason,
            target=self._target(issue, claim),
            user_intent=user_intent,
            evidence_link_ids=issue.evidence_link_ids,
            risk_level="medium" if issue.severity != "blocking" else "high",
            original_text=claim.text if claim is not None else issue.original_text,
        )

        def runner(received_context):
            return self.rewriter_runner(received_context, request)

        result = runtime.invoke(context, runner)
        if not isinstance(result.payload, ResumeRewriteOutput):
            raise RevisionServiceError("ResumeRewriter returned unexpected payload")
        if not result.payload.proposals:
            raise RevisionServiceError("ResumeRewriter returned no proposals")
        return result.payload

    def _build_proposal(
        self,
        document: Document,
        run: RevisionRun,
        draft: DraftVersion,
        issue: RevisionIssue,
        claim: DocumentClaim | None,
        proposal_draft: RevisionProposalDraft,
        proposal_id: str,
    ) -> RevisionProposal:
        now = utc_now()
        original_text = claim.text if claim is not None else issue.original_text
        after = proposal_draft.after if isinstance(proposal_draft.after, dict) else {}
        proposed_text = after.get("text") if isinstance(after.get("text"), str) else self._merge_text(original_text, "")
        return RevisionProposal(
            id=proposal_id,
            run_id=run.id,
            document_id=document.id,
            draft_id=draft.id,
            target=proposal_draft.target.model_dump(exclude_none=True),
            operation=proposal_draft.operation,
            original_snapshot=proposal_draft.before if proposal_draft.before is not None else ({"text": original_text} if original_text else None),
            proposed_snapshot={"text": proposed_text},
            summary=proposal_draft.summary,
            rationale=proposal_draft.rationale,
            related_issue_ids=proposal_draft.related_issue_refs or [issue.id],
            evidence_link_ids=proposal_draft.evidence_link_refs,
            confidence=proposal_draft.confidence,
            risk_level=proposal_draft.risk_level,
            requires_user_confirmation=proposal_draft.requires_user_confirmation,
            status="pending",
            created_by_agent="ResumeRewriter",
            created_at=now,
        )

    def _target(
        self,
        issue: RevisionIssue,
        claim: DocumentClaim | None,
    ) -> dict[str, str]:
        target: dict[str, str] = {}
        if issue.module_id:
            target["module_id"] = issue.module_id
        if claim is not None:
            target["claim_id"] = claim.id
        elif issue.claim_id:
            target["claim_id"] = issue.claim_id
        return target

    def _merge_text(self, original_text: str | None, user_intent: str) -> str:
        if not original_text:
            return user_intent
        separator = "" if original_text.endswith(("，", ",", "。", ".", "；", ";")) else "，"
        return f"{original_text}{separator}{user_intent}"

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
