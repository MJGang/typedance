from collections.abc import Callable
from typing import Any, TypeVar
from uuid import uuid4

from pydantic import BaseModel, Field, ValidationError

from .models import Language, utc_now
from .revision_models import AgentStep, AgentStepStatus, RevisionRun
from .revision_repository import RevisionRepository


SCHEMA_VERSION = "0.1.0"
PayloadModelT = TypeVar("PayloadModelT", bound=BaseModel)


class AgentInputRef(BaseModel):
    object_type: str = Field(min_length=1)
    object_id: str = Field(min_length=1)

    def to_ref(self) -> str:
        return f"{self.object_type}:{self.object_id}"


class AgentWarning(BaseModel):
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    target: dict[str, Any] | None = None


class AgentInvocationContext(BaseModel):
    invocation_id: str
    run_id: str
    document_id: str
    pack_id: str
    agent_name: str
    schema_version: str = SCHEMA_VERSION
    input_refs: list[AgentInputRef] = Field(default_factory=list)
    user_locale: Language | None = None
    target_language: Language | None = None
    created_at: str = Field(default_factory=utc_now)


class AgentOutputEnvelope(BaseModel):
    invocation_id: str
    run_id: str
    document_id: str
    pack_id: str
    agent_name: str
    output_type: str = Field(min_length=1)
    schema_version: str = SCHEMA_VERSION
    confidence: float = Field(ge=0, le=1)
    warnings: list[AgentWarning] = Field(default_factory=list)
    payload: dict[str, Any]
    output_refs: list[str] = Field(default_factory=list)


class AgentInvocationResult(BaseModel):
    context: AgentInvocationContext
    envelope: AgentOutputEnvelope
    payload: BaseModel
    step: AgentStep


class AgentRuntimeError(Exception):
    def __init__(
        self,
        *,
        step_status: AgentStepStatus,
        code: str,
        message: str,
        retryable: bool,
        details: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.step_status = step_status
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details

    def to_agent_step_error(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "details": self.details,
        }


class AgentSchemaRegistry:
    def __init__(self) -> None:
        self._schemas: dict[str, type[BaseModel]] = {}

    def register(self, output_type: str, model_type: type[PayloadModelT]) -> None:
        if output_type in self._schemas:
            raise AgentRuntimeError(
                step_status="failed_schema",
                code="schema_already_registered",
                message=f"Agent output schema already registered: {output_type}",
                retryable=False,
            )
        self._schemas[output_type] = model_type

    def validate(self, envelope: AgentOutputEnvelope) -> BaseModel:
        model_type = self._schemas.get(envelope.output_type)
        if model_type is None:
            raise AgentRuntimeError(
                step_status="failed_schema",
                code="unknown_output_type",
                message=f"Agent output type is not registered: {envelope.output_type}",
                retryable=True,
            )

        try:
            return model_type.model_validate(envelope.payload)
        except ValidationError as exc:
            raise AgentRuntimeError(
                step_status="failed_schema",
                code="payload_schema_invalid",
                message=f"Agent payload failed schema validation: {envelope.output_type}",
                retryable=True,
                details=exc.errors(),
            ) from exc


AgentRunner = Callable[[AgentInvocationContext], AgentOutputEnvelope | dict[str, Any]]


def build_agent_context(
    run: RevisionRun,
    *,
    agent_name: str,
    input_refs: list[AgentInputRef] | None = None,
    user_locale: Language | None = None,
    target_language: Language | None = None,
) -> AgentInvocationContext:
    return AgentInvocationContext(
        invocation_id=f"inv_{uuid4().hex}",
        run_id=run.id,
        document_id=run.document_id,
        pack_id=run.pack_id,
        agent_name=agent_name,
        input_refs=input_refs or [],
        user_locale=user_locale,
        target_language=target_language,
    )


class AgentRuntime:
    def __init__(
        self,
        repository: RevisionRepository,
        schema_registry: AgentSchemaRegistry,
    ) -> None:
        self.repository = repository
        self.schema_registry = schema_registry

    def invoke(
        self,
        context: AgentInvocationContext,
        runner: AgentRunner,
    ) -> AgentInvocationResult:
        running_step = self._start_step(context)
        try:
            raw_output = runner(context)
            envelope = self._coerce_envelope(raw_output)
            self._assert_envelope_matches_context(context, envelope)
            payload = self.schema_registry.validate(envelope)
        except AgentRuntimeError as exc:
            self._fail_step(context.run_id, running_step, exc)
            self._fail_run(context.run_id, exc)
            raise
        except ValidationError as exc:
            error = AgentRuntimeError(
                step_status="failed_schema",
                code="envelope_schema_invalid",
                message="Agent output envelope failed schema validation.",
                retryable=True,
                details=exc.errors(),
            )
            self._fail_step(context.run_id, running_step, error)
            self._fail_run(context.run_id, error)
            raise error from exc
        except Exception as exc:
            error = AgentRuntimeError(
                step_status="failed_model",
                code="runner_failed",
                message=str(exc),
                retryable=True,
            )
            self._fail_step(context.run_id, running_step, error)
            self._fail_run(context.run_id, error)
            raise error from exc

        completed_step = running_step.model_copy(
            update={
                "status": "completed",
                "output_refs": envelope.output_refs,
                "finished_at": utc_now(),
            }
        )
        self.repository.save_agent_step(completed_step)
        return AgentInvocationResult(
            context=context,
            envelope=envelope,
            payload=payload,
            step=completed_step,
        )

    def _start_step(self, context: AgentInvocationContext) -> AgentStep:
        now = utc_now()
        step = AgentStep(
            id=f"step_{uuid4().hex}",
            run_id=context.run_id,
            agent_name=context.agent_name,
            status="running",
            input_refs=[ref.to_ref() for ref in context.input_refs],
            output_refs=[],
            started_at=now,
        )
        return self.repository.save_agent_step(step)

    def _fail_step(
        self,
        run_id: str,
        step: AgentStep,
        error: AgentRuntimeError,
    ) -> AgentStep:
        failed_step = step.model_copy(
            update={
                "run_id": run_id,
                "status": error.step_status,
                "error": error.to_agent_step_error(),
                "finished_at": utc_now(),
            }
        )
        return self.repository.save_agent_step(failed_step)

    def _fail_run(self, run_id: str, error: AgentRuntimeError) -> None:
        run = self.repository.get_revision_run(run_id)
        if run is None:
            return

        status = "failed_retryable" if error.retryable else "failed_final"
        failed_run = run.model_copy(
            update={
                "status": status,
                "output_summary": error.message,
                "updated_at": utc_now(),
            }
        )
        self.repository.save_revision_run(failed_run)

    def _coerce_envelope(
        self,
        output: AgentOutputEnvelope | dict[str, Any],
    ) -> AgentOutputEnvelope:
        if isinstance(output, AgentOutputEnvelope):
            return output
        return AgentOutputEnvelope.model_validate(output)

    def _assert_envelope_matches_context(
        self,
        context: AgentInvocationContext,
        envelope: AgentOutputEnvelope,
    ) -> None:
        mismatches = {}
        for field in ["invocation_id", "run_id", "document_id", "pack_id", "agent_name"]:
            context_value = getattr(context, field)
            envelope_value = getattr(envelope, field)
            if context_value != envelope_value:
                mismatches[field] = {
                    "context": context_value,
                    "envelope": envelope_value,
                }

        if envelope.schema_version != context.schema_version:
            mismatches["schema_version"] = {
                "context": context.schema_version,
                "envelope": envelope.schema_version,
            }

        if mismatches:
            raise AgentRuntimeError(
                step_status="failed_policy",
                code="envelope_context_mismatch",
                message="Agent output envelope does not match invocation context.",
                retryable=False,
                details=mismatches,
            )
