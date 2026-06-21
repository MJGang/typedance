from fastapi import FastAPI
from fastapi.testclient import TestClient

from typedance_sidecar import main as sidecar_main


def test_allows_packaged_tauri_origin(client):
    response = client.get(
        "/documents",
        headers={"Origin": "http://tauri.localhost"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://tauri.localhost"


def test_unhandled_errors_keep_packaged_tauri_cors_header():
    inner_app = FastAPI()

    @inner_app.get("/explode")
    def explode():
        raise RuntimeError("boom")

    with_cors = getattr(sidecar_main, "with_cors", lambda application: application)
    client = TestClient(with_cors(inner_app), raise_server_exceptions=False)

    response = client.get(
        "/explode",
        headers={"Origin": "http://tauri.localhost"},
    )

    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == "http://tauri.localhost"
