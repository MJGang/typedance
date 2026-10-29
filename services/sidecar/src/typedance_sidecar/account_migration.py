"""一次性本机资料复制：只处理调用方明确授权的目录条目，不解析业务数据。"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import stat
import tempfile
import time
from collections.abc import Callable, Iterator, Sequence
from contextlib import closing, contextmanager
from pathlib import Path, PurePosixPath


class LocalDataMigrationError(ValueError):
    """迁移被拒绝或未完成，原资料保持不动。"""


def _relative_name(value: str) -> str:
    name = value.replace("\\", "/")
    parts = name.split("/")
    if not name or any(part in ("", ".", "..") for part in parts):
        raise LocalDataMigrationError("迁移条目必须是明确的相对路径")
    if PurePosixPath(name).is_absolute() or any(":" in part for part in parts):
        raise LocalDataMigrationError("迁移条目不能包含绝对路径或设备路径")
    return name


def _plain(path: Path) -> os.stat_result:
    info = path.lstat()
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & reparse:
        raise LocalDataMigrationError("迁移目录不能包含符号链接或目录联接")
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
        raise LocalDataMigrationError("迁移条目包含不支持的文件类型")
    return info


def _digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _is_database(path: Path) -> bool:
    with path.open("rb") as stream:
        return stream.read(16) == b"SQLite format 3\x00"


def _copy_file(source: Path, destination: Path) -> None:
    before = _plain(source)
    if _is_database(source):
        started = time.monotonic()

        def progress(_status: int, _remaining: int, _total: int) -> None:
            if time.monotonic() - started > 30:
                raise LocalDataMigrationError("数据库仍被占用，请关闭正在使用旧资料的应用后重试")

        # backup 包含已提交的 WAL 内容；不能直接复制正在使用的 SQLite 主文件。
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as origin:
            with closing(sqlite3.connect(destination)) as copied:
                origin.backup(copied, pages=128, progress=progress, sleep=0.05)
                if copied.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                    raise LocalDataMigrationError("数据库快照校验失败，原资料已保留")
    else:
        shutil.copy2(source, destination, follow_symlinks=False)
        after = _plain(source)
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise LocalDataMigrationError("旧资料正在变化，请关闭相关应用后重试")
        if _digest(source) != _digest(destination):
            raise LocalDataMigrationError("文件复制校验失败，原资料已保留")


def _write_json(path: Path, value: dict) -> None:
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


@contextmanager
def _lock(path: Path) -> Iterator[None]:
    # 文件锁随进程退出自动释放，进程中断不会遗留无法恢复的 PID 锁。
    with path.open("a+b") as stream:
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise LocalDataMigrationError("同一资料空间正在迁移，请稍后重试") from error
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def migrate_local_data(
    source: Path, target: Path, entries: Sequence[str], excluded: Sequence[str],
    *, prepare_target: Callable[[Path], None] | None = None,
) -> dict:
    """复制授权条目到空的目标目录；调用方必须先停止相关业务服务。

    不删除源资料，不自动处理密钥归属，不跟随资料中的外部文件引用。
    失败只清理本次创建的暂存目录；恢复时可对同一空目标重试。
    prepare_target 在发布前处理暂存副本；其失败同样不会发布部分资料。
    """
    source = Path(os.path.abspath(source))
    target = Path(os.path.abspath(target))
    _plain(source)
    if not source.is_dir() or source == target or source.is_relative_to(target):
        raise LocalDataMigrationError("源目录与目标目录无效")
    names = [_relative_name(name) for name in entries]
    omissions = {_relative_name(name).casefold() for name in excluded}
    if not names or len({name.casefold() for name in names}) != len(names):
        raise LocalDataMigrationError("迁移条目不能为空或重复")
    for index, name in enumerate(names):
        entry = source.joinpath(*name.split("/"))
        if target.is_relative_to(entry):
            raise LocalDataMigrationError("目标目录不能位于被复制的资料条目中")
        if any(
            name.casefold().startswith(other.casefold() + "/")
            or other.casefold().startswith(name.casefold() + "/")
            for other in names[:index]
        ):
            raise LocalDataMigrationError("迁移条目不能相互包含")
        current = source
        for part in name.split("/"):
            current /= part
            _plain(current)
    target.parent.mkdir(parents=True, exist_ok=True)
    _plain(target.parent)
    journal = target.parent / f".{target.name}.import.json"
    with _lock(target.parent / f".{target.name}.import.lock"):
        if target.exists():
            _plain(target)
            if not target.is_dir() or any(target.iterdir()):
                raise LocalDataMigrationError("目标已有资料，已拒绝覆盖")
        staging = Path(tempfile.mkdtemp(prefix=f".{target.name}.import-", dir=target.parent))
        staging_parent = staging.parent.resolve()
        result = {"migrated": True, "file_count": 0, "entries": names}

        def omitted(relative: str) -> bool:
            normalized = relative.casefold()
            return any(normalized == item or normalized.startswith(item + "/") for item in omissions)

        def copy_entry(origin: Path, destination: Path, relative: str) -> None:
            if omitted(relative):
                return
            info = _plain(origin)
            if stat.S_ISDIR(info.st_mode):
                destination.mkdir()
                for child in sorted(origin.iterdir(), key=lambda path: path.name.casefold()):
                    copy_entry(child, destination / child.name, relative + "/" + child.name)
                return
            for suffix in ("-wal", "-shm", "-journal"):
                if origin.name.endswith(suffix):
                    database = origin.with_name(origin.name.removesuffix(suffix))
                    if database.is_file():
                        _plain(database)
                        if _is_database(database):
                            return
            destination.parent.mkdir(parents=True, exist_ok=True)
            _copy_file(origin, destination)
            result["file_count"] += 1

        try:
            _write_json(journal, {"state": "copying", "entries": names})
            for name in names:
                copy_entry(source.joinpath(*name.split("/")), staging.joinpath(*name.split("/")), name)
            if prepare_target is not None:
                prepare_target(staging)
            _write_json(staging / ".local-data-import.json", result)
            # 校验完成后才发布整个目录，不逐项覆盖已有资料。
            if target.exists():
                target.rmdir()
            staging.rename(target)
        except BaseException:
            if staging.exists():
                # 只清理本次 mkdtemp 的目录，验证其仍在指定目标父目录中。
                if staging.parent.resolve() == staging_parent and staging.name.startswith(f".{target.name}.import-"):
                    _plain(staging)
                    shutil.rmtree(staging)
            _write_json(journal, {"state": "failed", "entries": names})
            raise
        # 数据已发布即成功；日志状态更新失败不把一次成功导入报告为失败。
        try:
            _write_json(journal, {"state": "complete", **result})
        except OSError:
            pass
        return result
