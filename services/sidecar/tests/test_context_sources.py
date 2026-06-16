from pathlib import Path

from fastapi.testclient import TestClient

from typedance_sidecar.context_sources import WebpageMetadata
from typedance_sidecar.main import app


def create_document(client: TestClient) -> str:
    response = client.post(
        "/documents",
        json={
            "title": "上下文测试简历",
            "pack_id": "resume",
            "target_language": "zh-CN",
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_context_sources_manage_local_files_and_directories(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path / "data"))
    opened_paths: list[Path] = []
    revealed_paths: list[Path] = []
    monkeypatch.setattr("typedance_sidecar.context_sources._open_path", lambda path: opened_paths.append(path))
    monkeypatch.setattr("typedance_sidecar.context_sources._reveal_path", lambda path: revealed_paths.append(path))
    client = TestClient(app)
    document_id = create_document(client)

    materials = tmp_path / "materials"
    nested = materials / "nested"
    nested.mkdir(parents=True)
    resume_file = materials / "resume.pdf"
    resume_file.write_bytes(b"%PDF-1.4")
    nested_file = nested / "jd.md"
    nested_file.write_text("# JD", encoding="utf-8")

    file_response = client.post(
        f"/documents/{document_id}/context-sources/file",
        json={"path": str(resume_file)},
    )
    assert file_response.status_code == 201
    file_source = file_response.json()
    assert file_source["type"] == "file"
    assert file_source["title"] == "resume.pdf"
    assert file_source["metadata"]["permission"] == "read"

    directory_response = client.post(
        f"/documents/{document_id}/context-sources/directory",
        json={"path": str(materials)},
    )
    assert directory_response.status_code == 201
    directory_source = directory_response.json()
    assert directory_source["type"] == "directory"

    sources = client.get(f"/documents/{document_id}/context-sources").json()
    assert [source["id"] for source in sources] == [file_source["id"], directory_source["id"]]

    root_children = client.get(f"/context-sources/{directory_source['id']}/children").json()
    assert [(child["type"], child["name"]) for child in root_children] == [
        ("directory", "nested"),
        ("file", "resume.pdf"),
    ]

    nested_children = client.get(
        f"/context-sources/{directory_source['id']}/children",
        params={"path": "nested"},
    ).json()
    assert nested_children[0]["name"] == "jd.md"

    file_content = client.get(f"/context-sources/{directory_source['id']}/content", params={"path": "nested/jd.md"})
    assert file_content.status_code == 200
    assert file_content.json()["text"] == "# JD"
    assert file_content.json()["truncated"] is False

    directory_content = client.get(f"/context-sources/{directory_source['id']}/content")
    assert directory_content.status_code == 200
    assert "nested/" in directory_content.json()["text"]
    assert "resume.pdf" in directory_content.json()["text"]

    open_child_response = client.post(
        f"/context-sources/{directory_source['id']}/children/open",
        params={"path": "nested/jd.md"},
    )
    assert open_child_response.status_code == 204
    assert opened_paths == [nested_file.resolve()]

    reveal_child_response = client.post(
        f"/context-sources/{directory_source['id']}/children/reveal",
        params={"path": "nested/jd.md"},
    )
    assert reveal_child_response.status_code == 204
    assert revealed_paths == [nested_file.resolve()]

    escaped_child_response = client.post(
        f"/context-sources/{directory_source['id']}/children/open",
        params={"path": "../outside.txt"},
    )
    assert escaped_child_response.status_code == 400

    remove_response = client.delete(f"/context-sources/{file_source['id']}")
    assert remove_response.status_code == 204
    assert resume_file.exists()
    assert [source["id"] for source in client.get(f"/documents/{document_id}/context-sources").json()] == [
        directory_source["id"],
    ]


def test_context_sources_manage_webpage_metadata(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path / "data"))

    def fake_metadata(url: str) -> WebpageMetadata:
        assert url == "https://example.com/jobs/frontend"
        return WebpageMetadata(
            title="前端工程师岗位",
            description="负责 TypeScript 和 React 方向。",
            summary="这是一份前端工程师岗位描述摘要。",
            favicon_url="https://example.com/favicon.ico",
        )

    monkeypatch.setattr("typedance_sidecar.context_sources.refresh_webpage_metadata", fake_metadata)
    monkeypatch.setattr("typedance_sidecar.revision_api.refresh_webpage_metadata", fake_metadata)
    monkeypatch.setattr(
        "typedance_sidecar.revision_api.read_context_source_text",
        lambda source, path="": ("job description body", False),
    )

    client = TestClient(app)
    document_id = create_document(client)

    created = client.post(
        f"/documents/{document_id}/context-sources/webpage",
        json={"url": "https://example.com/jobs/frontend"},
    )
    assert created.status_code == 201
    source = created.json()
    assert source["type"] == "webpage"
    assert source["title"] == "前端工程师岗位"
    assert source["description"] == "负责 TypeScript 和 React 方向。"
    assert source["summary"] == "这是一份前端工程师岗位描述摘要。"
    assert source["favicon_url"] == "https://example.com/favicon.ico"

    renamed = client.patch(
        f"/context-sources/{source['id']}",
        json={"title": "重点岗位 JD"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "重点岗位 JD"

    refreshed = client.post(f"/context-sources/{source['id']}/refresh")
    assert refreshed.status_code == 200
    assert refreshed.json()["title"] == "前端工程师岗位"

    content = client.get(f"/context-sources/{source['id']}/content")
    assert content.status_code == 200
    assert content.json()["text"] == "job description body"


def test_context_sources_are_removed_with_document(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path / "data"))
    client = TestClient(app)
    document_id = create_document(client)
    source_file = tmp_path / "resume.txt"
    source_file.write_text("resume", encoding="utf-8")

    created = client.post(
        f"/documents/{document_id}/context-sources/file",
        json={"path": str(source_file)},
    )
    assert created.status_code == 201

    assert client.delete(f"/documents/{document_id}").status_code == 204
    assert client.get(f"/documents/{document_id}/context-sources").status_code == 404
    assert client.delete(f"/context-sources/{created.json()['id']}").status_code == 404
    assert source_file.exists()
