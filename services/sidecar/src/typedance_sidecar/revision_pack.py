from __future__ import annotations

from collections.abc import Iterable

from pydantic import BaseModel, Field

from .revision_models import IssueSeverity, ModuleVisibility


class PackRegistryError(Exception):
    pass


class ModuleSpec(BaseModel):
    type: str = Field(min_length=1)
    title: str = Field(min_length=1)
    required: bool = False
    repeatable: bool = False
    default_visibility: ModuleVisibility = "visible"


class IssueTypeSpec(BaseModel):
    type: str = Field(min_length=1)
    default_severity: IssueSeverity
    title: str = Field(min_length=1)


class ActionSpec(BaseModel):
    action_type: str = Field(min_length=1)
    label: str = Field(min_length=1)


class QualityRule(BaseModel):
    id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    severity: IssueSeverity


class EvidenceRule(BaseModel):
    id: str = Field(min_length=1)
    claim_type: str = Field(min_length=1)
    requires_evidence: bool
    requires_user_confirmation_when_missing: bool


class RenderMapping(BaseModel):
    default_profile: str = Field(min_length=1)
    supported_profiles: list[str] = Field(default_factory=list)


class DocumentPack(BaseModel):
    id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    modules: list[ModuleSpec] = Field(default_factory=list)
    issue_types: list[IssueTypeSpec] = Field(default_factory=list)
    actions: list[ActionSpec] = Field(default_factory=list)
    quality_rules: list[QualityRule] = Field(default_factory=list)
    evidence_rules: list[EvidenceRule] = Field(default_factory=list)
    render_mapping: RenderMapping


class PackRegistry:
    def __init__(self, packs: Iterable[DocumentPack] | None = None) -> None:
        self._packs: dict[str, DocumentPack] = {}
        for pack in packs or []:
            self.register(pack)

    def register(self, pack: DocumentPack) -> DocumentPack:
        if pack.id in self._packs:
            raise PackRegistryError(f"Pack already registered: {pack.id}")

        self._validate_pack(pack)
        self._packs[pack.id] = pack
        return pack

    def list(self) -> list[DocumentPack]:
        return sorted(self._packs.values(), key=lambda pack: pack.id)

    def get(self, pack_id: str) -> DocumentPack:
        pack = self._packs.get(pack_id)
        if pack is None:
            raise PackRegistryError(f"Pack not found: {pack_id}")
        return pack

    def get_module_spec(self, pack_id: str, module_type: str) -> ModuleSpec:
        pack = self.get(pack_id)
        for module in pack.modules:
            if module.type == module_type:
                return module
        raise PackRegistryError(f"Module spec not found: {pack_id}/{module_type}")

    def get_issue_type_spec(self, pack_id: str, issue_type: str) -> IssueTypeSpec:
        pack = self.get(pack_id)
        for spec in pack.issue_types:
            if spec.type == issue_type:
                return spec
        raise PackRegistryError(f"Issue type spec not found: {pack_id}/{issue_type}")

    def get_action_spec(self, pack_id: str, action_type: str) -> ActionSpec:
        pack = self.get(pack_id)
        for action in pack.actions:
            if action.action_type == action_type:
                return action
        raise PackRegistryError(f"Action spec not found: {pack_id}/{action_type}")

    def get_quality_rule(self, pack_id: str, rule_id: str) -> QualityRule:
        pack = self.get(pack_id)
        for rule in pack.quality_rules:
            if rule.id == rule_id:
                return rule
        raise PackRegistryError(f"Quality rule not found: {pack_id}/{rule_id}")

    def get_evidence_rule(self, pack_id: str, rule_id: str) -> EvidenceRule:
        pack = self.get(pack_id)
        for rule in pack.evidence_rules:
            if rule.id == rule_id:
                return rule
        raise PackRegistryError(f"Evidence rule not found: {pack_id}/{rule_id}")

    def _validate_pack(self, pack: DocumentPack) -> None:
        self._ensure_unique("module type", [module.type for module in pack.modules])
        self._ensure_unique("issue type", [issue.type for issue in pack.issue_types])
        self._ensure_unique("action type", [action.action_type for action in pack.actions])
        self._ensure_unique("quality rule", [rule.id for rule in pack.quality_rules])
        self._ensure_unique("evidence rule", [rule.id for rule in pack.evidence_rules])
        if pack.render_mapping.default_profile not in pack.render_mapping.supported_profiles:
            raise PackRegistryError(
                f"Default render profile is not supported: {pack.render_mapping.default_profile}"
            )

    def _ensure_unique(self, label: str, values: list[str]) -> None:
        duplicates = sorted({value for value in values if values.count(value) > 1})
        if duplicates:
            raise PackRegistryError(f"Duplicate {label}: {', '.join(duplicates)}")
