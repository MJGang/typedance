from collections.abc import Callable
from html import escape
from html.parser import HTMLParser
from pathlib import Path

from playwright.sync_api import sync_playwright

from .pdf import PDF_PRINT_MARGIN, _resolve_browser_config
from .revision_export import RevisionExportFormat, record_export_artifact, resolve_export_output_path
from .revision_models import CanvasPrintSnapshot, ExportArtifact
from .revision_repository import RevisionRepository
from .revision_services import RevisionServiceError


A4_WIDTH_PX = 210 / 25.4 * 96
CanvasPdfRenderer = Callable[[str, Path], Path]


class _StaticSnapshotParser(HTMLParser):
    """保留排版节点和内联样式，移除可执行内容及文档级指令。"""

    blocked_containers = {"script", "style", "iframe", "object", "applet", "frameset", "head", "title", "noscript"}
    blocked_elements = {"base", "embed", "frame", "link", "meta", "animate", "animatemotion", "animatetransform", "set"}
    void_elements = {"area", "br", "col", "hr", "img", "input", "param", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []
        self.open_tags: list[str] = []
        self.skipped_tag: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.skipped_tag is not None:
            return
        if tag in self.blocked_containers:
            self.skipped_tag = tag
            return
        if tag in self.blocked_elements or tag in {"html", "body"}:
            return
        static_attrs = [(name, value) for name, value in attrs if not name.startswith("on") and name != "srcdoc"]
        if static_attrs == attrs:
            self.parts.append(self.get_starttag_text())
        else:
            attr_text = "".join(f' {name}="{escape(value, quote=True)}"' if value is not None else f" {name}" for name, value in static_attrs)
            self.parts.append(f"<{tag}{attr_text}>")
        if tag not in self.void_elements:
            self.open_tags.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in self.void_elements:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if self.skipped_tag is not None:
            if tag == self.skipped_tag:
                self.skipped_tag = None
            return
        if tag in self.open_tags:
            while self.open_tags:
                current = self.open_tags.pop()
                self.parts.append(f"</{current}>")
                if current == tag:
                    break

    def handle_data(self, data: str) -> None:
        if self.skipped_tag is None:
            self.parts.append(data)

    def handle_entityref(self, name: str) -> None:
        self.handle_data(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.handle_data(f"&#{name};")


def render_canvas_snapshot_html(snapshot: CanvasPrintSnapshot, *, title: str) -> str:
    """按画布测量位置裁切各页，不重新执行文档排版。"""
    parser = _StaticSnapshotParser()
    parser.feed(snapshot.html)
    parser.close()
    static_html = "".join(parser.parts) + "".join(f"</{tag}>" for tag in reversed(parser.open_tags))
    scale = A4_WIDTH_PX / snapshot.page_width
    pages = "\n".join(
        '<section class="td-canvas-print-page">'
        f'<div class="td-canvas-print-viewport" style="width: {snapshot.page_width:g}px; '
        f'height: {snapshot.page_height:g}px; transform: scale({scale:.12g})">'
        f'<div class="td-canvas-print-origin" style="top: {-page_top:g}px; '
        f'width: {snapshot.page_width:g}px">{static_html}</div>'
        '</div></section>'
        for page_top in snapshot.page_tops
    )
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'">
<title>{escape(title)}</title>
<style>
@page {{ size: A4; margin: 0; }}
html, body {{ margin: 0; padding: 0; background: white; color: black; }}
/* 分页已在画布完成，打印时禁止孤行规则再次移动段落中的首尾行。 */
body {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; orphans: 1; widows: 1; }}
.td-canvas-print-page {{
    position: relative;
    box-sizing: border-box;
    width: 210mm;
    height: 297mm;
    overflow: hidden;
    background: white;
    break-after: page;
    break-inside: avoid;
}}
.td-canvas-print-page:last-child {{ break-after: auto; }}
.td-canvas-print-viewport {{ position: absolute; top: 0; left: 0; overflow: hidden; transform-origin: top left; }}
.td-canvas-print-origin {{ position: absolute; left: 0; }}
</style>
</head>
<body>{pages}</body>
</html>"""


def render_canvas_snapshot_pdf(html: str, output_path: Path) -> Path:
    """在无脚本、无网络的独立上下文中打印静态画布快照。"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # 同步 Playwright 对象绑定创建它的线程，不能跨 FastAPI 请求线程复用。
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**_resolve_browser_config())
        try:
            context = browser.new_context(java_script_enabled=False, service_workers="block")
            try:
                context.route("**/*", lambda route: route.abort())
                page = context.new_page()
                page.set_content(html, wait_until="load")
                page.pdf(
                    path=str(output_path),
                    format="A4",
                    print_background=True,
                    prefer_css_page_size=True,
                    margin=PDF_PRINT_MARGIN,
                )
            finally:
                context.close()
        finally:
            browser.close()
    return output_path


class CanvasExportService:
    def __init__(
        self,
        repository: RevisionRepository,
        *,
        output_dir: Path | None = None,
        pdf_renderer: CanvasPdfRenderer | None = None,
    ) -> None:
        self.repository = repository
        self.output_dir = output_dir
        self.pdf_renderer = pdf_renderer or render_canvas_snapshot_pdf

    def export_document(
        self,
        document_id: str,
        export_format: RevisionExportFormat,
        *,
        print_snapshot: CanvasPrintSnapshot,
        output_path: Path | None = None,
    ) -> ExportArtifact:
        document = self.repository.get_document(document_id)
        if document is None:
            raise RevisionServiceError(f"Document not found: {document_id}")
        html = render_canvas_snapshot_html(print_snapshot, title=document.title)
        export_path = resolve_export_output_path(self.output_dir, document.id, export_format, output_path)
        if export_format == "pdf":
            self.pdf_renderer(html, export_path)
        else:
            export_path.write_text(html, encoding="utf-8")
        return record_export_artifact(self.repository, document, export_format, export_path)
