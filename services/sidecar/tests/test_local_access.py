from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware

from typedance_sidecar.local_access import ALLOWED_ORIGINS, LocalAccessMiddleware


TOKEN_A = "account_a_" + "a" * 40
TOKEN_B = "account_b_" + "b" * 40


def protected_client(token=TOKEN_A):
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"status": "ok"}

    app.add_middleware(CORSMiddleware, allow_origins=list(ALLOWED_ORIGINS), allow_methods=["*"], allow_headers=["content-type", "authorization"])
    app.add_middleware(LocalAccessMiddleware, token_provider=lambda: token)
    return TestClient(app, base_url="http://127.0.0.1:49999")


def test_health_requires_current_account_capability():
    with protected_client() as client:
        assert client.get("/health").status_code == 401
        assert client.get("/health", headers={"authorization": f"Bearer {TOKEN_B}"}).status_code == 401
        response = client.get("/health", headers={"authorization": f"Bearer {TOKEN_A}"})
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"


def test_other_account_token_does_not_authorize_new_profile():
    with protected_client(TOKEN_B) as client:
        assert client.get("/health", headers={"authorization": f"Bearer {TOKEN_A}"}).status_code == 401
        assert client.get("/health", headers={"authorization": f"Bearer {TOKEN_B}"}).status_code == 200


def test_valid_token_does_not_allow_host_spoofing_or_untrusted_origin():
    with protected_client() as client:
        headers = {"authorization": f"Bearer {TOKEN_A}"}
        assert client.get("/health", headers={**headers, "host": "evil.example"}).status_code == 403
        assert client.get("/health", headers={**headers, "origin": "https://evil.example"}).status_code == 403
        assert client.get("/health", headers={**headers, "origin": "http://tauri.localhost"}).status_code == 200


def test_duplicate_credentials_and_missing_desktop_session_are_rejected():
    with protected_client() as client:
        assert client.get("/health", headers=[("authorization", f"Bearer {TOKEN_A}"), ("authorization", f"Bearer {TOKEN_A}")]).status_code == 401
    with protected_client(None) as client:
        assert client.get("/health", headers={"authorization": f"Bearer {TOKEN_A}"}).status_code == 503


def test_cors_preflight_only_permits_known_desktop_origin():
    with protected_client() as client:
        headers = {"origin": "http://tauri.localhost", "access-control-request-method": "PUT", "access-control-request-headers": "authorization,content-type"}
        response = client.options("/health", headers=headers)
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://tauri.localhost"
        assert client.options("/health", headers={**headers, "origin": "https://evil.example"}).status_code == 403


def test_every_real_business_entry_is_protected_before_database_or_file_access(tmp_path, monkeypatch):
    from typedance_sidecar.main import app

    monkeypatch.setenv("TYPEDANCE_LOCAL_TOKEN", TOKEN_A)
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    with TestClient(app, base_url="http://127.0.0.1") as client:
        for method, path in [
            ("GET", "/documents"), ("GET", "/openapi.json"),
            ("GET", "/previews/private.pdf"), ("POST", "/files/extract-text"),
            ("POST", "/documents/private/export/pdf"), ("POST", "/exports/html/private"),
        ]:
            assert client.request(method, path).status_code == 401
            assert client.request(method, path, headers={"authorization": f"Bearer {TOKEN_B}"}).status_code == 401
        assert client.get("/health", headers={"authorization": f"Bearer {TOKEN_A}"}).status_code == 200
    assert not (tmp_path / "typedance.sqlite").exists()


def test_duplicate_hosts_and_origins_are_rejected_before_routing():
    with protected_client() as client:
        authorization = ("authorization", f"Bearer {TOKEN_A}")
        assert client.get("/health", headers=[authorization, ("host", "127.0.0.1"), ("host", "evil.example")]).status_code == 403
        assert client.get("/health", headers=[authorization, ("origin", "tauri://localhost"), ("origin", "https://evil.example")]).status_code == 403
