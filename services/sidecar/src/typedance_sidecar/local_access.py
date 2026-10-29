"""仅允许桌面协调层授权的当前账号进程访问本机业务能力。"""

import hmac
import os
import re
from collections.abc import Callable, Sequence

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

ALLOWED_ORIGINS = (
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
)
_TOKEN = re.compile(r"[A-Za-z0-9_-]{32,512}\Z")
_HOST = re.compile(r"(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?\Z", re.IGNORECASE)


def require_local_token(value: str | None) -> str:
    if value is None or not _TOKEN.fullmatch(value):
        raise RuntimeError("A desktop-issued local service token is required")
    return value


class LocalAccessMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        token_provider: Callable[[], str | None] | None = None,
        allowed_origins: Sequence[str] = ALLOWED_ORIGINS,
    ) -> None:
        self.app = app
        self.token_provider = token_provider or (lambda: os.environ.get("TYPEDANCE_LOCAL_TOKEN"))
        self.allowed_origins = frozenset(allowed_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers: dict[bytes, list[bytes]] = {}
        for name, value in scope.get("headers", []):
            headers.setdefault(name.lower(), []).append(value)
        hosts = headers.get(b"host", [])
        origins = headers.get(b"origin", [])
        origin = origins[0].decode("latin-1") if len(origins) == 1 else None
        trusted_origin = origin in self.allowed_origins

        async def protected_send(message):
            if message["type"] == "http.response.start":
                response_headers = [(key, value) for key, value in message.get("headers", []) if key.lower() != b"cache-control"]
                response_headers.append((b"cache-control", b"no-store"))
                if trusted_origin and not any(key.lower() == b"access-control-allow-origin" for key, _ in response_headers):
                    response_headers.extend([(b"access-control-allow-origin", origins[0]), (b"vary", b"Origin")])
                message = {**message, "headers": response_headers}
            await send(message)

        async def reject(status: int, detail: str) -> None:
            await JSONResponse({"detail": detail}, status_code=status)(scope, receive, protected_send)

        if len(hosts) != 1 or not _HOST.fullmatch(hosts[0].decode("latin-1")):
            await reject(403, "invalid_host")
            return
        if len(origins) > 1 or (origins and not trusted_origin):
            await reject(403, "untrusted_origin")
            return
        if scope["method"] == "OPTIONS":
            if not trusted_origin:
                await reject(403, "origin_required")
                return
        else:
            try:
                token = require_local_token(self.token_provider())
            except RuntimeError:
                await reject(503, "local_session_unavailable")
                return
            authorization = headers.get(b"authorization", [])
            if len(authorization) != 1 or not hmac.compare_digest(authorization[0], f"Bearer {token}".encode("ascii")):
                await reject(401, "unauthorized")
                return
        await self.app(scope, receive, protected_send)
