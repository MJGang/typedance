import pytest

from typedance_sidecar.resume_pack import default_pack_registry, resume_pack_definition
from typedance_sidecar.revision_pack import DocumentPack, PackRegistry, PackRegistryError


def test_default_pack_registry_loads_resume_pack():
    registry = default_pack_registry()
    pack = registry.get("resume")

    assert pack == resume_pack_definition
    assert [item.id for item in registry.list()] == ["resume"]
    assert pack.render_mapping.default_profile == "default-a4"
    assert "ats" in pack.render_mapping.supported_profiles


def test_resume_pack_declares_required_modules_and_actions():
    registry = default_pack_registry()

    basic_info = registry.get_module_spec("resume", "BasicInfo")
    project_experience = registry.get_module_spec("resume", "ProjectExperience")
    request_input = registry.get_action_spec("resume", "request_user_input")
    confirm_claim = registry.get_action_spec("resume", "confirm_claim")

    assert basic_info.required is True
    assert basic_info.title == "基本信息"
    assert project_experience.repeatable is True
    assert not hasattr(request_input, "creates_run_type")
    assert confirm_claim.label == "确认真实"


def test_resume_pack_declares_quality_issue_and_evidence_rules():
    registry = default_pack_registry()

    missing_evidence = registry.get_issue_type_spec("resume", "missing_evidence")
    contact_rule = registry.get_quality_rule("resume", "resume_contact_required")
    evidence_rule = registry.get_evidence_rule("resume", "achievement_requires_evidence")

    assert missing_evidence.default_severity == "blocking"
    assert contact_rule.severity == "blocking"
    assert evidence_rule.claim_type == "achievement"
    assert evidence_rule.requires_user_confirmation_when_missing is True


def test_pack_registry_rejects_duplicate_pack_ids():
    registry = PackRegistry([resume_pack_definition])

    with pytest.raises(PackRegistryError, match="Pack already registered"):
        registry.register(resume_pack_definition)


def test_pack_registry_reports_missing_specs():
    registry = default_pack_registry()

    with pytest.raises(PackRegistryError, match="Pack not found"):
        registry.get("blog")
    with pytest.raises(PackRegistryError, match="Module spec not found"):
        registry.get_module_spec("resume", "UnknownModule")
    with pytest.raises(PackRegistryError, match="Issue type spec not found"):
        registry.get_issue_type_spec("resume", "unknown_issue")
    with pytest.raises(PackRegistryError, match="Action spec not found"):
        registry.get_action_spec("resume", "unknown_action")
    with pytest.raises(PackRegistryError, match="Quality rule not found"):
        registry.get_quality_rule("resume", "unknown_rule")
    with pytest.raises(PackRegistryError, match="Evidence rule not found"):
        registry.get_evidence_rule("resume", "unknown_rule")


def test_pack_registry_rejects_invalid_pack_definitions():
    invalid_pack = DocumentPack(
        id="invalid",
        version="0.1.0",
        modules=[
            {"type": "BasicInfo", "title": "基本信息"},
            {"type": "BasicInfo", "title": "重复基本信息"},
        ],
        issue_types=[],
        actions=[],
        quality_rules=[],
        evidence_rules=[],
        render_mapping={
            "default_profile": "default-a4",
            "supported_profiles": ["ats"],
        },
    )

    with pytest.raises(PackRegistryError, match="Duplicate module type"):
        PackRegistry([invalid_pack])

    unsupported_default = DocumentPack(
        id="unsupported-default",
        version="0.1.0",
        modules=[{"type": "BasicInfo", "title": "基本信息"}],
        issue_types=[],
        actions=[],
        quality_rules=[],
        evidence_rules=[],
        render_mapping={
            "default_profile": "default-a4",
            "supported_profiles": ["ats"],
        },
    )

    with pytest.raises(PackRegistryError, match="Default render profile is not supported"):
        PackRegistry([unsupported_default])
