import re
from uuid import uuid4

from .models import utc_now
from .revision_import_flow import CONTACT_EMAIL_RE, CONTACT_PHONE_RE, METRIC_RE
from .revision_models import (
    AgentStep,
    Document,
    DocumentClaim,
    DocumentModule,
    DraftVersion,
    EvidenceLink,
    ParsedBlock,
    RevisionIssue,
    RevisionProposal,
    RevisionRun,
    SourceDocument,
)
from .revision_repository import RevisionRepository
from .revision_services import RenderService, RevisionServiceError
from .revision_source_canvas import BlankSourceResumeCanvasBuilder


FIELD_ALIASES = {
    "身份": "identity_status",
    "身份状态": "identity_status",
    "姓名": "name",
    "名字": "name",
    "电话": "phone",
    "手机": "phone",
    "邮箱": "email",
    "目标": "target_role",
    "目标方向": "target_role",
    "求职方向": "target_role",
    "岗位": "target_role",
    "技能": "skills",
    "专业技能": "skills",
    "工作经历": "work_experience",
    "工作经验": "work_experience",
    "实习经历": "work_experience",
    "项目经历": "project_experience",
    "项目经验": "project_experience",
    "教育经历": "education",
    "教育背景": "education",
    "自我评价": "self_evaluation",
    "个人评价": "self_evaluation",
}


class RevisionBlankGuidedFlowService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def run_blank_guided_generate(self, document_id: str, run_id: str) -> RevisionRun:
        document = self.repository.get_document(document_id)
        if document is None:
            raise RevisionServiceError(f"Document not found: {document_id}")

        run = self.repository.get_revision_run(run_id)
        if run is None:
            raise RevisionServiceError(f"Revision run not found: {run_id}")
        if run.run_type != "blank_guided_generate":
            raise RevisionServiceError(f"Unsupported blank guided run type: {run.run_type}")

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
        sources = self._selected_sources(document.id, run.source_document_ids)
        if not sources:
            raise RevisionServiceError("Blank guided flow requires at least one source")

        parsed_blocks = self._parse_sources(sources, run.id)
        if not parsed_blocks:
            raise RevisionServiceError("Blank guided source has no text")

        fields = self._parse_fields(parsed_blocks)
        self._save_step(run.id, "ParseGuidedInput")

        now = utc_now()
        draft = self.repository.save_draft_version(
            DraftVersion(
                id=f"draft_{uuid4().hex}",
                document_id=document.id,
                run_id=run.id,
                pack_id=document.pack_id,
                status="in_review",
                summary="基于引导信息生成的基础简历初稿",
                created_at=now,
                updated_at=now,
            )
        )

        modules = self._build_modules(document, draft, fields)
        for module in modules:
            self.repository.save_document_module(module)
        self._save_step(run.id, "GenerateInitialDraft")

        claims = self._build_claims(draft, modules, fields)
        for claim in claims:
            self.repository.save_document_claim(claim)

        evidence_links = self._build_evidence(document, sources[0], claims)
        for evidence in evidence_links:
            self.repository.save_evidence_link(evidence)

        issues = self._build_issues(document, run, draft, modules, claims, fields, evidence_links)
        for issue in issues:
            self.repository.save_revision_issue(issue)

        proposals = self._build_proposals(document, run, draft, issues, evidence_links)
        for proposal in proposals:
            self.repository.save_revision_proposal(proposal)
        self._save_step(run.id, "BuildGuidedTasks")

        updated_draft = draft.model_copy(
            update={
                "unresolved_issue_ids": [issue.id for issue in issues],
                "updated_at": utc_now(),
            }
        )
        self.repository.save_draft_version(updated_draft)
        projection = RenderService(self.repository).build_projection_for_draft(updated_draft.id)
        if self.repository.get_source_resume_canvas(document.id) is None:
            self.repository.save_source_resume_canvas(
                BlankSourceResumeCanvasBuilder().blank(
                    document_id=document.id,
                    source_id=sources[0].id,
                    title=document.title,
                )
            )
            self._save_step(run.id, "BuildBlankSourceCanvas")
        self._save_step(run.id, "RenderProjection")

        completed_run = run.model_copy(
            update={
                "status": "completed",
                "target_draft_id": updated_draft.id,
                "output_summary": f"已根据引导信息生成基础简历，并创建 {len(issues)} 个后续补充任务。",
                "updated_at": utc_now(),
            }
        )
        updated_document = document.model_copy(
            update={
                "current_draft_id": updated_draft.id,
                "updated_at": utc_now(),
            }
        )
        self.repository.save_revision_run(completed_run)
        self.repository.save_document(updated_document)
        self.repository.save_draft_version(
            updated_draft.model_copy(
                update={
                    "render_projection_id": projection.id,
                    "updated_at": utc_now(),
                }
            )
        )
        return completed_run

    def _selected_sources(self, document_id: str, source_ids: list[str]) -> list[SourceDocument]:
        sources = [
            source
            for source in self.repository.list_source_documents(document_id)
            if source.source_type == "manual_user_input"
        ]
        if not source_ids:
            return sources

        selected_ids = set(source_ids)
        return [source for source in sources if source.id in selected_ids]

    def _parse_sources(self, sources: list[SourceDocument], run_id: str) -> list[ParsedBlock]:
        parsed_blocks: list[ParsedBlock] = []
        for source in sources:
            lines = [line.strip() for line in (source.raw_text or "").splitlines() if line.strip()]
            if not lines:
                continue

            for order, line in enumerate(lines):
                block = ParsedBlock(
                    id=f"block_{uuid4().hex}",
                    source_document_id=source.id,
                    type="contact" if CONTACT_EMAIL_RE.search(line) or CONTACT_PHONE_RE.search(line) else "paragraph",
                    text=line,
                    order=len(parsed_blocks) + order,
                    source_span={"run_id": run_id, "line": order},
                )
                self.repository.save_parsed_block(block)
                parsed_blocks.append(block)

            self.repository.save_source_document(source.model_copy(update={"parse_status": "recognized"}))

        return parsed_blocks

    def _parse_fields(self, blocks: list[ParsedBlock]) -> dict[str, str]:
        fields: dict[str, str] = {}
        free_lines: list[str] = []

        for block in blocks:
            if ":" in block.text:
                key, value = block.text.split(":", 1)
            elif "：" in block.text:
                key, value = block.text.split("：", 1)
            else:
                free_lines.append(block.text)
                continue

            canonical_key = FIELD_ALIASES.get(key.strip())
            if canonical_key is None:
                free_lines.append(block.text)
                continue
            fields[canonical_key] = value.strip()

        if free_lines:
            fields["extra_notes"] = "\n".join(free_lines)
        return fields

    def _build_modules(
        self,
        document: Document,
        draft: DraftVersion,
        fields: dict[str, str],
    ) -> list[DocumentModule]:
        now = utc_now()
        modules = [
            DocumentModule(
                id=f"mod_{uuid4().hex}",
                draft_id=draft.id,
                pack_id=document.pack_id,
                type="BasicInfo",
                title="基本信息",
                order=0,
                visibility="visible",
                status="needs_confirmation",
                data={
                    "name": fields.get("name") or document.title,
                    "headline": fields.get("target_role") or "候选人简历",
                    "phone": fields.get("phone"),
                    "email": fields.get("email"),
                },
                created_at=now,
                updated_at=now,
            ),
            DocumentModule(
                id=f"mod_{uuid4().hex}",
                draft_id=draft.id,
                pack_id=document.pack_id,
                type="JobIntent",
                title="求职意向",
                order=1,
                visibility="visible",
                status="needs_confirmation" if fields.get("target_role") else "weak",
                data={
                    "items": [
                        item
                        for item in [
                            fields.get("identity_status"),
                            fields.get("target_role"),
                        ]
                        if item
                    ]
                },
                created_at=now,
                updated_at=now,
            ),
            DocumentModule(
                id=f"mod_{uuid4().hex}",
                draft_id=draft.id,
                pack_id=document.pack_id,
                type="CoreSkills",
                title="专业技能",
                order=2,
                visibility="visible",
                status="needs_confirmation" if fields.get("skills") else "weak",
                data={"items": self._split_items(fields.get("skills"))},
                created_at=now,
                updated_at=now,
            ),
            DocumentModule(
                id=f"mod_{uuid4().hex}",
                draft_id=draft.id,
                pack_id=document.pack_id,
                type="WorkExperience",
                title="工作经历",
                order=3,
                visibility="visible",
                status="needs_review" if fields.get("work_experience") else "weak",
                data={"items": self._experience_items(fields.get("work_experience"), "工作经历线索")},
                created_at=now,
                updated_at=now,
            ),
            DocumentModule(
                id=f"mod_{uuid4().hex}",
                draft_id=draft.id,
                pack_id=document.pack_id,
                type="ProjectExperience",
                title="项目经历",
                order=4,
                visibility="visible",
                status="needs_review" if fields.get("project_experience") else "weak",
                data={"items": self._experience_items(fields.get("project_experience"), "项目经历线索")},
                created_at=now,
                updated_at=now,
            ),
        ]

        if fields.get("education"):
            modules.append(
                DocumentModule(
                    id=f"mod_{uuid4().hex}",
                    draft_id=draft.id,
                    pack_id=document.pack_id,
                    type="Education",
                    title="教育经历",
                    order=5,
                    visibility="visible",
                    status="needs_confirmation",
                    data={"items": self._split_items(fields.get("education"))},
                    created_at=now,
                    updated_at=now,
                )
            )

        return modules

    def _split_items(self, value: str | None) -> list[str]:
        if not value:
            return []
        return [item.strip() for item in re.split(r"[、,，;；\n]+", value) if item.strip()]

    def _experience_items(self, value: str | None, title: str) -> list[dict[str, object]]:
        items = self._split_items(value)
        if not items:
            return []
        return [{"title": title, "bullets": items}]

    def _build_claims(
        self,
        draft: DraftVersion,
        modules: list[DocumentModule],
        fields: dict[str, str],
    ) -> list[DocumentClaim]:
        now = utc_now()
        claims: list[DocumentClaim] = []
        for module in modules:
            for text in self._claim_texts(module):
                claims.append(
                    DocumentClaim(
                        id=f"claim_{uuid4().hex}",
                        draft_id=draft.id,
                        module_id=module.id,
                        text=text,
                        claim_type=self._claim_type(module.type),
                        confidence="user_confirmed" if module.type == "BasicInfo" else "inferred",
                        created_at=now,
                        updated_at=now,
                    )
                )

        extra_notes = fields.get("extra_notes")
        if extra_notes:
            target_module = next((module for module in modules if module.type == "JobIntent"), modules[0])
            claims.append(
                DocumentClaim(
                    id=f"claim_{uuid4().hex}",
                    draft_id=draft.id,
                    module_id=target_module.id,
                    text=extra_notes,
                    claim_type="summary",
                    confidence="inferred",
                    created_at=now,
                    updated_at=now,
                )
            )
        return claims

    def _claim_texts(self, module: DocumentModule) -> list[str]:
        if module.type == "BasicInfo":
            return [
                value
                for value in [
                    module.data.get("name"),
                    module.data.get("headline"),
                    module.data.get("phone"),
                    module.data.get("email"),
                ]
                if isinstance(value, str) and value
            ]

        items = module.data.get("items")
        if not isinstance(items, list):
            return []

        texts: list[str] = []
        for item in items:
            if isinstance(item, str):
                texts.append(item)
            elif isinstance(item, dict):
                title = item.get("title")
                if isinstance(title, str) and title:
                    texts.append(title)
                bullets = item.get("bullets")
                if isinstance(bullets, list):
                    texts.extend(bullet for bullet in bullets if isinstance(bullet, str) and bullet)
        return texts

    def _claim_type(self, module_type: str) -> str:
        return {
            "BasicInfo": "summary",
            "JobIntent": "intent",
            "CoreSkills": "skill",
            "Education": "education",
        }.get(module_type, "responsibility")

    def _build_evidence(
        self,
        document: Document,
        source: SourceDocument,
        claims: list[DocumentClaim],
    ) -> list[EvidenceLink]:
        now = utc_now()
        return [
            EvidenceLink(
                id=f"ev_{uuid4().hex}",
                document_id=document.id,
                source_document_id=source.id,
                claim_id=claim.id,
                support_level="direct",
                confidence=0.76,
                user_confirmed=False,
                extracted_text=claim.text,
                normalized_fact=claim.text,
                created_at=now,
            )
            for claim in claims
        ]

    def _build_issues(
        self,
        document: Document,
        run: RevisionRun,
        draft: DraftVersion,
        modules: list[DocumentModule],
        claims: list[DocumentClaim],
        fields: dict[str, str],
        evidence_links: list[EvidenceLink],
    ) -> list[RevisionIssue]:
        now = utc_now()
        module_by_type = {module.type: module for module in modules}
        evidence_by_claim = {evidence.claim_id: evidence for evidence in evidence_links}
        issues: list[RevisionIssue] = []

        missing_specs = [
            (
                "missing_contact",
                "BasicInfo",
                not fields.get("phone") or not fields.get("email"),
                "联系方式需要补齐",
                "电话和邮箱至少需要补齐，方便投递后被联系。",
            ),
            (
                "missing_skills",
                "CoreSkills",
                not fields.get("skills"),
                "专业技能需要补充",
                "技能是初筛和岗位匹配的基础信息。",
            ),
            (
                "missing_work_experience",
                "WorkExperience",
                not fields.get("work_experience"),
                "工作经历需要补充",
                "工作经历是社招简历最关键的判断依据。",
            ),
            (
                "missing_project_experience",
                "ProjectExperience",
                not fields.get("project_experience"),
                "项目经历需要补充",
                "项目经历能承接技能和实际产出。",
            ),
        ]

        for issue_type, module_type, missing, title, message in missing_specs:
            if not missing:
                continue
            module = module_by_type[module_type]
            issues.append(
                RevisionIssue(
                    id=f"issue_{uuid4().hex}",
                    run_id=run.id,
                    document_id=document.id,
                    draft_id=draft.id,
                    module_id=module.id,
                    type=issue_type,
                    severity="warning",
                    title=title,
                    message=message,
                    reason="空白引导只生成初稿，难写模块需要继续追问。",
                    status="open",
                    created_by_agent="BlankGuidedOrchestrator",
                    created_at=now,
                )
            )

        for claim in claims:
            module = next((item for item in modules if item.id == claim.module_id), None)
            if module is None or module.type not in {"WorkExperience", "ProjectExperience"}:
                continue
            if METRIC_RE.search(claim.text):
                continue
            evidence = evidence_by_claim.get(claim.id)
            issues.append(
                RevisionIssue(
                    id=f"issue_{uuid4().hex}",
                    run_id=run.id,
                    document_id=document.id,
                    draft_id=draft.id,
                    module_id=claim.module_id,
                    claim_id=claim.id,
                    type="missing_result",
                    severity="warning",
                    title="经历缺少结果",
                    message="这条线索还没有体现业务结果、规模或指标。",
                    reason="结果信息会显著提升简历可信度。",
                    status="open",
                    created_by_agent="BlankGuidedOrchestrator",
                    original_text=claim.text,
                    evidence_link_ids=[evidence.id] if evidence else [],
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
                proposed_snapshot = {
                    "text": f"{issue.original_text}，并补充可确认的规模、指标或业务结果。"
                }
                operation = "replace_claim"
                summary = "补成结果导向表达"
            else:
                proposed_snapshot = {
                    "instruction": "补充 1-3 条真实信息后，我会继续生成更完整的模块内容。"
                }
                operation = "insert_claim"
                summary = "继续补充模块线索"

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
                    rationale="当前信息不足，系统只能生成初稿，需要用户确认或补充事实后继续改稿。",
                    related_issue_ids=[issue.id],
                    evidence_link_ids=[evidence.id] if evidence else [],
                    confidence=0.68,
                    risk_level="medium",
                    requires_user_confirmation=True,
                    status="pending",
                    created_by_agent="BlankGuidedOrchestrator",
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
