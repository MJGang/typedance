import os
from pathlib import Path
from unittest.mock import Mock

from typedance_sidecar.cli import main


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
