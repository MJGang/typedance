"""账号资料一次性迁移：重定位 Sidecar 自有文件引用，不修改外部真实文件引用。"""

import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname


def rebase_sidecar_file_references(database: Path, source: Path, target: Path) -> None:
    if not database.is_file():
        return
    old_files = Path(os.path.abspath(source / "files"))
    new_files = Path(os.path.abspath(target / "files"))

    def rebase(value):
        if not isinstance(value, str) or not value:
            return value
        is_uri = value.lower().startswith("file:")
        if is_uri:
            uri = urlparse(value)
            if uri.netloc not in ("", "localhost") or uri.query or uri.fragment:
                return value
            candidate = Path(url2pathname(uri.path))
        else:
            candidate = Path(value)
        if not candidate.is_absolute():
            return value
        try:
            relative = Path(os.path.abspath(candidate)).relative_to(old_files)
        except ValueError:
            return value
        replacement = new_files / relative
        return replacement.as_uri() if is_uri else str(replacement)

    # 只处理已定义为文件引用的字段；正文、说明和第三方 URL 均保持原样。
    fields = {
        "source_documents": ("file_path", "original_uri"),
        "export_artifacts": ("file_path",),
        "resume_versions": ("preview_pdf_path",),
        "context_sources": ("uri",),
    }
    with closing(sqlite3.connect(database)) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        with connection:
            for table, names in fields.items():
                if table not in tables:
                    continue
                for identity, encoded in connection.execute(f"SELECT id, payload FROM {table}").fetchall():
                    payload = json.loads(encoded)
                    if not isinstance(payload, dict):
                        raise ValueError("账号资料中的文件引用记录无效，原资料已保留")
                    if table == "context_sources" and payload.get("type") not in ("file", "directory"):
                        continue
                    changed = False
                    for name in names:
                        if name not in payload:
                            continue
                        updated = rebase(payload[name])
                        if updated != payload[name]:
                            payload[name] = updated
                            changed = True
                    if changed:
                        if table == "resume_versions":
                            payload["preview_pdf_url"] = None
                        connection.execute(f"UPDATE {table} SET payload=? WHERE id=?", (json.dumps(payload, ensure_ascii=False), identity))
            if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise ValueError("账号资料路径迁移校验失败，原资料已保留")
