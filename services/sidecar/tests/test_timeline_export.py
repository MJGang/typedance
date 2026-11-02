from html.parser import HTMLParser
import json
from pathlib import Path

import pytest

from conftest import authenticated_client
from test_revision_api import repo_for, seed_workspace
from typedance_sidecar.main import app
from typedance_sidecar.mcp.resume_tools import ResumeMcpTools
from typedance_sidecar.revision_services import WorkspaceService


class Elements(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.tags = []
        self.classes = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        self.classes.extend(dict(attrs).get("class", "").split())


def count_nodes(node, kind):
    return int(node["type"] == kind) + sum(count_nodes(child, kind) for child in node.get("content", []))


@pytest.mark.parametrize("entrypoint", ["api_html", "api_pdf", "mcp_html", "mcp_pdf"])
def test_public_exports_preserve_saved_timeline_rich_structure(tmp_path, monkeypatch, entrypoint):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    seed_workspace(tmp_path)
    rich = json.loads((Path(__file__).parent / "fixtures" / "timeline_rich.json").read_text(encoding="utf-8"))
    WorkspaceService(repo_for(tmp_path)).save_source_resume_canvas_document("doc_1", rich)
    captured = []

    def render_pdf(html, path, page_margin=None):
        captured.append(html)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"%PDF-1.4\n%%EOF")
        return path

    monkeypatch.setattr("typedance_sidecar.revision_export.render_html_to_pdf", render_pdf)
    format = entrypoint.rsplit("_", 1)[1]
    if entrypoint.startswith("api_"):
        response = authenticated_client(app).post(f"/documents/doc_1/export/{format}", json={})
        assert response.status_code == 200
        html = response.text if format == "html" else captured[0]
    else:
        result = ResumeMcpTools(lambda: repo_for(tmp_path)).export_document("doc_1", format, output_path=str(tmp_path / f"mcp.{format}"))
        assert result["status"] == "succeeded"
        html = Path(result["file_path"]).read_text(encoding="utf-8") if format == "html" else captured[0]

    elements = Elements(html)
    assert elements.classes.count("td-timeline") == 1
    assert elements.classes.count("td-timeline-item") == 3
    assert elements.classes.count("td-timeline-dot") == 3
    assert elements.classes.count("td-timeline-line") == 3
    assert elements.classes.count("td-columns") == 2
    assert elements.tags.count("p") == count_nodes(rich, "paragraph")
    assert elements.tags.count("ul") == count_nodes(rich, "bulletList")
    assert elements.tags.count("ol") == count_nodes(rich, "orderedList")
    assert elements.tags.count("h3") == 3
    assert "font-size: 12px" in html
    assert "text-align: right" in html
    assert "<strong>知识库建设：</strong>" in html
    assert ".td-timeline-dot {" in html
    assert "其他经历保持正常编辑。" in html
