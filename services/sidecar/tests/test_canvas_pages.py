import base64
import re
import struct
from concurrent.futures import ThreadPoolExecutor
from threading import get_ident
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from typedance_sidecar.canvas_pages import cleanup_canvas_pages, render_canvas_pages
from typedance_sidecar.db import connect
from typedance_sidecar.main import app
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_models import CanvasPrintSnapshot, Document
from typedance_sidecar.revision_repository import RevisionRepository


def snapshot():
    return CanvasPrintSnapshot(html='<div style="width:794px;height:2246px;position:absolute">'
                               '<div style="height:1123px;background:red">第一页最新内容</div>'
                               '<div style="height:1123px;background:blue">第二页最新内容</div></div>',
                               page_width=794, page_height=1123, page_tops=[0, 1123])


@pytest.fixture(autouse=True)
def close_renderer():
    cleanup_canvas_pages()
    yield
    cleanup_canvas_pages()


def test_selected_page_images_preserve_order_and_use_static_isolated_context(monkeypatch):
    manager = MagicMock()
    browser = manager.start.return_value.chromium.launch.return_value
    context = browser.new_context.return_value
    page = context.new_page.return_value
    page.locator.return_value.nth.return_value.screenshot.return_value = b"0" * 16 + struct.pack(">II", 794, 1123)
    monkeypatch.setattr("typedance_sidecar.canvas_pages.sync_playwright", lambda: manager)
    result = render_canvas_pages(snapshot(), [2, 1], title="当前简历")
    assert result["page_count"] == 2
    assert [item["page"] for item in result["pages"]] == [2, 1]
    html = page.set_content.call_args.args[0]
    offsets = re.findall(r'class="td-canvas-print-origin" style="top: (-?[\d.]+)px', html)
    assert [float(offset) for offset in offsets] == [-1123, 0]
    assert "script-src 'none'" in html
    context.route.assert_called_once()
    browser.new_context.assert_called_once_with(java_script_enabled=False, service_workers="block", viewport={"width": 1000, "height": 1200})
    context.close.assert_called_once()
    browser.close.assert_not_called()
    second = render_canvas_pages(snapshot(), [1], title="另一份简历")
    assert result["timings"]["browser_reused"] is False
    assert second["timings"]["browser_reused"] is True
    assert browser.new_context.call_count == context.close.call_count == 2
    manager.start.return_value.chromium.launch.assert_called_once()
    cleanup_canvas_pages()
    browser.close.assert_called_once()
    manager.start.return_value.stop.assert_called_once()


def test_concurrent_rendering_and_shutdown_share_one_playwright_owner_thread(monkeypatch):
    manager = MagicMock()
    browser = manager.start.return_value.chromium.launch.return_value
    page = browser.new_context.return_value.new_page.return_value
    owners = []
    manager.start.side_effect = lambda: (owners.append(get_ident()), manager.start.return_value)[1]
    browser.new_context.side_effect = lambda **kwargs: (owners.append(get_ident()), browser.new_context.return_value)[1]
    browser.close.side_effect = lambda: owners.append(get_ident())
    page.locator.return_value.nth.return_value.screenshot.return_value = b"0" * 16 + struct.pack(">II", 794, 1123)
    monkeypatch.setattr("typedance_sidecar.canvas_pages.sync_playwright", lambda: manager)
    with ThreadPoolExecutor(max_workers=2) as callers:
        results = list(callers.map(lambda number: render_canvas_pages(snapshot(), [number], title="并发"), [1, 2]))
    cleanup_canvas_pages()
    assert len(set(owners)) == 1
    assert owners[0] != get_ident()
    assert [result["pages"][0]["page"] for result in results] == [1, 2]
    assert sum(result["timings"]["browser_reused"] for result in results) == 1


def test_failed_screenshot_closes_context_and_keeps_next_request_usable(monkeypatch):
    manager = MagicMock()
    browser = manager.start.return_value.chromium.launch.return_value
    context = browser.new_context.return_value
    capture = context.new_page.return_value.locator.return_value.nth.return_value.screenshot
    capture.side_effect = [RuntimeError("capture failed"), b"0" * 16 + struct.pack(">II", 794, 1123)]
    monkeypatch.setattr("typedance_sidecar.canvas_pages.sync_playwright", lambda: manager)
    with pytest.raises(RuntimeError, match="capture failed"):
        render_canvas_pages(snapshot(), [1], title="失败")
    assert context.close.call_count == 1
    assert render_canvas_pages(snapshot(), [2], title="恢复")["pages"][0]["page"] == 2
    assert context.close.call_count == 2


@pytest.mark.parametrize("pages", [[0], [3], [1, 1]])
def test_bad_page_numbers_are_rejected_before_starting_browser(pages, monkeypatch):
    start = MagicMock()
    monkeypatch.setattr("typedance_sidecar.canvas_pages.sync_playwright", start)
    with pytest.raises(ValueError):
        render_canvas_pages(snapshot(), pages, title="简历")
    start.assert_not_called()


def test_real_page_images_differ_and_api_does_not_create_exports_or_save_canvas(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    repo = RevisionRepository(connect(tmp_path / "typedance.sqlite"))
    now = utc_now()
    repo.save_document(Document(id="doc_pages", pack_id="resume", title="页面截图", template_id="classic-a4", status="active", target_language="zh-CN", created_at=now, updated_at=now))
    client = TestClient(app)
    payload = {"print_snapshot": snapshot().model_dump(), "pages": [2, 1]}
    response = client.post("/documents/doc_pages/source-resume-canvas/pages", json=payload)
    assert response.status_code == 200
    images = response.json()["pages"]
    decoded = [base64.b64decode(image["image_url"].split(",", 1)[1]) for image in images]
    assert all(image.startswith(b"\x89PNG") for image in decoded)
    assert decoded[0] != decoded[1]
    assert [image["page"] for image in images] == [2, 1]
    assert all(790 <= image["width"] <= 800 and 1120 <= image["height"] <= 1130 for image in images)
    assert repo.get_source_resume_canvas("doc_pages") is None
    assert repo.list_export_artifacts("doc_pages") == []
    assert client.post("/documents/missing/source-resume-canvas/pages", json=payload).status_code == 404
    assert client.post("/documents/doc_pages/source-resume-canvas/pages", json={**payload, "pages": [1] * 7}).status_code == 422
