import base64
import re
import struct
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from typedance_sidecar.canvas_pages import render_canvas_pages
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


def test_selected_page_images_preserve_order_and_use_static_isolated_context(monkeypatch):
    manager = MagicMock()
    browser = manager.__enter__.return_value.chromium.launch.return_value
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
    browser.close.assert_called_once()


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
