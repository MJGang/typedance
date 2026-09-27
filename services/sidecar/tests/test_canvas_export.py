from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, get_ident
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from typedance_sidecar.canvas_export import CanvasExportService, render_canvas_snapshot_html, render_canvas_snapshot_pdf
from typedance_sidecar.db import connect
from typedance_sidecar.main import app
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_models import CanvasPrintSnapshot, Document
from typedance_sidecar.revision_repository import RevisionRepository


def snapshot_payload(**changes):
    return {
        "html": '<div style="position:absolute;width:794px"><p style="height:20px"><br></p><h2 style="margin-top:30px">项目经验</h2></div>',
        "page_width": 794,
        "page_height": 1123,
        "page_tops": [0, 1147, 2294],
        **changes,
    }


def seed_document(tmp_path):
    repo = RevisionRepository(connect(tmp_path / "typedance.sqlite"))
    now = utc_now()
    document = repo.save_document(Document(
        id="doc_canvas_export",
        pack_id="resume",
        title="当前画布",
        template_id="classic-a4",
        status="active",
        target_language="zh-CN",
        created_at=now,
        updated_at=now,
    ))
    return repo, document


def test_snapshot_html_preserves_measured_pages_and_empty_paragraphs():
    snapshot = CanvasPrintSnapshot.model_validate(snapshot_payload())
    html = render_canvas_snapshot_html(snapshot, title="画布 <分页>")

    assert html.count('class="td-canvas-print-page"') == 3
    assert html.count(snapshot.html) == 3
    assert "top: -1147px" in html
    assert "top: -2294px" in html
    assert "width: 794px" in html
    assert "height: 1123px" in html
    assert "width: 210mm" in html
    assert "height: 297mm" in html
    assert "overflow: hidden" in html
    assert "orphans: 1; widows: 1;" in html
    assert "画布 &lt;分页&gt;" in html
    assert 'http-equiv="Content-Security-Policy"' in html
    assert "default-src 'none'" in html
    assert "script-src 'none'" in html


def test_snapshot_html_removes_active_elements_and_event_handlers():
    snapshot = CanvasPrintSnapshot.model_validate(snapshot_payload(html=(
        '<div style="height:20px" onclick="alert(1)"><p>保留正文 &amp; 空格</p>'
        '<script>window.location="https://example.com/script"</script>'
        '<style>@import "https://example.com/style";</style>'
        '<meta http-equiv="refresh" content="0;url=https://example.com/refresh">'
        '<iframe src="https://example.com/frame"></iframe>'
        '<object data="https://example.com/object"></object>'
        '<link rel="stylesheet" href="https://example.com/css">'
        '<base href="https://example.com/base"></div>'
    )))

    html = render_canvas_snapshot_html(snapshot, title="静态画布")

    assert '<p>保留正文 &amp; 空格</p>' in html
    assert 'style="height:20px"' in html
    assert "https://example.com" not in html
    assert "onclick=" not in html
    assert "<script" not in html


@pytest.mark.parametrize("changes", [
    {"html": ""},
    {"html": "x" * 5_000_001},
    {"page_width": 0},
    {"page_width": float("inf")},
    {"page_height": -1},
    {"page_tops": []},
    {"page_tops": [-1]},
    {"page_tops": [0, 0]},
    {"page_tops": [1, 0]},
    {"page_tops": [float("nan")]},
])
def test_snapshot_rejects_invalid_geometry(changes):
    with pytest.raises(ValidationError):
        CanvasPrintSnapshot.model_validate(snapshot_payload(**changes))


def test_canvas_pdf_uses_isolated_context_without_scripts_or_network(tmp_path, monkeypatch):
    manager = MagicMock()
    playwright = manager.__enter__.return_value
    browser = playwright.chromium.launch.return_value
    context = browser.new_context.return_value
    page = context.new_page.return_value
    monkeypatch.setattr("typedance_sidecar.canvas_export.sync_playwright", lambda: manager)
    monkeypatch.setattr("typedance_sidecar.canvas_export._resolve_browser_config", lambda: {"executable_path": "bundled-chromium"})
    target = tmp_path / "canvas.pdf"

    render_canvas_snapshot_pdf("<p>canvas</p>", target)

    playwright.chromium.launch.assert_called_once_with(executable_path="bundled-chromium")
    browser.new_context.assert_called_once_with(java_script_enabled=False, service_workers="block")
    route_pattern, handler = context.route.call_args.args
    assert route_pattern == "**/*"
    route = MagicMock()
    handler(route)
    route.abort.assert_called_once()
    page.set_content.assert_called_once_with("<p>canvas</p>", wait_until="load")
    page.pdf.assert_called_once_with(
        path=str(target), format="A4", print_background=True, prefer_css_page_size=True,
        margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
    )
    context.close.assert_called_once()
    browser.close.assert_called_once()
    manager.__exit__.assert_called_once()


@pytest.mark.parametrize("failure_stage", ["new_context", "set_content", "pdf"])
def test_canvas_pdf_closes_playwright_and_browser_after_render_failure(tmp_path, monkeypatch, failure_stage):
    manager = MagicMock()
    browser = manager.__enter__.return_value.chromium.launch.return_value
    context = browser.new_context.return_value
    page = context.new_page.return_value
    target = browser.new_context if failure_stage == "new_context" else getattr(page, failure_stage)
    target.side_effect = RuntimeError("render failed")
    monkeypatch.setattr("typedance_sidecar.canvas_export.sync_playwright", lambda: manager)

    with pytest.raises(RuntimeError, match="render failed"):
        render_canvas_snapshot_pdf("<p>canvas</p>", tmp_path / "failed.pdf")

    if failure_stage != "new_context":
        context.close.assert_called_once()
    browser.close.assert_called_once()
    manager.__exit__.assert_called_once()


def test_canvas_pdf_owns_a_separate_playwright_lifecycle_on_each_worker_thread(tmp_path, monkeypatch):
    barrier = Barrier(2)
    sessions = []

    def create_playwright():
        owner = get_ident()
        manager = MagicMock()
        browser = manager.__enter__.return_value.chromium.launch.return_value
        context = browser.new_context.return_value
        page = context.new_page.return_value

        def assert_owner(*_args, **_kwargs):
            assert get_ident() == owner

        page.pdf.side_effect = assert_owner
        context.close.side_effect = assert_owner
        browser.close.side_effect = assert_owner
        manager.__exit__.side_effect = assert_owner
        sessions.append((owner, manager))
        return manager

    def export(index):
        barrier.wait(timeout=5)
        return render_canvas_snapshot_pdf("<p>canvas</p>", tmp_path / f"worker-{index}.pdf")

    monkeypatch.setattr("typedance_sidecar.canvas_export.sync_playwright", create_playwright)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(export, range(2)))

    assert len(results) == 2
    assert len(sessions) == 2
    assert len({owner for owner, _manager in sessions}) == 2
    for _owner, manager in sessions:
        manager.__enter__.assert_called_once()
        manager.__exit__.assert_called_once()


def test_canvas_export_records_artifact_from_snapshot_without_database_canvas(tmp_path):
    repo, document = seed_document(tmp_path)
    snapshot = CanvasPrintSnapshot.model_validate(snapshot_payload())
    captured = []

    def renderer(html: str, output_path: Path) -> Path:
        captured.append(html)
        output_path.write_bytes(b"%PDF-1.4\n")
        return output_path

    artifact = CanvasExportService(repo, output_dir=tmp_path / "exports", pdf_renderer=renderer).export_document(
        document.id, "pdf", print_snapshot=snapshot,
    )

    assert artifact.draft_id is None
    assert artifact.status == "succeeded"
    assert captured[0].count(snapshot.html) == 3
    assert repo.list_export_artifacts(document.id) == [artifact]
    assert Path(artifact.file_path).exists()


@pytest.mark.parametrize("export_format", ["pdf", "html"])
def test_canvas_export_api_requires_snapshot_and_rejects_document_export_payload(tmp_path, monkeypatch, export_format):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    seed_document(tmp_path)
    client = TestClient(app)
    url = f"/documents/doc_canvas_export/canvas-export/{export_format}"

    assert client.post(url).status_code == 422
    assert client.post(url, json={}).status_code == 422
    assert client.post(url, json={"source_doc_json": {"type": "doc", "content": []}}).status_code == 422
    assert client.post(url, json={"print_snapshot": snapshot_payload(page_tops=[0, 0])}).status_code == 422


@pytest.mark.parametrize("export_format", ["pdf", "html"])
def test_canvas_export_api_returns_snapshot_artifact(tmp_path, monkeypatch, export_format):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    seed_document(tmp_path)

    def renderer(html: str, output_path: Path) -> Path:
        assert html.count('class="td-canvas-print-page"') == 3
        output_path.write_bytes(b"%PDF-1.4\n")
        return output_path

    monkeypatch.setattr("typedance_sidecar.canvas_export.render_canvas_snapshot_pdf", renderer)
    response = TestClient(app).post(
        f"/documents/doc_canvas_export/canvas-export/{export_format}",
        json={"print_snapshot": snapshot_payload()},
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert response.headers["X-Export-Artifact-Id"].startswith("export_")
    assert f"X-{export_format.title()}-Path" in response.headers
    if export_format == "html":
        assert response.text.count('class="td-canvas-print-page"') == 3
        assert "<br>" in response.text
