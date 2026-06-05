import json
import subprocess
from pathlib import Path
from typing import Any, Literal, Protocol


MarkdownFallbackType = Literal["heading", "list", "paragraph"]


class MarkdownDocJsonError(RuntimeError):
    pass


class MarkdownDocJsonConverter(Protocol):
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
        self.cli_path = cli_path or _default_cli_path()
        self.timeout_seconds = timeout_seconds

    def convert_blocks(
        self,
        blocks: list[dict[str, Any]],
    ) -> dict[str, list[dict[str, Any]]]:
        if not blocks:
            return {}
        if not self.cli_path.exists():
            raise MarkdownDocJsonError(f"Markdown converter CLI not found: {self.cli_path}")

        payload = json.dumps({"blocks": blocks}, ensure_ascii=False)
        try:
            completed = subprocess.run(
                [self.node_executable, str(self.cli_path)],
                input=payload,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
                timeout=self.timeout_seconds,
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


def _default_cli_path() -> Path:
    repo_root = _find_repo_root(Path(__file__).resolve())
    return repo_root / "packages" / "resume-markdown" / "src" / "cli.js"


def _find_repo_root(start: Path) -> Path:
    for parent in [start, *start.parents]:
        if (parent / "pnpm-workspace.yaml").exists():
            return parent
    raise MarkdownDocJsonError("Unable to locate TypeDance workspace root")
