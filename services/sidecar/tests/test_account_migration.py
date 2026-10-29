import json
import sqlite3
from pathlib import Path

import pytest

from typedance_sidecar import account_migration
from typedance_sidecar.account_migration import LocalDataMigrationError, migrate_local_data


def test_consistent_database_snapshot_includes_committed_wal_and_excludes_secret(tmp_path):
    source = tmp_path / "local"
    source.mkdir()
    (source / "agent-host").mkdir()
    secret = source / "agent-host" / "auth.json"
    secret.write_text('{"api_key":"private-test-value"}', encoding="utf-8")
    (source / "agent-host" / "config.json").write_text('{"model":"example"}', encoding="utf-8")
    database = source / "typedance.sqlite"
    connection = sqlite3.connect(database)
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE material (body TEXT)")
        connection.execute("INSERT INTO material VALUES ('保留完整内容')")
        connection.commit()
        assert Path(str(database) + "-wal").exists()
        target = source / "profiles" / "verified-account"
        result = migrate_local_data(source, target, ["typedance.sqlite", "agent-host"], ["agent-host/auth.json"])
        with sqlite3.connect(target / "typedance.sqlite") as copied:
            assert copied.execute("SELECT body FROM material").fetchall() == [("保留完整内容",)]
        assert connection.execute("SELECT count(*) FROM material").fetchone() == (1,)
        assert secret.exists()
        assert not (target / "agent-host" / "auth.json").exists()
        assert result["file_count"] == 2
        assert "private-test-value" not in (target / ".local-data-import.json").read_text(encoding="utf-8")
    finally:
        connection.close()


def test_external_reference_is_copied_as_text_without_changing_real_file(tmp_path):
    external = tmp_path / "real-resume.md"
    external.write_text("用户真实文件", encoding="utf-8")
    source = tmp_path / "local"
    source.mkdir()
    (source / "references.json").write_text(json.dumps({"path": str(external)}), encoding="utf-8")
    target = tmp_path / "account"
    migrate_local_data(source, target, ["references.json"], [])
    assert external.read_text(encoding="utf-8") == "用户真实文件"
    assert json.loads((target / "references.json").read_text(encoding="utf-8"))["path"] == str(external)
    assert not (target / external.name).exists()


@pytest.mark.parametrize("name", ["../outside", "/absolute", "C:/outside", "folder/../outside", "folder\\..\\outside", "file:stream"])
def test_rejects_path_traversal_and_device_paths(tmp_path, name):
    source = tmp_path / "source"
    source.mkdir()
    with pytest.raises(LocalDataMigrationError):
        migrate_local_data(source, tmp_path / "target", [name], [])
    assert not (tmp_path / "target").exists()


def test_does_not_overwrite_existing_account_or_reimport(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "document").write_text("old", encoding="utf-8")
    target = tmp_path / "target"
    target.mkdir()
    (target / "document").write_text("current", encoding="utf-8")
    with pytest.raises(LocalDataMigrationError, match="拒绝覆盖"):
        migrate_local_data(source, target, ["document"], [])
    assert (target / "document").read_text(encoding="utf-8") == "current"
    assert (source / "document").read_text(encoding="utf-8") == "old"


def test_failure_publishes_no_partial_data_and_can_retry(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.mkdir()
    for name in ("a", "b"):
        (source / name).write_text(name, encoding="utf-8")
    target = tmp_path / "target"
    original = account_migration._copy_file

    def interrupted(origin, destination):
        if origin.name == "b":
            raise OSError("simulated interruption")
        original(origin, destination)

    with monkeypatch.context() as scope:
        scope.setattr(account_migration, "_copy_file", interrupted)
        with pytest.raises(OSError, match="interruption"):
            migrate_local_data(source, target, ["a", "b"], [])
    assert not target.exists()
    assert json.loads((tmp_path / ".target.import.json").read_text(encoding="utf-8"))["state"] == "failed"
    assert not list(tmp_path.glob(".target.import-*"))
    assert migrate_local_data(source, target, ["a", "b"], [])["file_count"] == 2
    assert {path.name for path in source.iterdir()} == {"a", "b"}


def test_rejects_links_to_external_directory(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    external = tmp_path / "external"
    external.mkdir()
    (external / "private").write_text("outside", encoding="utf-8")
    try:
        (source / "linked").symlink_to(external, target_is_directory=True)
    except OSError:
        pytest.skip("当前 Windows 测试进程无创建符号链接权限")
    with pytest.raises(LocalDataMigrationError, match="链接|联接"):
        migrate_local_data(source, tmp_path / "target", ["linked"], [])
    assert (external / "private").read_text(encoding="utf-8") == "outside"


def test_rejects_recursive_destination_and_overlapping_entries(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "files").mkdir()
    (source / "files" / "a").write_text("data", encoding="utf-8")
    with pytest.raises(LocalDataMigrationError):
        migrate_local_data(source, source / "files" / "target", ["files"], [])
    for entries in (["files", "files/a"], ["files/a", "files"]):
        with pytest.raises(LocalDataMigrationError):
            migrate_local_data(source, tmp_path / "target", entries, [])


def test_concurrent_migration_is_rejected_without_releasing_other_lock(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "a").write_text("data", encoding="utf-8")
    lock = tmp_path / ".target.import.lock"
    with account_migration._lock(lock):
        with pytest.raises(LocalDataMigrationError, match="正在迁移"):
            migrate_local_data(source, tmp_path / "target", ["a"], [])
    assert migrate_local_data(source, tmp_path / "target", ["a"], [])["migrated"] is True
