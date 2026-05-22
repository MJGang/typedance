from uuid import uuid4
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from .models import utc_now
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
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

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
            proposal = self._build_proposal(document, run, draft, issue, claim, user_intent)
            self.repository.save_revision_proposal(proposal)
            self._save_step(run.id, "BuildIssueProposal")
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

    def _build_proposal(
        self,
        document: Document,
        run: RevisionRun,
        draft: DraftVersion,
        issue: RevisionIssue,
        claim: DocumentClaim | None,
        user_intent: str,
    ) -> RevisionProposal:
        now = utc_now()
        target = self._target(issue, claim)
        original_text = claim.text if claim is not None else issue.original_text
        proposed_text = self._merge_text(original_text, user_intent)
        return RevisionProposal(
            id=f"prop_{uuid4().hex}",
            run_id=run.id,
            document_id=document.id,
            draft_id=draft.id,
            target=target,
            operation="replace_claim" if claim is not None else "user_guided_revision",
            original_snapshot={"text": original_text} if original_text else None,
            proposed_snapshot={"text": proposed_text},
            summary="根据补充事实改写当前问题",
            rationale="用户在问题卡中补充了局部事实，系统据此生成可确认的改稿建议。",
            related_issue_ids=[issue.id],
            evidence_link_ids=issue.evidence_link_ids,
            confidence=0.86,
            risk_level="medium" if issue.severity != "blocking" else "high",
            requires_user_confirmation=False,
            status="pending",
            created_by_agent="IssueActionOrchestrator",
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
