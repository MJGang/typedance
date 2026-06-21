import json
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from typedance_sidecar.markdown_doc_json import TiptapMarkdownDocJsonConverter


def test_uses_packaged_converter_without_workspace_or_node(tmp_path, monkeypatch):
    converter_path = tmp_path / "typedance-markdown-converter.exe"
    converter_path.write_bytes(b"placeholder")
    monkeypatch.setenv("TYPEDANCE_MARKDOWN_CONVERTER_PATH", str(converter_path))
    completed = SimpleNamespace(
        returncode=0,
        stdout=json.dumps({"docJson": {"type": "doc", "content": []}}),
        stderr="",
    )
    run = Mock(return_value=completed)
    monkeypatch.setattr("typedance_sidecar.markdown_doc_json.subprocess.run", run)

    converter = TiptapMarkdownDocJsonConverter(
        node_executable="missing-node",
        cli_path=Path("missing-workspace") / "cli.js",
    )
    converter.convert_markdown("# Resume")

    command = run.call_args.args[0]
    assert command == [str(converter_path)]


def test_packaged_converter_uses_hidden_windows_process(tmp_path, monkeypatch):
    converter_path = tmp_path / "typedance-markdown-converter.exe"
    converter_path.write_bytes(b"placeholder")
    monkeypatch.setenv("TYPEDANCE_MARKDOWN_CONVERTER_PATH", str(converter_path))
    calls = []

    def fake_run(*args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"docJson": {"type": "doc", "content": []}}),
            stderr="",
        )

    monkeypatch.setattr("typedance_sidecar.markdown_doc_json.subprocess.run", fake_run)

    TiptapMarkdownDocJsonConverter().convert_markdown("# Resume")

    assert calls[0][0][0] == [str(converter_path)]
    assert calls[0][1]["creationflags"] == subprocess.CREATE_NO_WINDOW
