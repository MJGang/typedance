import pytest
from pydantic import BaseModel

from typedance_sidecar.db import connect
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_agent_runtime import (
    AgentInputRef,
    AgentRuntime,
    AgentRuntimeError,
    AgentSchemaRegistry,
    build_agent_context,
)
from typedance_sidecar.revision_models import RevisionRun
from typedance_sidecar.revision_repository import RevisionRepository


class ExampleAgentPayload(BaseModel):
    summary: str
    output_ids: list[str]


def make_repository(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def seed_run(repo: RevisionRepository) -> RevisionRun:
    now = utc_now()
    return repo.save_revision_run(
        RevisionRun(
            id="run_1",
            document_id="doc_1",
            pack_id="resume",
            run_type="quality_review",
            status="created",
            source_document_ids=[],
            created_at=now,
            updated_at=now,
        )
    )


def make_runtime(repo: RevisionRepository) -> AgentRuntime:
    registry = AgentSchemaRegistry()
    registry.register("ExampleAgentPayload", ExampleAgentPayload)
    return AgentRuntime(repo, registry)


def test_agent_runtime_records_completed_step(tmp_path):
    repo = make_repository(tmp_path)
    run = seed_run(repo)
    runtime = make_runtime(repo)
    context = build_agent_context(
        run,
        agent_name="ResumeReviewer",
        input_refs=[AgentInputRef(object_type="DraftVersion", object_id="draft_1")],
    )

    def runner(received_context):
        return {
            "invocation_id": received_context.invocation_id,
            "run_id": received_context.run_id,
            "document_id": received_context.document_id,
            "pack_id": received_context.pack_id,
            "agent_name": received_context.agent_name,
            "output_type": "ExampleAgentPayload",
            "confidence": 0.91,
            "warnings": [],
            "payload": {
                "summary": "发现 1 个问题",
                "output_ids": ["issue_1"],
            },
            "output_refs": ["RevisionIssue:issue_1"],
        }

    result = runtime.invoke(context, runner)
    steps = repo.list_agent_steps(run.id)

    assert isinstance(result.payload, ExampleAgentPayload)
    assert result.payload.summary == "发现 1 个问题"
    assert result.step.status == "completed"
    assert steps == [result.step]
    assert steps[0].input_refs == ["DraftVersion:draft_1"]
    assert steps[0].output_refs == ["RevisionIssue:issue_1"]


def test_agent_runtime_marks_schema_failure_and_retryable_run(tmp_path):
    repo = make_repository(tmp_path)
    run = seed_run(repo)
    runtime = make_runtime(repo)
    context = build_agent_context(run, agent_name="ResumeReviewer")

    def runner(received_context):
        return {
            "invocation_id": received_context.invocation_id,
            "run_id": received_context.run_id,
            "document_id": received_context.document_id,
            "pack_id": received_context.pack_id,
            "agent_name": received_context.agent_name,
            "output_type": "ExampleAgentPayload",
            "confidence": 0.9,
            "warnings": [],
            "payload": {"summary": "缺少 output_ids"},
        }

    with pytest.raises(AgentRuntimeError) as exc_info:
        runtime.invoke(context, runner)

    step = repo.list_agent_steps(run.id)[0]
    failed_run = repo.get_revision_run(run.id)

    assert exc_info.value.step_status == "failed_schema"
    assert exc_info.value.retryable is True
    assert step.status == "failed_schema"
    assert step.error is not None
    assert step.error["code"] == "payload_schema_invalid"
    assert failed_run is not None
    assert failed_run.status == "failed_retryable"


def test_agent_runtime_marks_context_mismatch_as_policy_failure(tmp_path):
    repo = make_repository(tmp_path)
    run = seed_run(repo)
    runtime = make_runtime(repo)
    context = build_agent_context(run, agent_name="ResumeReviewer")

    def runner(received_context):
        return {
            "invocation_id": received_context.invocation_id,
            "run_id": received_context.run_id,
            "document_id": received_context.document_id,
            "pack_id": received_context.pack_id,
            "agent_name": "OtherAgent",
            "output_type": "ExampleAgentPayload",
            "confidence": 0.8,
            "warnings": [],
            "payload": {
                "summary": "看似合法但 agent 不匹配",
                "output_ids": [],
            },
        }

    with pytest.raises(AgentRuntimeError) as exc_info:
        runtime.invoke(context, runner)

    step = repo.list_agent_steps(run.id)[0]
    failed_run = repo.get_revision_run(run.id)

    assert exc_info.value.step_status == "failed_policy"
    assert exc_info.value.retryable is False
    assert step.status == "failed_policy"
    assert failed_run is not None
    assert failed_run.status == "failed_final"


def test_agent_runtime_marks_runner_exception_as_model_failure(tmp_path):
    repo = make_repository(tmp_path)
    run = seed_run(repo)
    runtime = make_runtime(repo)
    context = build_agent_context(run, agent_name="ResumeReviewer")

    def runner(_received_context):
        raise RuntimeError("model provider timeout")

    with pytest.raises(AgentRuntimeError) as exc_info:
        runtime.invoke(context, runner)

    step = repo.list_agent_steps(run.id)[0]
    failed_run = repo.get_revision_run(run.id)

    assert exc_info.value.step_status == "failed_model"
    assert exc_info.value.retryable is True
    assert step.status == "failed_model"
    assert step.error is not None
    assert step.error["message"] == "model provider timeout"
    assert failed_run is not None
    assert failed_run.status == "failed_retryable"


def test_agent_runtime_marks_unknown_output_type_as_schema_failure(tmp_path):
    repo = make_repository(tmp_path)
    run = seed_run(repo)
    runtime = make_runtime(repo)
    context = build_agent_context(run, agent_name="ResumeReviewer")

    def runner(received_context):
        return {
            "invocation_id": received_context.invocation_id,
            "run_id": received_context.run_id,
            "document_id": received_context.document_id,
            "pack_id": received_context.pack_id,
            "agent_name": received_context.agent_name,
            "output_type": "UnknownPayload",
            "confidence": 0.8,
            "warnings": [],
            "payload": {},
        }

    with pytest.raises(AgentRuntimeError) as exc_info:
        runtime.invoke(context, runner)

    step = repo.list_agent_steps(run.id)[0]

    assert exc_info.value.step_status == "failed_schema"
    assert step.status == "failed_schema"
    assert step.error is not None
    assert step.error["code"] == "unknown_output_type"
