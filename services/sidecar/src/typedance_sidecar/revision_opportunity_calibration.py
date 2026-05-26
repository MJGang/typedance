from uuid import uuid4

from .models import utc_now
from .resume_agent_outputs import (
    OpportunityCalibrationOutput,
    RevisionIssueDraft,
    RevisionProposalDraft,
    register_resume_agent_output_schemas,
)
from .resume_opportunity_calibrator_runner import (
    OpportunityCalibratorRunRequest,
    OpportunityCalibratorRunner,
    RuleBasedOpportunityCalibratorRunner,
)
from .revision_agent_runtime import (
    AgentInputRef,
    AgentRuntime,
    AgentRuntimeError,
    AgentSchemaRegistry,
    build_agent_context,
)
from .revision_models import (
    AgentStep,
    Document,
    DocumentClaim,
    DocumentModule,
    DraftVersion,
    ParsedBlock,
    RevisionIssue,
    RevisionProposal,
    RevisionRun,
    SourceDocument,
)
from .revision_repository import RevisionRepository
from .revision_services import RenderService, RevisionServiceError


class RevisionOpportunityCalibrationService:
    def __init__(
        self,
        repository: RevisionRepository,
        calibrator_runner: OpportunityCalibratorRunner | None = None,
    ) -> None:
        self.repository = repository
        self.calibrator_runner = calibrator_runner or RuleBasedOpportunityCalibratorRunner()

    def run_opportunity_calibrate(self, document_id: str, run_id: str) -> RevisionRun:
        document = self.repository.get_document(document_id)
        if document is None:
            raise RevisionServiceError(f"Document not found: {document_id}")

        run = self.repository.get_revision_run(run_id)
        if run is None:
            raise RevisionServiceError(f"Revision run not found: {run_id}")
        if run.run_type != "opportunity_calibrate":
            raise RevisionServiceError(f"Unsupported opportunity calibration run type: {run.run_type}")

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
        base_draft = self._base_draft(document, run)
        if base_draft is None:
            raise RevisionServiceError("Opportunity calibration requires a base draft")

        source = self._opportunity_source(document.id, run.source_document_ids)
        if source is None or not (source.raw_text or "").strip():
            raise RevisionServiceError("Opportunity calibration requires external context")

        self._parse_source(source, run.id)
        self._save_step(run.id, "ParseOpportunity")

        variant = self._create_variant_draft(document, run, base_draft, source)
        module_map = self._copy_modules(base_draft, variant)
        self._copy_claims(base_draft, variant, module_map)
        self._save_step(run.id, "CreateOpportunityDraft")

        modules = self.repository.list_document_modules(variant.id)
        claims = self.repository.list_document_claims(variant.id)
        calibration_output, calibrator_step = self._invoke_calibrator_agent(
            document,
            run,
            source,
            base_draft,
            variant,
            modules,
            claims,
        )

        issues = self._build_issues(document, run, variant, calibration_output.issues)
        for issue in issues:
            self.repository.save_revision_issue(issue)
        proposals = self._build_proposals(document, run, variant, calibration_output.proposals, issues)
        for proposal in proposals:
            self.repository.save_revision_proposal(proposal)
        self.repository.save_agent_step(
            calibrator_step.model_copy(
                update={
                    "output_refs": [
                        *[f"RevisionIssue:{issue.id}" for issue in issues],
                        *[f"RevisionProposal:{proposal.id}" for proposal in proposals],
                    ]
                }
            )
        )

        projection = RenderService(self.repository).build_projection_for_draft(variant.id)
        updated_variant = self.repository.get_draft_version(variant.id) or variant
        updated_variant = updated_variant.model_copy(
            update={
                "summary": calibration_output.variant_plan.title,
                "unresolved_issue_ids": [issue.id for issue in issues],
                "render_projection_id": projection.id,
                "updated_at": utc_now(),
            }
        )
        self.repository.save_draft_version(updated_variant)

        completed_run = run.model_copy(
            update={
                "status": "completed",
                "target_draft_id": updated_variant.id,
                "output_summary": f"已生成岗位版本，并标记 {len(issues)} 个岗位校准问题。",
                "updated_at": utc_now(),
            }
        )
        self.repository.save_revision_run(completed_run)
        self.repository.save_document(
            document.model_copy(
                update={
                    "current_draft_id": updated_variant.id,
                    "updated_at": utc_now(),
                }
            )
        )
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
        return None

    def _opportunity_source(self, document_id: str, source_ids: list[str]) -> SourceDocument | None:
        sources = [
            source
            for source in self.repository.list_source_documents(document_id)
            if source.source_type == "external_context"
        ]
        if source_ids:
            selected_ids = set(source_ids)
            sources = [source for source in sources if source.id in selected_ids]
        return sources[-1] if sources else None

    def _parse_source(self, source: SourceDocument, run_id: str) -> list[ParsedBlock]:
        lines = [line.strip() for line in (source.raw_text or "").splitlines() if line.strip()]
        blocks = []
        for order, line in enumerate(lines):
            block = ParsedBlock(
                id=f"block_{uuid4().hex}",
                source_document_id=source.id,
                type="paragraph",
                text=line,
                order=order,
                source_span={"run_id": run_id, "line": order},
            )
            self.repository.save_parsed_block(block)
            blocks.append(block)
        self.repository.save_source_document(source.model_copy(update={"parse_status": "parsed"}))
        return blocks

    def _create_variant_draft(
        self,
        document: Document,
        run: RevisionRun,
        base_draft: DraftVersion,
        source: SourceDocument,
    ) -> DraftVersion:
        now = utc_now()
        return self.repository.save_draft_version(
            DraftVersion(
                id=f"draft_{uuid4().hex}",
                document_id=document.id,
                run_id=run.id,
                pack_id=document.pack_id,
                status="in_review",
                summary=f"{source.title}岗位版本",
                variant_type="opportunity",
                created_at=now,
                updated_at=now,
            )
        )

    def _copy_modules(self, base_draft: DraftVersion, variant: DraftVersion) -> dict[str, str]:
        module_map: dict[str, str] = {}
        now = utc_now()
        for module in self.repository.list_document_modules(base_draft.id):
            copied = module.model_copy(
                update={
                    "id": f"mod_{uuid4().hex}",
                    "draft_id": variant.id,
                    "created_at": now,
                    "updated_at": now,
                }
            )
            self.repository.save_document_module(copied)
            module_map[module.id] = copied.id
        return module_map

    def _copy_claims(
        self,
        base_draft: DraftVersion,
        variant: DraftVersion,
        module_map: dict[str, str],
    ) -> None:
        now = utc_now()
        for claim in self.repository.list_document_claims(base_draft.id):
            module_id = module_map.get(claim.module_id)
            if module_id is None:
                continue
            self.repository.save_document_claim(
                claim.model_copy(
                    update={
                        "id": f"claim_{uuid4().hex}",
                        "draft_id": variant.id,
                        "module_id": module_id,
                        "created_at": now,
                        "updated_at": now,
                    }
                )
            )

    def _invoke_calibrator_agent(
        self,
        document: Document,
        run: RevisionRun,
        source: SourceDocument,
        base_draft: DraftVersion,
        variant: DraftVersion,
        modules: list[DocumentModule],
        claims: list[DocumentClaim],
    ):
        runtime = AgentRuntime(
            self.repository,
            register_resume_agent_output_schemas(AgentSchemaRegistry()),
        )
        input_refs = [
            AgentInputRef(object_type="SourceDocument", object_id=source.id),
            AgentInputRef(object_type="DraftVersion", object_id=base_draft.id),
            AgentInputRef(object_type="DraftVersion", object_id=variant.id),
            *[AgentInputRef(object_type="DocumentModule", object_id=module.id) for module in modules],
            *[AgentInputRef(object_type="DocumentClaim", object_id=claim.id) for claim in claims],
        ]
        context = build_agent_context(
            run,
            agent_name="OpportunityCalibrator",
            input_refs=input_refs,
            target_language=document.target_language,
        )
        request = OpportunityCalibratorRunRequest(
            source_title=source.title,
            source_text=source.raw_text or "",
            base_draft_id=base_draft.id,
            variant_draft_id=variant.id,
            modules=modules,
            claims=claims,
        )

        def runner(received_context):
            return self.calibrator_runner(received_context, request)

        result = runtime.invoke(context, runner)
        if not isinstance(result.payload, OpportunityCalibrationOutput):
            raise RevisionServiceError("OpportunityCalibrator returned unexpected payload")
        return result.payload, result.step

    def _build_issues(
        self,
        document: Document,
        run: RevisionRun,
        variant: DraftVersion,
        issue_drafts: list[RevisionIssueDraft],
    ) -> list[RevisionIssue]:
        now = utc_now()
        return [
            RevisionIssue(
                id=f"issue_{uuid4().hex}",
                run_id=run.id,
                document_id=document.id,
                draft_id=variant.id,
                module_id=issue_draft.target.module_id,
                item_id=issue_draft.target.item_id,
                claim_id=issue_draft.target.claim_id,
                type=issue_draft.type,
                severity=issue_draft.severity,
                title=issue_draft.title,
                message=issue_draft.message,
                reason=issue_draft.reason,
                status="open",
                created_by_agent="OpportunityCalibrator",
                original_text=issue_draft.original_text,
                evidence_link_ids=issue_draft.evidence_link_refs,
                created_at=now,
            )
            for issue_draft in issue_drafts
        ]

    def _build_proposals(
        self,
        document: Document,
        run: RevisionRun,
        variant: DraftVersion,
        proposal_drafts: list[RevisionProposalDraft],
        issues: list[RevisionIssue],
    ) -> list[RevisionProposal]:
        now = utc_now()
        return [
            RevisionProposal(
                id=f"prop_{uuid4().hex}",
                run_id=run.id,
                document_id=document.id,
                draft_id=variant.id,
                target=proposal_draft.target.model_dump(exclude_none=True),
                operation=proposal_draft.operation,
                original_snapshot=proposal_draft.before,
                proposed_snapshot=proposal_draft.after,
                summary=proposal_draft.summary,
                rationale=proposal_draft.rationale,
                related_issue_ids=self._related_issue_ids(proposal_draft.related_issue_refs, issues),
                evidence_link_ids=proposal_draft.evidence_link_refs,
                confidence=proposal_draft.confidence,
                risk_level=proposal_draft.risk_level,
                requires_user_confirmation=proposal_draft.requires_user_confirmation,
                status="pending",
                created_by_agent="OpportunityCalibrator",
                created_at=now,
            )
            for proposal_draft in proposal_drafts
        ]

    def _related_issue_ids(self, refs: list[str], issues: list[RevisionIssue]) -> list[str]:
        related_ids: list[str] = []
        for ref in refs:
            if ref.startswith("RevisionIssue:"):
                related_ids.append(ref.removeprefix("RevisionIssue:"))
                continue
            related_ids.extend(issue.id for issue in issues if issue.type == ref)
        return related_ids

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
