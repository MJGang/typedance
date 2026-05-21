import re
from uuid import uuid4

from .models import utc_now
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


STOPWORDS = {
    "要求",
    "岗位",
    "职责",
    "负责",
    "熟悉",
    "具备",
    "优先",
    "相关",
    "经验",
    "能力",
    "以上",
    "开发",
    "工程师",
}


class RevisionOpportunityCalibrationService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

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

        parsed_blocks = self._parse_source(source, run.id)
        requirements = self._requirements(source.raw_text or "")
        self._save_step(run.id, "ParseOpportunity")

        variant = self._create_variant_draft(document, run, base_draft, source)
        module_map = self._copy_modules(base_draft, variant)
        self._copy_claims(base_draft, variant, module_map)
        self._save_step(run.id, "CreateOpportunityDraft")

        issues = self._build_issues(document, run, variant, requirements)
        for issue in issues:
            self.repository.save_revision_issue(issue)
        proposals = self._build_proposals(document, run, variant, issues)
        for proposal in proposals:
            self.repository.save_revision_proposal(proposal)
        self._save_step(run.id, "MarkOpportunityGaps")

        projection = RenderService(self.repository).build_projection_for_draft(variant.id)
        updated_variant = self.repository.get_draft_version(variant.id) or variant
        updated_variant = updated_variant.model_copy(
            update={
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

    def _requirements(self, raw_text: str) -> list[str]:
        tokens = re.findall(r"[A-Za-z][A-Za-z0-9+#.]*|[\u4e00-\u9fff]{2,}", raw_text)
        requirements: list[str] = []
        seen: set[str] = set()
        for token in tokens:
            normalized = token.strip(".,，。:：;；、").strip()
            if not normalized or normalized in STOPWORDS:
                continue
            key = normalized.lower()
            if key in seen:
                continue
            seen.add(key)
            requirements.append(normalized)
        return requirements[:12]

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

    def _build_issues(
        self,
        document: Document,
        run: RevisionRun,
        variant: DraftVersion,
        requirements: list[str],
    ) -> list[RevisionIssue]:
        modules = self.repository.list_document_modules(variant.id)
        claims = self.repository.list_document_claims(variant.id)
        base_text = "\n".join(
            [
                *[self._module_text(module) for module in modules],
                *[claim.text for claim in claims],
            ]
        ).lower()
        missing = [requirement for requirement in requirements if requirement.lower() not in base_text]
        now = utc_now()
        issues: list[RevisionIssue] = []
        target_module_id = next((module.id for module in modules if module.type == "CoreSkills"), None)

        for requirement in missing[:6]:
            issues.append(
                RevisionIssue(
                    id=f"issue_{uuid4().hex}",
                    run_id=run.id,
                    document_id=document.id,
                    draft_id=variant.id,
                    module_id=target_module_id,
                    type="missing_opportunity_requirement",
                    severity="warning",
                    title=f"岗位要求未匹配：{requirement}",
                    message="基础简历中没有找到这项岗位要求的可靠表述。",
                    reason="岗位版本只能基于用户已有事实生成，缺口需要补充证据后再写入。",
                    status="open",
                    created_by_agent="OpportunityCalibrationOrchestrator",
                    created_at=now,
                )
            )

        if len(missing) >= 3:
            issues.append(
                RevisionIssue(
                    id=f"issue_{uuid4().hex}",
                    run_id=run.id,
                    document_id=document.id,
                    draft_id=variant.id,
                    module_id=target_module_id,
                    type="overfit_risk",
                    severity="warning",
                    title="存在过度贴合岗位的风险",
                    message="岗位要求中有多项无法从基础简历中得到支持，不应直接写进经历。",
                    reason="系统不能为了匹配 JD 而虚构用户事实。",
                    status="open",
                    created_by_agent="OpportunityCalibrationOrchestrator",
                    created_at=now,
                )
            )

        return issues

    def _module_text(self, module: DocumentModule) -> str:
        values: list[str] = [module.title]
        items = module.data.get("items")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, str):
                    values.append(item)
                elif isinstance(item, dict):
                    values.extend(str(value) for value in item.values() if isinstance(value, str))
                    bullets = item.get("bullets")
                    if isinstance(bullets, list):
                        values.extend(str(bullet) for bullet in bullets if isinstance(bullet, str))
        else:
            values.extend(str(value) for value in module.data.values() if isinstance(value, str))
        return "\n".join(values)

    def _build_proposals(
        self,
        document: Document,
        run: RevisionRun,
        variant: DraftVersion,
        issues: list[RevisionIssue],
    ) -> list[RevisionProposal]:
        now = utc_now()
        proposals: list[RevisionProposal] = []
        for issue in issues:
            if issue.type == "missing_opportunity_requirement":
                instruction = "如果你真实具备这项要求，请补充项目、工作经历或技能证据；否则保持简历不写该项。"
                summary = "补充岗位要求证据"
            else:
                instruction = "保持基础事实，不要为了匹配岗位而加入未经确认的经历或技能。"
                summary = "避免过度贴合"

            proposals.append(
                RevisionProposal(
                    id=f"prop_{uuid4().hex}",
                    run_id=run.id,
                    document_id=document.id,
                    draft_id=variant.id,
                    target={"module_id": issue.module_id},
                    operation="insert_claim",
                    proposed_snapshot={"instruction": instruction},
                    summary=summary,
                    rationale="岗位版本必须以基础简历中的真实事实为边界。",
                    related_issue_ids=[issue.id],
                    confidence=0.7,
                    risk_level="medium",
                    requires_user_confirmation=True,
                    status="pending",
                    created_by_agent="OpportunityCalibrationOrchestrator",
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
