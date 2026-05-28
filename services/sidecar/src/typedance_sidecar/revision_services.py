from typing import Any, Literal
from uuid import uuid4

from .models import utc_now
from .revision_models import (
    CoachSummary,
    ContextualAction,
    Document,
    DocumentClaim,
    DraftVersion,
    EvidenceLink,
    ExportArtifact,
    ParsedBlock,
    QualityGateResult,
    RenderProjection,
    RevisionIssue,
    RevisionProposal,
    RevisionRunStatusSummary,
    SourceDocument,
    SourceResumeCanvas,
    UserConfirmation,
    WorkspaceView,
)
from .revision_render_projection import DraftProjectionBuilder
from .revision_repository import RevisionRepository


OPEN_ISSUE_STATUSES = {"open", "needs_user_input"}
STRONG_CLAIM_TYPES = {"achievement", "summary"}
CONFIRMING_USER_CONFIRMATION_TYPES = {"truth_confirmed", "source_verified"}


class RevisionServiceError(Exception):
    pass


class SourceService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def save_source(self, source: SourceDocument) -> SourceDocument:
        return self.repository.save_source_document(source)

    def save_parsed_block(self, block: ParsedBlock) -> ParsedBlock:
        return self.repository.save_parsed_block(block)

    def list_sources(self, document_id: str) -> list[SourceDocument]:
        return self.repository.list_source_documents(document_id)

    def list_parsed_blocks(self, source_document_id: str) -> list[ParsedBlock]:
        return self.repository.list_parsed_blocks(source_document_id)


class DraftService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def save_draft(self, draft: DraftVersion) -> DraftVersion:
        return self.repository.save_draft_version(draft)

    def accept_draft(self, draft_id: str) -> DraftVersion:
        draft = self.repository.get_draft_version(draft_id)
        if draft is None:
            raise RevisionServiceError(f"Draft not found: {draft_id}")

        document = self.repository.get_document(draft.document_id)
        if document is None:
            raise RevisionServiceError(f"Document not found: {draft.document_id}")

        blocking_claim_ids = self._unconfirmed_strong_claim_ids(draft)
        if blocking_claim_ids:
            raise RevisionServiceError(
                f"Draft has unconfirmed strong claims: {', '.join(blocking_claim_ids)}"
            )

        now = utc_now()
        accepted_draft = draft.model_copy(update={"status": "accepted", "updated_at": now})
        accepted_document = document.model_copy(
            update={
                "current_draft_id": draft.id,
                "accepted_draft_id": draft.id,
                "updated_at": now,
            }
        )
        self.repository.save_draft_version(accepted_draft)
        self.repository.save_document(accepted_document)
        return accepted_draft

    def _unconfirmed_strong_claim_ids(self, draft: DraftVersion) -> list[str]:
        claims = self.repository.list_document_claims(draft.id)
        evidence_links = self.repository.list_evidence_links(draft.document_id)
        confirmations = self.repository.list_user_confirmations(draft.document_id)
        blocking_claim_ids = []

        for claim in claims:
            if claim.claim_type not in STRONG_CLAIM_TYPES:
                continue
            if claim.confidence == "user_confirmed":
                continue
            if any(
                confirmation.claim_id == claim.id
                and confirmation.confirmation_type in CONFIRMING_USER_CONFIRMATION_TYPES
                for confirmation in confirmations
            ):
                continue
            if any(
                evidence.claim_id == claim.id
                and (evidence.user_confirmed or evidence.support_level == "direct")
                for evidence in evidence_links
            ):
                continue
            blocking_claim_ids.append(claim.id)

        return blocking_claim_ids


class IssueService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def save_issue(self, issue: RevisionIssue) -> RevisionIssue:
        return self.repository.save_revision_issue(issue)

    def list_issues(self, draft_id: str) -> list[RevisionIssue]:
        return self.repository.list_revision_issues(draft_id)

    def dismiss_issue(self, issue_id: str) -> RevisionIssue:
        issue = self.repository.get_revision_issue(issue_id)
        if issue is None:
            raise RevisionServiceError(f"Issue not found: {issue_id}")

        dismissed = issue.model_copy(update={"status": "dismissed"})
        return self.repository.save_revision_issue(dismissed)


class ProposalService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def save_proposal(self, proposal: RevisionProposal) -> RevisionProposal:
        return self.repository.save_revision_proposal(proposal)

    def accept_proposal(self, proposal_id: str) -> RevisionProposal:
        proposal = self.repository.get_revision_proposal(proposal_id)
        if proposal is None:
            raise RevisionServiceError(f"Proposal not found: {proposal_id}")

        proposal = self._apply_proposal_operation(proposal)
        applied = proposal.model_copy(update={"status": "applied"})
        self.repository.save_revision_proposal(applied)

        if proposal.draft_id is not None:
            self._mark_proposal_applied_to_draft(proposal)

        for issue_id in proposal.related_issue_ids:
            issue = self.repository.get_revision_issue(issue_id)
            if issue is not None:
                self.repository.save_revision_issue(issue.model_copy(update={"status": "accepted"}))

        return applied

    def reject_proposal(self, proposal_id: str) -> RevisionProposal:
        proposal = self.repository.get_revision_proposal(proposal_id)
        if proposal is None:
            raise RevisionServiceError(f"Proposal not found: {proposal_id}")

        rejected = proposal.model_copy(update={"status": "rejected"})
        return self.repository.save_revision_proposal(rejected)

    def _mark_proposal_applied_to_draft(self, proposal: RevisionProposal) -> DraftVersion:
        draft = self.repository.get_draft_version(proposal.draft_id or "")
        if draft is None:
            raise RevisionServiceError(f"Draft not found: {proposal.draft_id}")

        applied_ids = [*draft.applied_proposal_ids]
        if proposal.id not in applied_ids:
            applied_ids.append(proposal.id)

        unresolved_issue_ids = [
            issue_id
            for issue_id in draft.unresolved_issue_ids
            if issue_id not in proposal.related_issue_ids
        ]
        updated_draft = draft.model_copy(
            update={
                "applied_proposal_ids": applied_ids,
                "unresolved_issue_ids": unresolved_issue_ids,
                "render_projection_id": None,
                "updated_at": utc_now(),
            }
        )
        return self.repository.save_draft_version(updated_draft)

    def _apply_proposal_operation(self, proposal: RevisionProposal) -> RevisionProposal:
        if proposal.operation == "replace_claim":
            return self._apply_replace_claim(proposal)
        return proposal

    def _apply_replace_claim(self, proposal: RevisionProposal) -> RevisionProposal:
        if proposal.draft_id is None:
            raise RevisionServiceError(f"Proposal has no draft target: {proposal.id}")

        claim_id = proposal.target.get("claim_id")
        if not isinstance(claim_id, str) or not claim_id:
            raise RevisionServiceError(f"replace_claim proposal has no claim target: {proposal.id}")

        proposed_text = self._proposal_text(proposal)
        claim = self._find_claim(proposal.draft_id, claim_id)
        now = utc_now()
        self.repository.save_document_claim(
            claim.model_copy(update={"text": proposed_text, "updated_at": now})
        )
        self._update_claim_module_text(claim, proposed_text, now)
        if proposal.original_snapshot is None:
            return proposal.model_copy(update={"original_snapshot": {"text": claim.text}})
        return proposal

    def _proposal_text(self, proposal: RevisionProposal) -> str:
        snapshot = proposal.proposed_snapshot
        proposed_text = snapshot.get("text") if isinstance(snapshot, dict) else None
        if not isinstance(proposed_text, str) or not proposed_text.strip():
            raise RevisionServiceError(f"replace_claim proposal has no proposed text: {proposal.id}")
        return proposed_text

    def _find_claim(self, draft_id: str, claim_id: str) -> DocumentClaim:
        claim = next(
            (claim for claim in self.repository.list_document_claims(draft_id) if claim.id == claim_id),
            None,
        )
        if claim is None:
            raise RevisionServiceError(f"Claim not found: {claim_id}")
        return claim

    def _update_claim_module_text(self, claim: DocumentClaim, proposed_text: str, now: str) -> None:
        module = next(
            (
                module
                for module in self.repository.list_document_modules(claim.draft_id)
                if module.id == claim.module_id
            ),
            None,
        )
        if module is None or claim.item_id is None:
            return

        items = module.data.get("items")
        if not isinstance(items, list):
            return

        updated_items = []
        changed = False
        for item in items:
            if isinstance(item, dict) and item.get("id") == claim.item_id:
                updated_item = dict(item)
                if "description" in updated_item:
                    updated_item["description"] = proposed_text
                elif "text" in updated_item:
                    updated_item["text"] = proposed_text
                else:
                    updated_item["description"] = proposed_text
                updated_items.append(updated_item)
                changed = True
            else:
                updated_items.append(item)

        if not changed:
            return

        updated_data = dict(module.data)
        updated_data["items"] = updated_items
        self.repository.save_document_module(
            module.model_copy(update={"data": updated_data, "updated_at": now})
        )


class EvidenceService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def confirm_claim(
        self,
        document_id: str,
        claim_id: str,
        *,
        confirmation_type: Literal["truth_confirmed", "risk_accepted", "source_verified"] = "truth_confirmed",
        evidence_link_id: str | None = None,
        issue_id: str | None = None,
        note: str | None = None,
        confirmation_id: str | None = None,
    ) -> UserConfirmation:
        confirmation = UserConfirmation(
            id=confirmation_id or f"confirm_{uuid4().hex}",
            document_id=document_id,
            claim_id=claim_id,
            evidence_link_id=evidence_link_id,
            issue_id=issue_id,
            confirmation_type=confirmation_type,
            note=note,
            created_at=utc_now(),
        )
        return self.repository.save_user_confirmation(confirmation)

    def confirm_evidence_link(self, evidence_id: str) -> EvidenceLink:
        evidence = self.repository.get_evidence_link(evidence_id)
        if evidence is None:
            raise RevisionServiceError(f"Evidence link not found: {evidence_id}")

        confirmed = evidence.model_copy(update={"user_confirmed": True})
        return self.repository.save_evidence_link(confirmed)


class WorkspaceService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def get_workspace_view(self, document_id: str) -> WorkspaceView:
        document = self.repository.get_document(document_id)
        if document is None:
            raise RevisionServiceError(f"Document not found: {document_id}")

        current_draft = self._current_draft(document)
        modules = []
        claims = []
        issues = []
        proposals = []
        render_projection = None

        if current_draft is not None:
            modules = self.repository.list_document_modules(current_draft.id)
            claims = self.repository.list_document_claims(current_draft.id)
            issues = self.repository.list_revision_issues(current_draft.id)
            proposals = self.repository.list_revision_proposals(current_draft.id)
            if current_draft.render_projection_id is not None:
                render_projection = self.repository.get_render_projection(current_draft.render_projection_id)

        quality_gate = self._quality_gate(current_draft, issues)
        available_actions = self._available_actions(issues, proposals)
        return WorkspaceView(
            document=document,
            current_draft=current_draft,
            modules=modules,
            claims=claims,
            issues=issues,
            proposals=proposals,
            evidence=self.repository.list_evidence_links(document.id),
            source_summaries=self.repository.list_source_documents(document.id),
            source_resume_canvas=self.repository.get_source_resume_canvas(document.id),
            render_projection=render_projection,
            quality_gate=quality_gate,
            run_status=self._run_status(document.id),
            coach_summary=self._coach_summary(quality_gate, current_draft, available_actions),
            available_actions=available_actions,
        )

    def save_source_resume_canvas_document(
        self,
        document_id: str,
        doc_json: dict[str, Any],
    ) -> SourceResumeCanvas:
        document = self.repository.get_document(document_id)
        if document is None:
            raise RevisionServiceError(f"Document not found: {document_id}")

        canvas = self.repository.get_source_resume_canvas(document.id)
        if canvas is None:
            raise RevisionServiceError(f"Source resume canvas not found: {document_id}")

        saved = canvas.model_copy(
            update={
                "doc_json": doc_json,
                "updated_at": utc_now(),
            }
        )
        return self.repository.save_source_resume_canvas(saved)

    def _current_draft(self, document: Document) -> DraftVersion | None:
        if document.current_draft_id is not None:
            draft = self.repository.get_draft_version(document.current_draft_id)
            if draft is not None:
                return draft

        drafts = self.repository.list_draft_versions(document.id)
        return drafts[-1] if drafts else None

    def _quality_gate(
        self,
        current_draft: DraftVersion | None,
        issues: list[RevisionIssue],
    ) -> QualityGateResult:
        if current_draft is None:
            return QualityGateResult(status="unknown")

        open_issues = [issue for issue in issues if issue.status in OPEN_ISSUE_STATUSES]
        blocking_issue_ids = [
            issue.id
            for issue in open_issues
            if issue.severity == "blocking"
        ]
        warning_issue_ids = [
            issue.id
            for issue in open_issues
            if issue.severity in {"warning", "info"}
        ]

        if blocking_issue_ids:
            status = "blocked"
        elif warning_issue_ids:
            status = "needs_review"
        else:
            status = "ready"

        return QualityGateResult(
            status=status,
            blocking_issue_ids=blocking_issue_ids,
            warning_issue_ids=warning_issue_ids,
        )

    def _run_status(self, document_id: str) -> RevisionRunStatusSummary | None:
        runs = self.repository.list_revision_runs(document_id)
        if not runs:
            return None

        latest_run = runs[-1]
        steps = self.repository.list_agent_steps(latest_run.id)
        current_step = None
        for step in steps:
            if step.status in {"pending", "running"}:
                current_step = step.agent_name
                break
        if current_step is None and steps:
            current_step = steps[-1].agent_name

        return RevisionRunStatusSummary(
            run_id=latest_run.id,
            status=latest_run.status,
            current_step=current_step,
        )

    def _available_actions(
        self,
        issues: list[RevisionIssue],
        proposals: list[RevisionProposal],
    ) -> list[ContextualAction]:
        actions: list[ContextualAction] = []
        for issue in issues:
            if issue.status not in OPEN_ISSUE_STATUSES:
                continue

            issue_actions = self.repository.list_revision_actions(issue.id)
            if issue_actions:
                actions.extend(
                    ContextualAction(
                        id=action.id,
                        label=action.label,
                        action_type=action.action_type,
                        target=action.target or self._issue_target(issue),
                    )
                    for action in issue_actions
                )
            else:
                actions.append(
                    ContextualAction(
                        id=f"act_dismiss_{issue.id}",
                        label="暂时忽略",
                        action_type="dismiss_issue",
                        target=self._issue_target(issue),
                    )
                )

        for proposal in proposals:
            if proposal.status != "pending":
                continue
            actions.append(
                ContextualAction(
                    id=f"act_accept_{proposal.id}",
                    label="接受修改",
                    action_type="accept_proposal",
                    target=proposal.target,
                )
            )
            actions.append(
                ContextualAction(
                    id=f"act_reject_{proposal.id}",
                    label="保留原文",
                    action_type="reject_proposal",
                    target=proposal.target,
                )
            )

        return actions

    def _issue_target(self, issue: RevisionIssue) -> dict[str, str]:
        target = {}
        if issue.module_id:
            target["module_id"] = issue.module_id
        if issue.item_id:
            target["item_id"] = issue.item_id
        if issue.claim_id:
            target["claim_id"] = issue.claim_id
        return target

    def _coach_summary(
        self,
        quality_gate: QualityGateResult,
        current_draft: DraftVersion | None,
        available_actions: list[ContextualAction],
    ) -> CoachSummary:
        next_action_ids = [action.id for action in available_actions[:3]]
        if current_draft is None:
            summary = "还没有生成可审阅的草稿。"
        elif quality_gate.status == "blocked":
            summary = f"还有 {len(quality_gate.blocking_issue_ids)} 个阻塞问题需要先处理。"
        elif quality_gate.status == "needs_review":
            summary = f"还有 {len(quality_gate.warning_issue_ids)} 个问题建议处理后再导出。"
        else:
            summary = "当前草稿已准备好进入导出前检查。"

        return CoachSummary(summary=summary, next_action_ids=next_action_ids)


class RenderService:
    def __init__(
        self,
        repository: RevisionRepository,
        projection_builder: DraftProjectionBuilder | None = None,
    ) -> None:
        self.repository = repository
        self.projection_builder = projection_builder or DraftProjectionBuilder()

    def save_projection(self, projection: RenderProjection) -> RenderProjection:
        return self.repository.save_render_projection(projection)

    def get_projection(self, projection_id: str) -> RenderProjection | None:
        return self.repository.get_render_projection(projection_id)

    def build_projection_for_draft(
        self,
        draft_id: str,
        *,
        render_profile: str | None = None,
    ) -> RenderProjection:
        draft = self.repository.get_draft_version(draft_id)
        if draft is None:
            raise RevisionServiceError(f"Draft not found: {draft_id}")

        modules = self.repository.list_document_modules(draft.id)
        projection = self.projection_builder.build(
            draft,
            modules,
            render_profile=render_profile,
        )
        self.repository.save_render_projection(projection)
        self.repository.save_draft_version(
            draft.model_copy(
                update={
                    "render_projection_id": projection.id,
                    "updated_at": utc_now(),
                }
            )
        )
        return projection


class ExportService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def save_artifact(self, artifact: ExportArtifact) -> ExportArtifact:
        return self.repository.save_export_artifact(artifact)

    def list_artifacts(self, document_id: str) -> list[ExportArtifact]:
        return self.repository.list_export_artifacts(document_id)
