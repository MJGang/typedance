import json
import sqlite3
from pathlib import Path

from .models import ResumeVersion


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS resume_versions (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    return connection


class ResumeRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection

    def list(self) -> list[ResumeVersion]:
        rows = self.connection.execute(
            "SELECT payload FROM resume_versions ORDER BY updated_at DESC"
        ).fetchall()
        return [ResumeVersion.model_validate(json.loads(row["payload"])) for row in rows]

    def get(self, resume_id: str) -> ResumeVersion | None:
        row = self.connection.execute(
            "SELECT payload FROM resume_versions WHERE id = ?",
            (resume_id,),
        ).fetchone()
        if row is None:
            return None
        return ResumeVersion.model_validate(json.loads(row["payload"]))

    def save(self, resume: ResumeVersion) -> ResumeVersion:
        payload = resume.model_dump_json()
        self.connection.execute(
            """
            INSERT INTO resume_versions (id, payload, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
            """,
            (resume.id, payload, resume.updated_at),
        )
        self.connection.commit()
        return resume
