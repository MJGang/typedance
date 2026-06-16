from __future__ import annotations

import html
import os
import re
import subprocess
import sys
import webbrowser
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, url2pathname, urlopen

from .models import utc_now
from .revision_models import ContextSource, ContextSourceChild


MAX_WEBPAGE_BYTES = 1_000_000
WEBPAGE_TIMEOUT_SECONDS = 8
MAX_CONTEXT_SOURCE_TEXT_BYTES = 300_000


@dataclass(frozen=True)
class WebpageMetadata:
    title: str
    description: str | None
    summary: str | None
    favicon_url: str | None


def file_uri(path: Path) -> str:
    return path.expanduser().resolve().as_uri()


def source_path(source: ContextSource) -> Path:
    if not source.uri.startswith("file://"):
        raise ValueError("Context source is not a local file resource")
    return Path(url2pathname(urlparse(source.uri).path)).resolve()


def list_directory_children(root: Path, relative_path: str = "") -> list[ContextSourceChild]:
    resolved_root = root.expanduser().resolve()
    target = _resolve_child_path(resolved_root, relative_path)
    if not target.is_dir():
        raise NotADirectoryError(str(target))

    children: list[ContextSourceChild] = []
    for child in target.iterdir():
        stat = child.stat()
        child_relative = child.relative_to(resolved_root).as_posix()
        children.append(
            ContextSourceChild(
                type="directory" if child.is_dir() else "file",
                name=child.name,
                path=child_relative,
                uri=child.resolve().as_uri(),
                size=None if child.is_dir() else stat.st_size,
                updated_at=_timestamp_from_stat(stat.st_mtime),
            )
        )
    return sorted(children, key=lambda item: (item.type != "directory", item.name.lower()))


def read_context_source_text(source: ContextSource, relative_path: str = "") -> tuple[str, bool]:
    if source.type == "webpage":
        return read_webpage_text(source.uri)

    path = source_path(source)
    if source.type == "directory":
        if relative_path:
            path = resolve_context_source_child_path(source, relative_path)
        if path.is_dir():
            return format_directory_listing(path, path), False
    if not path.is_file():
        raise FileNotFoundError(str(path))
    return read_local_text(path)


def read_local_text(path: Path, max_bytes: int = MAX_CONTEXT_SOURCE_TEXT_BYTES) -> tuple[str, bool]:
    content = path.read_bytes()
    truncated = len(content) > max_bytes
    text = content[:max_bytes].decode("utf-8", errors="replace")
    return text, truncated


def read_webpage_text(url: str, max_bytes: int = MAX_CONTEXT_SOURCE_TEXT_BYTES) -> tuple[str, bool]:
    normalized_url = _normalize_url(url)
    request = Request(
        normalized_url,
        headers={
            "User-Agent": "TypeDance/0.1 ContextSourceBot",
            "Accept": "text/html,application/xhtml+xml,text/plain",
        },
    )
    with urlopen(request, timeout=WEBPAGE_TIMEOUT_SECONDS) as response:
        content = response.read(max_bytes + 1)
        charset = response.headers.get_content_charset() or "utf-8"
    truncated = len(content) > max_bytes
    raw = content[:max_bytes].decode(charset, errors="replace")
    return html_to_text(raw), truncated


def format_directory_listing(root: Path, target: Path) -> str:
    children = list_directory_children(root, target.relative_to(root).as_posix() if target != root else "")
    lines = [f"Directory: {target}"]
    for child in children:
        marker = "/" if child.type == "directory" else ""
        lines.append(f"- {child.name}{marker}")
    return "\n".join(lines)


def resolve_context_source_child_path(source: ContextSource, relative_path: str) -> Path:
    if source.type != "directory":
        raise ValueError("Context source is not a directory")
    return _resolve_child_path(source_path(source), relative_path)


def refresh_webpage_metadata(url: str) -> WebpageMetadata:
    normalized_url = _normalize_url(url)
    request = Request(
        normalized_url,
        headers={
            "User-Agent": "TypeDance/0.1 ContextSourceBot",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urlopen(request, timeout=WEBPAGE_TIMEOUT_SECONDS) as response:
        content = response.read(MAX_WEBPAGE_BYTES + 1)
        charset = response.headers.get_content_charset() or "utf-8"
    text = content[:MAX_WEBPAGE_BYTES].decode(charset, errors="replace")
    title = _extract_title(text) or urlparse(normalized_url).netloc or normalized_url
    description = _extract_description(text)
    summary = _summarize_html(text, description)
    favicon_url = _extract_favicon_url(text, normalized_url)
    return WebpageMetadata(
        title=title,
        description=description,
        summary=summary,
        favicon_url=favicon_url,
    )


def build_webpage_source(source_id: str, workspace_id: str, url: str) -> ContextSource:
    normalized_url = _normalize_url(url)
    now = utc_now()
    try:
        metadata = refresh_webpage_metadata(normalized_url)
    except Exception:
        parsed = urlparse(normalized_url)
        metadata = WebpageMetadata(
            title=parsed.netloc or normalized_url,
            description=None,
            summary=None,
            favicon_url=None,
        )
    return ContextSource(
        id=source_id,
        workspace_id=workspace_id,
        type="webpage",
        title=metadata.title,
        uri=normalized_url,
        description=metadata.description,
        summary=metadata.summary,
        favicon_url=metadata.favicon_url,
        metadata={},
        created_at=now,
        updated_at=now,
    )


def open_context_source(source: ContextSource) -> None:
    if source.type == "webpage":
        webbrowser.open(source.uri)
        return
    _open_path(source_path(source))


def reveal_context_source(source: ContextSource) -> None:
    if source.type == "webpage":
        webbrowser.open(source.uri)
        return
    _reveal_path(source_path(source))


def open_context_source_child(source: ContextSource, relative_path: str) -> None:
    _open_path(resolve_context_source_child_path(source, relative_path))


def reveal_context_source_child(source: ContextSource, relative_path: str) -> None:
    _reveal_path(resolve_context_source_child_path(source, relative_path))


def _reveal_path(path: Path) -> None:
    if sys.platform.startswith("win"):
        if path.is_file():
            subprocess.Popen(["explorer", f"/select,{path}"])
        else:
            subprocess.Popen(["explorer", str(path)])
        return
    if sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(path)])
        return
    subprocess.Popen(["xdg-open", str(path if path.is_dir() else path.parent)])


def _resolve_child_path(root: Path, relative_path: str) -> Path:
    if not relative_path:
        return root
    candidate = (root / relative_path).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Directory child path escapes context source root")
    return candidate


def _timestamp_from_stat(value: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_url(url: str) -> str:
    trimmed = url.strip()
    if not trimmed:
        raise ValueError("URL must not be blank")
    parsed = urlparse(trimmed)
    if not parsed.scheme:
        trimmed = f"https://{trimmed}"
        parsed = urlparse(trimmed)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("URL must be an HTTP(S) address")
    return trimmed


def _extract_title(text: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", text, flags=re.IGNORECASE | re.DOTALL)
    return _clean_text(match.group(1)) if match else None


def _extract_description(text: str) -> str | None:
    patterns = [
        r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']',
        r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:description["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
        if match:
            return _clean_text(match.group(1))
    return None


def _extract_favicon_url(text: str, page_url: str) -> str | None:
    link_pattern = r'<link[^>]+rel=["\'][^"\']*(?:icon|shortcut icon|apple-touch-icon)[^"\']*["\'][^>]*>'
    href_pattern = r'href=["\']([^"\']+)["\']'
    for link in re.findall(link_pattern, text, flags=re.IGNORECASE | re.DOTALL):
        href = re.search(href_pattern, link, flags=re.IGNORECASE)
        if href:
            return urljoin(page_url, html.unescape(href.group(1)))
    parsed = urlparse(page_url)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
    return None


def _summarize_html(text: str, description: str | None) -> str | None:
    if description:
        return description[:500]
    stripped = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    stripped = re.sub(r"<[^>]+>", " ", stripped)
    cleaned = _clean_text(stripped)
    return cleaned[:500] if cleaned else None


def html_to_text(text: str) -> str:
    stripped = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    stripped = re.sub(r"<[^>]+>", " ", stripped)
    return _clean_text(stripped)


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def _open_path(path: Path) -> None:
    if sys.platform.startswith("win"):
        os.startfile(path)  # type: ignore[attr-defined]
        return
    if sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
        return
    subprocess.Popen(["xdg-open", str(path)])
