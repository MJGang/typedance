from uuid import uuid4

from .models import utc_now
from .revision_import_flow import METRIC_RE
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


REQUIRED_MODULE_TYPES = {
    "BasicInfo": "基本信息",
    "CoreSkills": "专业技能",
    "WorkExperience": "工作经历",
    "ProjectExperience": "项目经历",
}


class RevisionQualityReviewService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

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
        issues = self._build_issues(document, run, draft, modules, claims, evidence_links)
        for issue in issues:
            self.repository.save_revision_issue(issue)

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

    def _build_issues(
        self,
        document: Document,
        run: RevisionRun,
        draft: DraftVersion,
        modules: list[DocumentModule],
        claims: list[DocumentClaim],
        evidence_links: list[EvidenceLink],
    ) -> list[RevisionIssue]:
        now = utc_now()
        module_by_type = {module.type: module for module in modules if module.visibility == "visible"}
        evidence_by_claim = {evidence.claim_id: evidence for evidence in evidence_links}
        issues: list[RevisionIssue] = []

        for module_type, title in REQUIRED_MODULE_TYPES.items():
            module = module_by_type.get(module_type)
            if module is None:
                issues.append(
                    self._issue(
                        run,
                        document,
                        draft,
                        issue_type=f"missing_{self._module_key(module_type)}",
                        severity="blocking" if module_type == "BasicInfo" else "warning",
                        title=f"{title}缺失",
                        message=f"当前草稿缺少{title}模块。",
                        reason="完整模块是基础简历质量检查的第一层。",
                        created_at=now,
                    )
                )
                continue
            if self._module_empty(module):
                issues.append(
                    self._issue(
                        run,
                        document,
                        draft,
                        issue_type=f"missing_{self._module_key(module_type)}",
                        severity="warning",
                        title=f"{title}需要补充",
                        message=f"{title}模块已经存在，但内容还不足。",
                        reason="空模块无法支撑投递或导出。",
                        module_id=module.id,
                        created_at=now,
                    )
                )

        basic = module_by_type.get("BasicInfo")
        if basic is not None and (not basic.data.get("phone") or not basic.data.get("email")):
            issues.append(
                self._issue(
                    run,
                    document,
                    draft,
                    issue_type="missing_contact",
                    severity="warning",
                    title="联系方式需要补齐",
                    message="电话和邮箱至少需要补齐，方便投递后被联系。",
                    reason="联系方式缺失会影响投递闭环。",
                    module_id=basic.id,
                    created_at=now,
                )
            )

        module_by_id = {module.id: module for module in modules}
        for claim in claims:
            module = module_by_id.get(claim.module_id)
            evidence = evidence_by_claim.get(claim.id)
            if claim.confidence == "unsupported" or claim.risk_flags:
                issues.append(
                    self._issue(
                        run,
                        document,
                        draft,
                        issue_type="claim_needs_confirmation",
                        severity="blocking",
                        title="高风险事实需要确认",
                        message="这条表述缺少可靠证据，导出前需要用户确认。",
                        reason="系统不能替用户确认未证实的经历或成果。",
                        module_id=claim.module_id,
                        claim_id=claim.id,
                        original_text=claim.text,
                        evidence_link_ids=[evidence.id] if evidence else [],
                        status="needs_user_input",
                        created_at=now,
                    )
                )
                continue

            if claim.confidence == "inferred" and evidence is None:
                issues.append(
                    self._issue(
                        run,
                        document,
                        draft,
                        issue_type="evidence_missing",
                        severity="warning",
                        title="证据不足",
                        message="这条表述来自推断，建议补充来源或用户确认。",
                        reason="可追溯证据能降低 AI 改写带来的失真风险。",
                        module_id=claim.module_id,
                        claim_id=claim.id,
                        original_text=claim.text,
                        created_at=now,
                    )
                )

            if module is not None and module.type in {"WorkExperience", "ProjectExperience"} and not METRIC_RE.search(claim.text):
                issues.append(
                    self._issue(
                        run,
                        document,
                        draft,
                        issue_type="missing_result",
                        severity="warning",
                        title="经历缺少结果",
                        message="这条经历更像职责描述，还没有体现业务结果或影响范围。",
                        reason="结果和规模能让简历从“做过什么”变成“做成了什么”。",
                        module_id=claim.module_id,
                        claim_id=claim.id,
                        original_text=claim.text,
                        evidence_link_ids=[evidence.id] if evidence else [],
                        created_at=now,
                    )
                )

        return issues

    def _issue(
        self,
        run: RevisionRun,
        document: Document,
        draft: DraftVersion,
        *,
        issue_type: str,
        severity: str,
        title: str,
        message: str,
        reason: str,
        created_at: str,
        module_id: str | None = None,
        claim_id: str | None = None,
        original_text: str | None = None,
        evidence_link_ids: list[str] | None = None,
        status: str = "open",
    ) -> RevisionIssue:
        return RevisionIssue(
            id=f"issue_{uuid4().hex}",
            run_id=run.id,
            document_id=document.id,
            draft_id=draft.id,
            module_id=module_id,
            claim_id=claim_id,
            type=issue_type,
            severity=severity,
            title=title,
            message=message,
            reason=reason,
            status=status,
            original_text=original_text,
            evidence_link_ids=evidence_link_ids or [],
            created_by_agent="QualityReviewOrchestrator",
            created_at=created_at,
        )

    def _module_empty(self, module: DocumentModule) -> bool:
        if module.type == "BasicInfo":
            return not any(module.data.get(key) for key in ("name", "phone", "email", "headline"))
        items = module.data.get("items")
        return not isinstance(items, list) or not any(items)

    def _module_key(self, module_type: str) -> str:
        return {
            "BasicInfo": "basic_info",
            "CoreSkills": "skills",
            "WorkExperience": "work_experience",
            "ProjectExperience": "project_experience",
        }.get(module_type, module_type.lower())

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
