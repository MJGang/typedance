from pathlib import Path

import pytest
from pytest_mock import MockerFixture
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

from typedance_sidecar.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    return TestClient(app)


@pytest.fixture
def mock_playwright(mocker: MockerFixture) -> MagicMock:
    """Mock Playwright sync API to avoid launching a real browser.

    _get_browser() calls sync_playwright().start().chromium.launch(),
    so the mock chain must cover all three levels.
    """
    import typedance_sidecar.pdf as pdf_module

    # Reset browser singleton so each test starts fresh
    pdf_module._pw = None
    pdf_module._browser = None

    mock_page = mocker.MagicMock()
    # Make page.pdf() actually write to disk so the caller can assert file existence
    def _write_pdf_on_call(**kwargs):
        path = kwargs.get("path")
        if path:
            Path(path).write_bytes(b"%PDF-1.4\n")
    mock_page.pdf.side_effect = _write_pdf_on_call

    mock_browser = mocker.MagicMock()
    mock_browser.new_page.return_value = mock_page
    mock_chromium = mocker.MagicMock()
    mock_chromium.launch.return_value = mock_browser
    # sync_playwright() returns mock_ctx; mock_ctx.start() returns mock_pw
    mock_pw = mocker.MagicMock()
    mock_pw.chromium = mock_chromium
    mock_ctx = mocker.MagicMock()
    mock_ctx.start.return_value = mock_pw
    mocker.patch("typedance_sidecar.pdf.sync_playwright", return_value=mock_ctx)
    return mock_page
