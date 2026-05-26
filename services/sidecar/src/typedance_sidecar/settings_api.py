from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .llm_provider import LlmProviderError, build_chat_model
from .model_settings import (
    AgentModeConfig,
    ModelConfig,
    ModelSettingsError,
    ModelSettingsFile,
    resolve_model_settings,
    save_model_auth,
    save_model_config,
)


DataDirDependency = Callable[[], Path]


class ModelSettingsUpdateRequest(BaseModel):
    model: ModelConfig
    agents: AgentModeConfig
    api_key: str | None = Field(default=None, min_length=1)


class ModelSettingsTestResponse(BaseModel):
    ok: bool
    message: str


def _redacted_response(data_dir: Path) -> dict[str, Any]:
    resolved = resolve_model_settings(data_dir=data_dir)
    return resolved.model_dump(exclude={"api_key": {"value"}})


def create_settings_router(data_dir_dependency: DataDirDependency) -> APIRouter:
    router = APIRouter(prefix="/settings", tags=["settings"])

    @router.get("/model")
    def get_model_settings() -> dict[str, Any]:
        try:
            return _redacted_response(data_dir_dependency())
        except ModelSettingsError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.put("/model")
    def update_model_settings(payload: ModelSettingsUpdateRequest) -> dict[str, Any]:
        data_dir = data_dir_dependency()
        try:
            save_model_config(data_dir, ModelSettingsFile(model=payload.model, agents=payload.agents))
            if payload.api_key is not None:
                save_model_auth(data_dir, api_key=payload.api_key)
            return _redacted_response(data_dir)
        except ModelSettingsError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.delete("/model/api-key")
    def clear_model_api_key() -> dict[str, Any]:
        data_dir = data_dir_dependency()
        try:
            save_model_auth(data_dir, api_key=None)
            return _redacted_response(data_dir)
        except ModelSettingsError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/model/test", response_model=ModelSettingsTestResponse)
    def test_model_settings() -> ModelSettingsTestResponse:
        try:
            model = build_chat_model(data_dir=data_dir_dependency())
            model.invoke([{"role": "user", "content": "Reply with OK."}])
            return ModelSettingsTestResponse(ok=True, message="模型连接成功")
        except (LlmProviderError, ModelSettingsError, Exception) as exc:
            return ModelSettingsTestResponse(ok=False, message=str(exc))

    return router
