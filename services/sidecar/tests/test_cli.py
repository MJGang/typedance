import os
import json
import subprocess
import sys
import pytest
from pathlib import Path
from unittest.mock import Mock

from typedance_sidecar.cli import main


def test_release_entrypoint_runs_as_a_script_and_can_migrate_offline(tmp_path):
    entry = Path(__file__).resolve().parents[1] / "entrypoint.py"
    environment = {**os.environ, "PYTHONPATH": str(entry.parent / "src")}
    environment.pop("TYPEDANCE_LOCAL_TOKEN", None)
    help_result = subprocess.run(
        [sys.executable, str(entry), "--help"],
        env=environment, capture_output=True, text=True, timeout=20,
    )
    assert help_result.returncode == 0, help_result.stderr
    assert "--migrate-local-data" in help_result.stdout

    source = tmp_path / "source"
    (source / "files").mkdir(parents=True)
    (source / "files" / "notes.txt").write_text("entrypoint migration", encoding="utf-8")
    target = tmp_path / "target"
    result = subprocess.run(
        [sys.executable, str(entry), "--migrate-local-data", "--source-data-dir", str(source),
         "--data-dir", str(target), "--entries-json", json.dumps(["files"])],
        env=environment, capture_output=True, text=True, timeout=20,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["file_count"] == 1
    assert (target / "files" / "notes.txt").read_text(encoding="utf-8") == "entrypoint migration"
    assert (source / "files" / "notes.txt").exists()


def test_cli_sets_release_paths_before_starting_uvicorn(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", "test-sentinel")
    monkeypatch.setenv("TYPEDANCE_CHROMIUM_PATH", "test-sentinel")
    monkeypatch.setenv("TYPEDANCE_MARKDOWN_CONVERTER_PATH", "test-sentinel")
    run = Mock()
    configure_logging = Mock()
    monkeypatch.setattr("typedance_sidecar.cli.uvicorn.run", run)
    monkeypatch.setattr("typedance_sidecar.cli.configure_logging", configure_logging)
    data_dir = tmp_path / "data"
    browser_path = tmp_path / "chromium" / "chrome.exe"
    converter_path = tmp_path / "typedance-markdown-converter.exe"

    main(
        [
            "--port",
            "4317",
            "--data-dir",
            str(data_dir),
            "--browser-path",
            str(browser_path),
            "--markdown-converter-path",
            str(converter_path),
        ]
    )

    assert Path(str(data_dir)) == Path(os.environ["TYPEDANCE_DATA_DIR"])
    assert Path(str(browser_path)) == Path(os.environ["TYPEDANCE_CHROMIUM_PATH"])
    assert Path(str(converter_path)) == Path(os.environ["TYPEDANCE_MARKDOWN_CONVERTER_PATH"])
    configure_logging.assert_called_once_with(data_dir)
    run.assert_called_once_with(
        "typedance_sidecar.main:app",
        host="127.0.0.1",
        port=4317,
        log_config=None,
        access_log=False,
    )


def test_service_cli_fails_closed_without_desktop_credentials(tmp_path, monkeypatch):
    monkeypatch.delenv("TYPEDANCE_LOCAL_TOKEN", raising=False)
    run = Mock()
    monkeypatch.setattr("typedance_sidecar.cli.uvicorn.run", run)
    with pytest.raises(RuntimeError, match="desktop-issued"):
        main(["--data-dir", str(tmp_path), "--browser-path", str(tmp_path / "browser.exe")])
    run.assert_not_called()


def test_offline_migration_cli_requires_no_session_or_browser_and_does_not_start_http(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("TYPEDANCE_LOCAL_TOKEN", raising=False)
    source = tmp_path / "source"
    (source / "files").mkdir(parents=True)
    (source / "files" / "notes.txt").write_text("local migration fixture", encoding="utf-8")
    target = tmp_path / "target"
    run = Mock()
    monkeypatch.setattr("typedance_sidecar.cli.uvicorn.run", run)
    main([
        "--migrate-local-data", "--source-data-dir", str(source), "--data-dir", str(target),
        "--entries-json", json.dumps(["files"]), "--exclude-json", "[]",
    ])
    assert json.loads(capsys.readouterr().out) == {"migrated": True, "file_count": 1, "entries": ["files"]}
    assert (target / "files" / "notes.txt").read_text(encoding="utf-8") == "local migration fixture"
    assert (source / "files" / "notes.txt").exists()
    run.assert_not_called()
