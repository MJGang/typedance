"""将当前画布的静态快照按已测量的分页位置转为图片，不保存或修改文档。"""

import base64
import json
import logging
import struct
from concurrent.futures import ThreadPoolExecutor
from threading import BoundedSemaphore, Lock
from time import perf_counter

from playwright.sync_api import sync_playwright
from pydantic import BaseModel, ConfigDict, Field

from .canvas_export import render_canvas_snapshot_html
from .pdf import _resolve_browser_config
from .revision_models import CanvasPrintSnapshot


class CanvasPagesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    print_snapshot: CanvasPrintSnapshot
    pages: list[int] = Field(min_length=1, max_length=6)


def render_canvas_pages(snapshot: CanvasPrintSnapshot, pages: list[int], *, title: str) -> dict:
    page_count = len(snapshot.page_tops)
    if len(set(pages)) != len(pages) or any(page < 1 or page > page_count for page in pages):
        raise ValueError("页码必须唯一，并在当前画布页数范围内")
    return _renderer.render(snapshot, pages, title)


class CanvasPageRenderer:
    """Playwright和复用浏览器始终归同一线程，每次渲染新建隔离context。"""

    def __init__(self):
        self._lock = Lock()
        self._slots = BoundedSemaphore(4)
        self._executor = None
        self._playwright = None
        self._browser = None

    def render(self, snapshot: CanvasPrintSnapshot, pages: list[int], title: str) -> dict:
        if not self._slots.acquire(blocking=False):
            raise RuntimeError("页面截图服务繁忙，请稍后重试。")
        try:
            submitted = perf_counter()
            with self._lock:
                if self._executor is None:
                    self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="canvas-pages")
                task = self._executor.submit(self._render, snapshot, pages, title, submitted)
            return task.result()
        finally:
            self._slots.release()

    def close(self):
        with self._lock:
            if self._executor is not None:
                try:
                    self._executor.submit(self._close_browser).result()
                finally:
                    self._executor.shutdown(wait=True)
                    self._executor = None

    def _close_browser(self):
        browser, self._browser = self._browser, None
        playwright, self._playwright = self._playwright, None
        try:
            if browser is not None and browser.is_connected():
                browser.close()
        finally:
            if playwright is not None:
                playwright.stop()

    def _render(self, snapshot: CanvasPrintSnapshot, pages: list[int], title: str, submitted: float) -> dict:
        started = perf_counter()
        elapsed = lambda since: round((perf_counter() - since) * 1000, 3)
        timings = {"queue_ms": elapsed(submitted), "pages": []}
        step = perf_counter()
        reused = self._browser is not None and self._browser.is_connected()
        if not reused:
            self._close_browser()
            self._playwright = sync_playwright().start()
            try:
                self._browser = self._playwright.chromium.launch(**_resolve_browser_config())
            except Exception:
                self._close_browser()
                raise
        timings.update(browser_ms=elapsed(step), browser_reused=bool(reused))
        step = perf_counter()
        context = self._browser.new_context(java_script_enabled=False, service_workers="block", viewport={"width": 1000, "height": 1200})
        timings["context_ms"] = elapsed(step)
        images = []
        try:
            context.set_default_timeout(15_000)
            context.route("**/*", lambda route: route.abort())
            step = perf_counter()
            selected = snapshot.model_copy(update={"page_tops": [snapshot.page_tops[page - 1] for page in pages]})
            html = render_canvas_snapshot_html(selected, title=title)
            page = context.new_page()
            page.set_content(html, wait_until="load")
            timings["html_ms"] = elapsed(step)
            for index, number in enumerate(pages):
                step = perf_counter()
                png = page.locator(".td-canvas-print-page").nth(index).screenshot(type="png", scale="css")
                width, height = struct.unpack(">II", png[16:24])
                images.append({"page": number, "width": width, "height": height,
                               "image_url": "data:image/png;base64," + base64.b64encode(png).decode("ascii")})
                timings["pages"].append({"page": number, "milliseconds": elapsed(step)})
        finally:
            context.close()
        timings["total_ms"] = elapsed(started)
        logging.getLogger(__name__).info("canvas page rendering: %s", json.dumps(timings))
        return {"page_count": len(snapshot.page_tops), "pages": images, "timings": timings}


_renderer = CanvasPageRenderer()


def cleanup_canvas_pages():
    _renderer.close()
