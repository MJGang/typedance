import json
import os
import subprocess
from pathlib import Path
from typing import Any, Literal, Protocol


MarkdownFallbackType = Literal["heading", "list", "paragraph"]


class MarkdownDocJsonError(RuntimeError):
    pass


class MarkdownDocJsonConverter(Protocol):
    def convert_markdown(self, markdown: str) -> dict[str, Any]:
        ...

    def convert_blocks(
        self,
        blocks: list[dict[str, Any]],
    ) -> dict[str, list[dict[str, Any]]]:
        ...


class TiptapMarkdownDocJsonConverter:
    def __init__(
        self,
        *,
        node_executable: str = "node",
        cli_path: Path | None = None,
        timeout_seconds: int = 15,
    ) -> None:
        self.node_executable = node_executable
        configured_converter = os.environ.get("TYPEDANCE_MARKDOWN_CONVERTER_PATH")
        self.converter_executable = Path(configured_converter) if configured_converter else None
        self.cli_path = None if self.converter_executable else (cli_path or _default_cli_path())
        self.timeout_seconds = timeout_seconds

    def convert_blocks(
        self,
        blocks: list[dict[str, Any]],
    ) -> dict[str, list[dict[str, Any]]]:
        if not blocks:
            return {}

        decoded = self._run_cli({"blocks": blocks})
        converted_blocks = decoded.get("blocks")
        if not isinstance(converted_blocks, list):
            raise MarkdownDocJsonError("Markdown converter returned no blocks")

        result: dict[str, list[dict[str, Any]]] = {}
        for item in converted_blocks:
            if not isinstance(item, dict):
                continue
            block_id = item.get("id")
            nodes = item.get("nodes")
            if not isinstance(block_id, str) or not isinstance(nodes, list):
                continue
            result[block_id] = [node for node in nodes if isinstance(node, dict)]
        return result

    def convert_markdown(self, markdown: str) -> dict[str, Any]:
        decoded = self._run_cli({"markdown": markdown})
        doc_json = decoded.get("docJson")
        if not isinstance(doc_json, dict):
            raise MarkdownDocJsonError("Markdown converter returned invalid docJson")
        if doc_json.get("type") != "doc":
            raise MarkdownDocJsonError("Markdown converter returned non-doc docJson")
        return doc_json

    def _run_cli(self, payload_value: dict[str, Any]) -> dict[str, Any]:
        if self.converter_executable:
            if not self.converter_executable.is_file():
                raise MarkdownDocJsonError(
                    f"Packaged Markdown converter not found: {self.converter_executable}"
                )
            command = [str(self.converter_executable)]
        else:
            if self.cli_path is None or not self.cli_path.is_file():
                raise MarkdownDocJsonError(f"Markdown converter CLI not found: {self.cli_path}")
            command = [self.node_executable, str(self.cli_path)]

        payload = json.dumps(payload_value, ensure_ascii=False)
        try:
            completed = subprocess.run(
                command,
                input=payload,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
                timeout=self.timeout_seconds,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except FileNotFoundError as exc:
            raise MarkdownDocJsonError(f"Node executable not found: {self.node_executable}") from exc
        except subprocess.TimeoutExpired as exc:
            raise MarkdownDocJsonError("Markdown converter timed out") from exc

        if completed.returncode != 0:
            message = completed.stderr.strip() or completed.stdout.strip() or "Markdown converter failed"
            raise MarkdownDocJsonError(message)

        try:
            decoded = json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            raise MarkdownDocJsonError("Markdown converter returned invalid JSON") from exc

        if not isinstance(decoded, dict):
            raise MarkdownDocJsonError("Markdown converter returned invalid payload")
        return decoded


def _default_cli_path() -> Path:
    repo_root = _find_repo_root(Path(__file__).resolve())
    return repo_root / "packages" / "resume-markdown" / "src" / "cli.js"


def _find_repo_root(start: Path) -> Path:
    for parent in [start, *start.parents]:
        if (parent / "pnpm-workspace.yaml").exists():
            return parent
    raise MarkdownDocJsonError("Unable to locate TypeDance workspace root")
