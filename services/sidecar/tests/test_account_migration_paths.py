import json
import sqlite3
from contextlib import closing

import pytest

from typedance_sidecar.cli import main
from typedance_sidecar import account_migration_paths
from typedance_sidecar.db import connect


def test_migration_rebases_owned_files_and_preserves_external_references_and_text(tmp_path, monkeypatch, capsys):
    source = tmp_path / "old-local"
    target = tmp_path / "account-a"
    managed = source / "files" / "sources" / "document" / "简历.md"
    managed.parent.mkdir(parents=True)
    managed.write_text("owned material", encoding="utf-8")
    external = tmp_path / "user-material.md"
    external.write_text("external material", encoding="utf-8")
    export = source / "files" / "exports" / "document.pdf"
    export.parent.mkdir()
    export.write_bytes(b"%PDF-fixture")
    preview = source / "files" / "previews" / "old.pdf"
    preview.parent.mkdir()
    preview.write_bytes(b"%PDF-preview")
    sibling = source / "files-sibling" / "untouched.md"
    sibling.parent.mkdir()
    sibling.write_text("not an owned files root", encoding="utf-8")
    rows = {
        "source_documents": {
            "owned": {"file_path": str(managed), "original_uri": "original-upload.md", "raw_text": str(managed)},
            "external": {"file_path": str(external)},
            "sibling": {"file_path": str(sibling)},
        },
        "export_artifacts": {"owned": {"file_path": str(export)}, "external": {"file_path": str(external)}},
        "resume_versions": {"old": {"preview_pdf_path": str(preview), "preview_pdf_url": "http://127.0.0.1:4317/previews/old.pdf"}},
        "context_sources": {
            "owned": {"type": "file", "uri": managed.as_uri()},
            "external": {"type": "file", "uri": external.as_uri()},
            "webpage": {"type": "webpage", "uri": "https://example.com/material"},
        },
    }
    with closing(sqlite3.connect(source / "typedance.sqlite")) as database:
        for table, payloads in rows.items():
            database.execute(f"CREATE TABLE {table}(id TEXT PRIMARY KEY, payload TEXT)")
            database.executemany(f"INSERT INTO {table} VALUES (?, ?)", [(identity, json.dumps(payload)) for identity, payload in payloads.items()])
        database.commit()
    monkeypatch.delenv("TYPEDANCE_LOCAL_TOKEN", raising=False)
    main([
        "--migrate-local-data", "--source-data-dir", str(source), "--data-dir", str(target),
        "--entries-json", json.dumps(["typedance.sqlite", "files"]),
    ])
    assert json.loads(capsys.readouterr().out)["migrated"] is True
    new_managed = target / managed.relative_to(source)
    with closing(sqlite3.connect(target / "typedance.sqlite")) as database:
        def payload(table, identity):
            return json.loads(database.execute(f"SELECT payload FROM {table} WHERE id=?", (identity,)).fetchone()[0])

        assert payload("source_documents", "owned") == {"file_path": str(new_managed), "original_uri": "original-upload.md", "raw_text": str(managed)}
        assert payload("source_documents", "external")["file_path"] == str(external)
        assert payload("source_documents", "sibling")["file_path"] == str(sibling)
        assert payload("export_artifacts", "owned")["file_path"] == str(target / export.relative_to(source))
        assert payload("export_artifacts", "external")["file_path"] == str(external)
        assert payload("resume_versions", "old") == {"preview_pdf_path": str(target / preview.relative_to(source)), "preview_pdf_url": None}
        assert payload("context_sources", "owned")["uri"] == new_managed.as_uri()
        assert payload("context_sources", "external")["uri"] == external.as_uri()
        assert payload("context_sources", "webpage")["uri"] == "https://example.com/material"
    assert new_managed.read_text(encoding="utf-8") == "owned material"
    assert external.read_text(encoding="utf-8") == "external material"
    assert managed.exists()
    with closing(sqlite3.connect(source / "typedance.sqlite")) as database:
        assert json.loads(database.execute("SELECT payload FROM source_documents WHERE id='owned'").fetchone()[0])["file_path"] == str(managed)


def test_path_rewrite_failure_does_not_publish_a_partial_profile(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.mkdir()
    (source / "material").write_text("preserve", encoding="utf-8")
    target = tmp_path / "target"

    def fail(*_args):
        raise ValueError("simulated path rewrite failure")

    monkeypatch.setattr(account_migration_paths, "rebase_sidecar_file_references", fail)
    with pytest.raises(ValueError, match="simulated"):
        main([
            "--migrate-local-data", "--source-data-dir", str(source), "--data-dir", str(target),
            "--entries-json", json.dumps(["material"]),
        ])
    assert not target.exists()
    assert (source / "material").read_text(encoding="utf-8") == "preserve"
    assert json.loads((tmp_path / ".target.import.json").read_text(encoding="utf-8"))["state"] == "failed"


def test_profile_copy_preserves_templates_resume_bindings_and_conversations(tmp_path):
    source = tmp_path / "old-profile"
    target = tmp_path / "new-profile"
    (source / "agent-host").mkdir(parents=True)
    date = "2026-11-11T12:00:00Z"
    style = json.dumps({"template_id": "classic-a4", "blocks": {"paragraph": {"fontSize": "11pt"}}})
    sample = json.dumps({"id": "sample", "plain_text_snapshot": "修改后的示例"}, ensure_ascii=False)
    resume = json.dumps({"id": "resume", "template_id": "classic-a4"})
    conversation = json.dumps({"id": "conversation", "title": "原有对话"}, ensure_ascii=False)
    message = json.dumps({"id": "message", "text": "原有内容"}, ensure_ascii=False)

    with (
        closing(connect(source / "typedance.sqlite")) as data,
        closing(sqlite3.connect(source / "agent-host/store.sqlite")) as agent,
    ):
        for connection in (data, agent):
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA wal_autocheckpoint=0")
        data.execute("INSERT INTO template_styles VALUES (?, ?, ?)", ("classic-a4", style, date))
        data.execute("INSERT INTO template_samples VALUES (?, ?, ?)", ("sample", sample, date))
        data.execute("INSERT INTO resume_versions VALUES (?, ?, ?)", ("resume", resume, date))
        agent.execute("CREATE TABLE conversations (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
        agent.execute("CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT, data TEXT NOT NULL)")
        agent.execute("INSERT INTO conversations VALUES (?, ?)", ("conversation", conversation))
        agent.execute("INSERT INTO messages VALUES (?, ?, ?)", ("message", "conversation", message))
        data.commit()
        agent.commit()

        main([
            "--migrate-local-data", "--preserve-file-references",
            "--source-data-dir", str(source), "--data-dir", str(target),
            "--entries-json", json.dumps(["typedance.sqlite", "agent-host"]),
        ])

        with (
            closing(sqlite3.connect(target / "typedance.sqlite")) as copied_data,
            closing(sqlite3.connect(target / "agent-host/store.sqlite")) as copied_agent,
        ):
            for original, copied, query, expected in (
                (data, copied_data, "SELECT * FROM template_styles", [("classic-a4", style, date)]),
                (data, copied_data, "SELECT * FROM template_samples", [("sample", sample, date)]),
                (data, copied_data, "SELECT * FROM resume_versions", [("resume", resume, date)]),
                (agent, copied_agent, "SELECT * FROM conversations", [("conversation", conversation)]),
                (agent, copied_agent, "SELECT * FROM messages", [("message", "conversation", message)]),
            ):
                assert [tuple(row) for row in original.execute(query)] == expected
                assert copied.execute(query).fetchall() == expected
