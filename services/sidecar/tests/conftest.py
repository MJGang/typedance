import pytest
from fastapi.testclient import TestClient

from typedance_sidecar.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    return TestClient(app)
