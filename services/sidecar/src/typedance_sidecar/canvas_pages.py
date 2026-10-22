"""将当前画布的静态快照按已测量的分页位置转为图片，不保存或修改文档。"""

import base64
import struct

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
    selected = snapshot.model_copy(update={"page_tops": [snapshot.page_tops[page - 1] for page in pages]})
    html = render_canvas_snapshot_html(selected, title=title)
    images = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**_resolve_browser_config())
        try:
            context = browser.new_context(java_script_enabled=False, service_workers="block", viewport={"width": 1000, "height": 1200})
            try:
                context.set_default_timeout(15_000)
                context.route("**/*", lambda route: route.abort())
                page = context.new_page()
                page.set_content(html, wait_until="load")
                for index, number in enumerate(pages):
                    png = page.locator(".td-canvas-print-page").nth(index).screenshot(type="png", scale="css")
                    width, height = struct.unpack(">II", png[16:24])
                    images.append({"page": number, "width": width, "height": height,
                                   "image_url": "data:image/png;base64," + base64.b64encode(png).decode("ascii")})
            finally:
                context.close()
        finally:
            browser.close()
    return {"page_count": page_count, "pages": images}
