import re
from dataclasses import dataclass
from uuid import uuid4

from .models import utc_now
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


CONTACT_EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
CONTACT_PHONE_RE = re.compile(r"(?:\+?86[- ]?)?1[3-9]\d{9}")
DATE_RANGE_RE = re.compile(r"\d{4}[./-]\d{1,2}\s*[-至~]\s*(?:\d{4}[./-]\d{1,2}|至今|现在)")
METRIC_RE = re.compile(r"\d|%|％|倍|万|千|百|人|次|元|小时|天|周|月")

SECTION_ALIASES: list[tuple[tuple[str, ...], str, str]] = [
    (("工作经历", "工作经验", "实习经历", "任职经历"), "WorkExperience", "工作经历"),
    (("项目经历", "项目经验", "项目"), "ProjectExperience", "项目经历"),
    (("专业技能", "相关技能", "技能", "技能清单"), "CoreSkills", "专业技能"),
    (("教育经历", "教育背景", "学历"), "Education", "教育经历"),
    (("自我评价", "个人评价", "个人总结"), "SelfEvaluation", "自我评价"),
    (("求职意向", "职业意向"), "JobIntent", "求职意向"),
]


@dataclass
class ImportSection:
    module_type: str
    title: str
    blocks: list[ParsedBlock]


class RevisionImportFlowService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def run_import_reconstruct(self, document_id: str, run_id: str) -> RevisionRun:
        document = self.repository.get_document(document_id)
        if document is None:
            raise RevisionServiceError(f"Document not found: {document_id}")

        run = self.repository.get_revision_run(run_id)
        if run is None:
            raise RevisionServiceError(f"Revision run not found: {run_id}")
        if run.run_type != "import_reconstruct":
            raise RevisionServiceError(f"Unsupported import flow run type: {run.run_type}")

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
            raise RevisionServiceError("Import flow requires at least one source")

        parsed_blocks = self._parse_sources(sources, run.id)
        if not parsed_blocks:
            raise RevisionServiceError("Import source has no text")

        self._save_step(run.id, "ParseSource")
        now = utc_now()
        draft = self.repository.save_draft_version(
            DraftVersion(
                id=f"draft_{uuid4().hex}",
                document_id=document.id,
                run_id=run.id,
                pack_id=document.pack_id,
                status="in_review",
                summary="基于旧简历生成的结构化草稿",
                created_at=now,
                updated_at=now,
            )
        )

        modules = self._build_modules(document, draft, parsed_blocks)
        for module in modules:
            self.repository.save_document_module(module)
        self._save_step(run.id, "StructureResume")

        claims = self._build_claims(draft, modules, parsed_blocks)
        for claim in claims:
            self.repository.save_document_claim(claim)

        evidence_links = self._build_evidence(document, sources[0], claims)
        for evidence in evidence_links:
            self.repository.save_evidence_link(evidence)

        issues = self._build_issues(document, run, draft, modules, claims, evidence_links)
        for issue in issues:
            self.repository.save_revision_issue(issue)
        self._save_step(run.id, "ReviewDraft")

        proposals = self._build_proposals(document, run, draft, issues, evidence_links)
        for proposal in proposals:
            self.repository.save_revision_proposal(proposal)
        self._save_step(run.id, "GenerateProposals")

        updated_draft = draft.model_copy(
            update={
                "unresolved_issue_ids": [issue.id for issue in issues],
                "updated_at": utc_now(),
            }
        )
        self.repository.save_draft_version(updated_draft)
        projection = RenderService(self.repository).build_projection_for_draft(updated_draft.id)
        self._save_step(run.id, "RenderProjection")

        completed_run = run.model_copy(
            update={
                "status": "completed",
                "target_draft_id": updated_draft.id,
                "output_summary": f"已从 {len(sources)} 份旧简历来源生成结构化草稿，并创建 {len(issues)} 个待处理问题。",
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
        sources = self.repository.list_source_documents(document_id)
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
                    type=self._block_type(line),
                    text=line,
                    order=len(parsed_blocks) + order,
                    source_span={"run_id": run_id, "line": order},
                )
                self.repository.save_parsed_block(block)
                parsed_blocks.append(block)

            self.repository.save_source_document(source.model_copy(update={"parse_status": "parsed"}))

        return parsed_blocks

    def _block_type(self, text: str) -> str:
        if self._section_for(text) is not None:
            return "heading"
        if CONTACT_EMAIL_RE.search(text) or CONTACT_PHONE_RE.search(text):
            return "contact"
        if DATE_RANGE_RE.search(text):
            return "date_range"
        if text.startswith(("-", "*", "•", "·")):
            return "list"
        return "paragraph"

    def _section_for(self, text: str) -> tuple[str, str] | None:
        normalized = text.strip().rstrip(":：")
        for aliases, module_type, title in SECTION_ALIASES:
            if normalized in aliases:
                return module_type, title
        return None

    def _build_modules(
        self,
        document: Document,
        draft: DraftVersion,
        parsed_blocks: list[ParsedBlock],
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
                data=self._basic_info_data(document, parsed_blocks),
                created_at=now,
                updated_at=now,
            )
        ]

        sections = self._sections(parsed_blocks)
        for index, section in enumerate(sections, start=1):
            modules.append(
                DocumentModule(
                    id=f"mod_{uuid4().hex}",
                    draft_id=draft.id,
                    pack_id=document.pack_id,
                    type=section.module_type,
                    title=section.title,
                    order=index,
                    visibility="visible",
                    status="needs_review" if section.module_type != "CoreSkills" else "needs_confirmation",
                    data=self._module_data(section),
                    created_at=now,
                    updated_at=now,
                )
            )

        if len(modules) == 1:
            modules.append(
                DocumentModule(
                    id=f"mod_{uuid4().hex}",
                    draft_id=draft.id,
                    pack_id=document.pack_id,
                    type="ImportedContent",
                    title="导入内容",
                    order=1,
                    visibility="visible",
                    status="needs_review",
                    data={"items": [block.text for block in parsed_blocks if block.type != "contact"]},
                    created_at=now,
                    updated_at=now,
                )
            )

        return modules

    def _basic_info_data(self, document: Document, blocks: list[ParsedBlock]) -> dict[str, object]:
        text = "\n".join(block.text for block in blocks)
        name = next(
            (
                block.text
                for block in blocks
                if block.type == "paragraph"
                and len(block.text) <= 12
                and self._section_for(block.text) is None
            ),
            document.title,
        )
        return {
            "name": name,
            "headline": "候选人简历",
            "phone": self._first_match(CONTACT_PHONE_RE, text),
            "email": self._first_match(CONTACT_EMAIL_RE, text),
        }

    def _first_match(self, pattern: re.Pattern[str], text: str) -> str | None:
        match = pattern.search(text)
        return match.group(0) if match else None

    def _sections(self, blocks: list[ParsedBlock]) -> list[ImportSection]:
        sections: list[ImportSection] = []
        current: ImportSection | None = None
        for block in blocks:
            section = self._section_for(block.text)
            if section is not None:
                current = ImportSection(module_type=section[0], title=section[1], blocks=[])
                sections.append(current)
                continue
            if block.type == "contact":
                continue
            if current is not None:
                current.blocks.append(block)

        return [section for section in sections if section.blocks]

    def _module_data(self, section: ImportSection) -> dict[str, object]:
        if section.module_type == "CoreSkills":
            skills = [
                skill
                for block in section.blocks
                for skill in re.split(r"[、,，;；\s]+", block.text)
                if skill
            ]
            return {"items": skills}

        return {"items": self._experience_items(section.blocks)}

    def _experience_items(self, blocks: list[ParsedBlock]) -> list[dict[str, object]]:
        items: list[dict[str, object]] = []
        current: dict[str, object] | None = None

        for block in blocks:
            text = block.text.lstrip("-*•· ").strip()
            if not text:
                continue

            if current is None or self._looks_like_item_heading(text):
                current = self._item_from_heading(text)
                items.append(current)
                continue

            bullets = current.setdefault("bullets", [])
            if isinstance(bullets, list):
                bullets.append(text)

        return items

    def _looks_like_item_heading(self, text: str) -> bool:
        return bool(DATE_RANGE_RE.search(text) or " / " in text or len(text) <= 18)

    def _item_from_heading(self, text: str) -> dict[str, object]:
        parts = [part.strip() for part in text.split("/") if part.strip()]
        if len(parts) >= 3:
            return {"role": parts[0], "company": parts[1], "time_range": parts[2], "bullets": []}
        if len(parts) == 2:
            return {"title": parts[0], "organization": parts[1], "bullets": []}
        return {"title": text, "bullets": []}

    def _build_claims(
        self,
        draft: DraftVersion,
        modules: list[DocumentModule],
        parsed_blocks: list[ParsedBlock],
    ) -> list[DocumentClaim]:
        block_by_text = {block.text.lstrip("-*•· ").strip(): block for block in parsed_blocks}
        claims: list[DocumentClaim] = []
        now = utc_now()
        for module in modules:
            if module.type == "BasicInfo":
                continue

            for text in self._claim_texts(module):
                block = block_by_text.get(text)
                claims.append(
                    DocumentClaim(
                        id=f"claim_{uuid4().hex}",
                        draft_id=draft.id,
                        module_id=module.id,
                        text=text,
                        claim_type=self._claim_type(module.type),
                        confidence="supported" if block else "inferred",
                        source_span_refs=[block.id] if block else [],
                        created_at=now,
                        updated_at=now,
                    )
                )

        return claims

    def _claim_texts(self, module: DocumentModule) -> list[str]:
        texts: list[str] = []
        items = module.data.get("items")
        if not isinstance(items, list):
            return texts

        for item in items:
            if isinstance(item, str):
                texts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            for key in ("title", "role", "company", "organization", "description"):
                value = item.get(key)
                if isinstance(value, str) and value:
                    texts.append(value)
            bullets = item.get("bullets")
            if isinstance(bullets, list):
                texts.extend(bullet for bullet in bullets if isinstance(bullet, str) and bullet)

        return texts

    def _claim_type(self, module_type: str) -> str:
        return {
            "CoreSkills": "skill",
            "Education": "education",
            "SelfEvaluation": "summary",
            "JobIntent": "intent",
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
                support_level="direct" if claim.confidence == "supported" else "inferred",
                confidence=0.82 if claim.confidence == "supported" else 0.55,
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
        evidence_links: list[EvidenceLink],
    ) -> list[RevisionIssue]:
        evidence_by_claim = {evidence.claim_id: evidence for evidence in evidence_links}
        module_by_id = {module.id: module for module in modules}
        now = utc_now()
        issues: list[RevisionIssue] = []

        basic_info = next((module for module in modules if module.type == "BasicInfo"), None)
        if basic_info is not None and (not basic_info.data.get("phone") or not basic_info.data.get("email")):
            issues.append(
                RevisionIssue(
                    id=f"issue_{uuid4().hex}",
                    run_id=run.id,
                    document_id=document.id,
                    draft_id=draft.id,
                    module_id=basic_info.id,
                    type="missing_contact",
                    severity="warning",
                    title="联系方式需要补齐",
                    message="旧简历里没有同时识别到电话和邮箱，投递前建议补齐。",
                    reason="联系方式缺失会影响 HR 后续联系。",
                    status="open",
                    created_by_agent="ImportReconstructOrchestrator",
                    created_at=now,
                )
            )

        for claim in claims:
            module = module_by_id.get(claim.module_id)
            if module is None or module.type not in {"WorkExperience", "ProjectExperience", "ImportedContent"}:
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
                    message="这条经历更像职责描述，还没有体现业务结果或影响范围。",
                    reason="结果和规模能让简历从“做过什么”变成“做成了什么”。",
                    status="open",
                    created_by_agent="ImportReconstructOrchestrator",
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
        evidence_by_claim = {evidence.claim_id: evidence for evidence in evidence_links}
        proposals: list[RevisionProposal] = []
        now = utc_now()
        for issue in issues:
            if issue.type != "missing_result" or issue.claim_id is None or issue.original_text is None:
                continue

            evidence = evidence_by_claim.get(issue.claim_id)
            proposals.append(
                RevisionProposal(
                    id=f"prop_{uuid4().hex}",
                    run_id=run.id,
                    document_id=document.id,
                    draft_id=draft.id,
                    target={"claim_id": issue.claim_id, "module_id": issue.module_id},
                    operation="replace_claim",
                    original_snapshot={"text": issue.original_text},
                    proposed_snapshot={
                        "text": f"{issue.original_text}，并补充可确认的业务结果、规模或效率指标。"
                    },
                    summary="补成结果导向表达",
                    rationale="旧简历原文保留了事实动作，但缺少可验证的结果信息，需要用户确认后补充。",
                    related_issue_ids=[issue.id],
                    evidence_link_ids=[evidence.id] if evidence else [],
                    confidence=0.72,
                    risk_level="medium",
                    requires_user_confirmation=True,
                    status="pending",
                    created_by_agent="ImportReconstructOrchestrator",
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
