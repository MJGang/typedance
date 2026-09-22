import json
import sqlite3
from typing import TypeVar

from pydantic import BaseModel

from .models import utc_now
from .revision_models import (
    DEFAULT_TEMPLATE_ID,
    Document,
    DocumentClaim,
    DocumentModule,
    DraftVersion,
    EvidenceLink,
    ExportArtifact,
    ContextSource,
    ParsedBlock,
    RenderProjection,
    RevisionAction,
    RevisionIssue,
    RevisionProposal,
    SourceDocument,
    SourceResumeCanvas,
    UserConfirmation,
)
from .source_canvas_doc_json import source_canvas_hash

SCHEMA_VERSION = "0.1.0"

REVISION_TABLE_DEFINITIONS = [
    """
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS source_documents (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS parsed_blocks (
      id TEXT PRIMARY KEY,
      source_document_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS source_resume_canvases (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS draft_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS document_modules (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS document_claims (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      module_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS evidence_links (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      claim_id TEXT,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS revision_issues (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      draft_id TEXT,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS revision_proposals (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      draft_id TEXT,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS revision_actions (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_confirmations (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS render_projections (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS export_artifacts (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      draft_id TEXT,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS context_sources (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
]


def migrate_revision_payloads(connection: sqlite3.Connection) -> None:
    _drop_obsolete_ai_run_tables(connection)
    _allow_nullable_export_artifact_draft_id(connection)
    _normalize_document_payloads(connection)
    _normalize_source_document_payloads(connection)
    _normalize_source_resume_canvas_payloads(connection)
    _remove_single_column_layouts(connection)
    connection.commit()


def _drop_obsolete_ai_run_tables(connection: sqlite3.Connection) -> None:
    connection.execute("DROP TABLE IF EXISTS agent_steps")
    connection.execute("DROP TABLE IF EXISTS revision_runs")


def _allow_nullable_export_artifact_draft_id(connection: sqlite3.Connection) -> None:
    columns = connection.execute("PRAGMA table_info(export_artifacts)").fetchall()
    draft_id_column = next((column for column in columns if column["name"] == "draft_id"), None)
    if draft_id_column is None or draft_id_column["notnull"] == 0:
        return

    legacy_table = "export_artifacts_before_nullable_draft_id"
    connection.execute(f"ALTER TABLE export_artifacts RENAME TO {legacy_table}")
    connection.execute(
        """
        CREATE TABLE export_artifacts (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          draft_id TEXT,
          payload TEXT NOT NULL,
          schema_version TEXT NOT NULL DEFAULT '0.1.0',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        f"""
        INSERT INTO export_artifacts (
          id,
          document_id,
          draft_id,
          payload,
          schema_version,
          created_at,
          updated_at
        )
        SELECT
          id,
          document_id,
          draft_id,
          payload,
          schema_version,
          created_at,
          updated_at
        FROM {legacy_table}
        """
    )
    connection.execute(f"DROP TABLE {legacy_table}")


def _normalize_document_payloads(connection: sqlite3.Connection) -> None:
    rows = connection.execute("SELECT id, payload FROM documents").fetchall()
    for row in rows:
        payload = json.loads(row["payload"])
        if "template_id" in payload:
            continue
        payload["template_id"] = DEFAULT_TEMPLATE_ID
        connection.execute(
            "UPDATE documents SET payload = ? WHERE id = ?",
            (json.dumps(payload, ensure_ascii=False), row["id"]),
        )


def _normalize_source_document_payloads(connection: sqlite3.Connection) -> None:
    rows = connection.execute("SELECT id, payload FROM source_documents").fetchall()
    for row in rows:
        payload = json.loads(row["payload"])
        changed = False
        if payload.get("parse_status") == "parsed":
            payload["parse_status"] = "recognized"
            changed = True
        elif payload.get("parse_status") == "failed":
            payload["parse_status"] = "recognition_failed"
            changed = True
        if "metadata" not in payload or not isinstance(payload["metadata"], dict):
            payload["metadata"] = {}
            changed = True
        if changed:
            connection.execute(
                "UPDATE source_documents SET payload = ? WHERE id = ?",
                (json.dumps(payload, ensure_ascii=False), row["id"]),
            )


def _normalize_source_resume_canvas_payloads(connection: sqlite3.Connection) -> None:
    rows = connection.execute("SELECT id, payload FROM source_resume_canvases").fetchall()
    for row in rows:
        payload = json.loads(row["payload"])
        changed = False
        doc_json = payload.get("doc_json")
        if not isinstance(doc_json, dict):
            doc_json = {"type": "doc", "content": []}
            payload["doc_json"] = doc_json
            changed = True
        if not isinstance(payload.get("version"), int) or payload.get("version") < 1:
            payload["version"] = 1
            changed = True
        if not isinstance(payload.get("source_snapshot_hash"), str) or not payload["source_snapshot_hash"]:
            payload["source_snapshot_hash"] = source_canvas_hash(doc_json)
            changed = True
        if changed:
            connection.execute(
                "UPDATE source_resume_canvases SET payload = ? WHERE id = ?",
                (json.dumps(payload, ensure_ascii=False), row["id"]),
            )


def _remove_single_column_layouts(connection: sqlite3.Connection) -> None:
    """一次性展开已废弃的单栏容器，避免在运行时代码中保留兼容分支。"""
    for table in ("resume_versions", "template_samples", "source_resume_canvases", "render_projections"):
        rows = connection.execute(f"SELECT id, payload FROM {table}").fetchall()
        for row in rows:
            payload = json.loads(row["payload"])
            doc_json = payload.get("doc_json")
            if not isinstance(doc_json, dict) or not _unwrap_single_column_nodes(doc_json):
                continue

            if table == "source_resume_canvases":
                payload["source_snapshot_hash"] = source_canvas_hash(doc_json)
            elif table == "render_projections":
                payload["html"] = None
            connection.execute(
                f"UPDATE {table} SET payload = ? WHERE id = ?",
                (json.dumps(payload, ensure_ascii=False), row["id"]),
            )


def _unwrap_single_column_nodes(node: dict[str, object]) -> bool:
    content = node.get("content")
    if not isinstance(content, list):
        return False

    changed = False
    migrated_content: list[object] = []
    for child in content:
        if not isinstance(child, dict):
            migrated_content.append(child)
            continue

        changed = _unwrap_single_column_nodes(child) or changed
        attrs = child.get("attrs")
        is_single_column = (
            child.get("type") == "columns"
            and isinstance(attrs, dict)
            and attrs.get("count") == 1
        )
        if not is_single_column:
            migrated_content.append(child)
            continue

        column_children = child.get("content")
        if isinstance(column_children, list):
            for column in column_children:
                if isinstance(column, dict) and column.get("type") == "column":
                    nested_content = column.get("content")
                    if isinstance(nested_content, list):
                        migrated_content.extend(nested_content)
                else:
                    migrated_content.append(column)
        changed = True

    if changed:
        node["content"] = migrated_content
    return changed


ModelT = TypeVar("ModelT", bound=BaseModel)


def _payload(model: BaseModel) -> str:
    return model.model_dump_json()


def _created_at(model: BaseModel) -> str:
    value = getattr(model, "created_at", None)
    if isinstance(value, str):
        return value
    value = getattr(model, "started_at", None)
    if isinstance(value, str):
        return value
    return ""


def _updated_at(model: BaseModel) -> str:
    value = getattr(model, "updated_at", None)
    if isinstance(value, str):
        return value
    value = getattr(model, "finished_at", None)
    if isinstance(value, str):
        return value
    value = getattr(model, "created_at", None)
    if isinstance(value, str):
        return value
    value = getattr(model, "started_at", None)
    if isinstance(value, str):
        return value
    return ""


class RevisionRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection

    def _save_without_commit(self, table: str, model: BaseModel, extra_columns: dict[str, str | None]) -> None:
        columns = ["id", *extra_columns.keys(), "payload", "schema_version", "created_at", "updated_at"]
        values = [
            getattr(model, "id"),
            *extra_columns.values(),
            _payload(model),
            SCHEMA_VERSION,
            _created_at(model),
            _updated_at(model),
        ]
        placeholders = ", ".join("?" for _ in columns)
        assignments = ", ".join(
            f"{column} = excluded.{column}"
            for column in columns
            if column != "id"
        )
        self.connection.execute(
            f"""
            INSERT INTO {table} ({", ".join(columns)})
            VALUES ({placeholders})
            ON CONFLICT(id) DO UPDATE SET {assignments}
            """,
            values,
        )

    def _save(self, table: str, model: BaseModel, extra_columns: dict[str, str | None]) -> None:
        self._save_without_commit(table, model, extra_columns)
        self.connection.commit()

    def _get(self, table: str, model_type: type[ModelT], entity_id: str) -> ModelT | None:
        row = self.connection.execute(
            f"SELECT payload FROM {table} WHERE id = ?",
            (entity_id,),
        ).fetchone()
        if row is None:
            return None
        return model_type.model_validate(json.loads(row["payload"]))

    def _list(
        self,
        table: str,
        model_type: type[ModelT],
        where_column: str,
        where_value: str,
        order_by: str = "created_at ASC",
    ) -> list[ModelT]:
        rows = self.connection.execute(
            f"SELECT payload FROM {table} WHERE {where_column} = ? ORDER BY {order_by}",
            (where_value,),
        ).fetchall()
        return [model_type.model_validate(json.loads(row["payload"])) for row in rows]

    def save_document(self, document: Document) -> Document:
        self._save("documents", document, {})
        return document

    def get_document(self, document_id: str) -> Document | None:
        return self._get("documents", Document, document_id)

    def list_documents(self) -> list[Document]:
        rows = self.connection.execute(
            "SELECT payload FROM documents ORDER BY updated_at DESC"
        ).fetchall()
        return [Document.model_validate(json.loads(row["payload"])) for row in rows]

    def reassign_document_template(self, template_id: str, replacement_id: str) -> int:
        changed = 0
        try:
            for document in self.list_documents():
                if document.template_id != template_id:
                    continue
                self._save_without_commit(
                    "documents",
                    document.model_copy(update={
                        "template_id": replacement_id,
                        "updated_at": utc_now(),
                    }),
                    {},
                )
                changed += 1
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return changed

    def delete_document(self, document_id: str) -> bool:
        if self.get_document(document_id) is None:
            return False

        draft_ids = [
            row["id"]
            for row in self.connection.execute(
                "SELECT id FROM draft_versions WHERE document_id = ?",
                (document_id,),
            ).fetchall()
        ]
        source_ids = [
            row["id"]
            for row in self.connection.execute(
                "SELECT id FROM source_documents WHERE document_id = ?",
                (document_id,),
            ).fetchall()
        ]
        issue_ids = [
            row["id"]
            for row in self.connection.execute(
                "SELECT id FROM revision_issues WHERE document_id = ?",
                (document_id,),
            ).fetchall()
        ]

        try:
            for draft_id in draft_ids:
                self.connection.execute("DELETE FROM render_projections WHERE draft_id = ?", (draft_id,))
                self.connection.execute("DELETE FROM document_claims WHERE draft_id = ?", (draft_id,))
                self.connection.execute("DELETE FROM document_modules WHERE draft_id = ?", (draft_id,))
            for source_id in source_ids:
                self.connection.execute("DELETE FROM parsed_blocks WHERE source_document_id = ?", (source_id,))
            for issue_id in issue_ids:
                self.connection.execute("DELETE FROM revision_actions WHERE issue_id = ?", (issue_id,))

            for table in (
                "source_documents",
                "source_resume_canvases",
                "draft_versions",
                "evidence_links",
                "revision_issues",
                "revision_proposals",
                "user_confirmations",
                "export_artifacts",
                "context_sources",
            ):
                where_column = "workspace_id" if table == "context_sources" else "document_id"
                self.connection.execute(f"DELETE FROM {table} WHERE {where_column} = ?", (document_id,))
            self.connection.execute("DELETE FROM documents WHERE id = ?", (document_id,))
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return True

    def save_source_document(self, source: SourceDocument) -> SourceDocument:
        self._save("source_documents", source, {"document_id": source.document_id})
        return source

    def list_source_documents(self, document_id: str) -> list[SourceDocument]:
        return self._list("source_documents", SourceDocument, "document_id", document_id)

    def save_parsed_block(self, block: ParsedBlock) -> ParsedBlock:
        self._save("parsed_blocks", block, {"source_document_id": block.source_document_id})
        return block

    def list_parsed_blocks(self, source_document_id: str) -> list[ParsedBlock]:
        return self._list("parsed_blocks", ParsedBlock, "source_document_id", source_document_id)

    def save_source_resume_canvas(self, canvas: SourceResumeCanvas) -> SourceResumeCanvas:
        self._save("source_resume_canvases", canvas, {"document_id": canvas.document_id})
        return canvas

    def save_initialized_source_resume_canvas(
        self,
        source: SourceDocument,
        canvas: SourceResumeCanvas,
    ) -> SourceDocument:
        try:
            self._save_without_commit("source_documents", source, {"document_id": source.document_id})
            self._save_without_commit("source_resume_canvases", canvas, {"document_id": canvas.document_id})
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return source

    def get_source_resume_canvas(self, document_id: str) -> SourceResumeCanvas | None:
        canvases = self._list("source_resume_canvases", SourceResumeCanvas, "document_id", document_id)
        return canvases[-1] if canvases else None

    def save_draft_version(self, draft: DraftVersion) -> DraftVersion:
        self._save("draft_versions", draft, {"document_id": draft.document_id})
        return draft

    def get_draft_version(self, draft_id: str) -> DraftVersion | None:
        return self._get("draft_versions", DraftVersion, draft_id)

    def list_draft_versions(self, document_id: str) -> list[DraftVersion]:
        return self._list("draft_versions", DraftVersion, "document_id", document_id)

    def save_document_module(self, module: DocumentModule) -> DocumentModule:
        self._save("document_modules", module, {"draft_id": module.draft_id})
        return module

    def list_document_modules(self, draft_id: str) -> list[DocumentModule]:
        return self._list("document_modules", DocumentModule, "draft_id", draft_id)

    def save_document_claim(self, claim: DocumentClaim) -> DocumentClaim:
        self._save("document_claims", claim, {"draft_id": claim.draft_id, "module_id": claim.module_id})
        return claim

    def list_document_claims(self, draft_id: str) -> list[DocumentClaim]:
        return self._list("document_claims", DocumentClaim, "draft_id", draft_id)

    def save_evidence_link(self, evidence: EvidenceLink) -> EvidenceLink:
        self._save(
            "evidence_links",
            evidence,
            {"document_id": evidence.document_id, "claim_id": evidence.claim_id},
        )
        return evidence

    def get_evidence_link(self, evidence_id: str) -> EvidenceLink | None:
        return self._get("evidence_links", EvidenceLink, evidence_id)

    def list_evidence_links(self, document_id: str) -> list[EvidenceLink]:
        return self._list("evidence_links", EvidenceLink, "document_id", document_id)

    def save_revision_issue(self, issue: RevisionIssue) -> RevisionIssue:
        self._save(
            "revision_issues",
            issue,
            {"document_id": issue.document_id, "draft_id": issue.draft_id},
        )
        return issue

    def get_revision_issue(self, issue_id: str) -> RevisionIssue | None:
        return self._get("revision_issues", RevisionIssue, issue_id)

    def list_revision_issues(self, draft_id: str) -> list[RevisionIssue]:
        return self._list("revision_issues", RevisionIssue, "draft_id", draft_id)

    def save_revision_proposal(self, proposal: RevisionProposal) -> RevisionProposal:
        self._save(
            "revision_proposals",
            proposal,
            {"document_id": proposal.document_id, "draft_id": proposal.draft_id},
        )
        return proposal

    def get_revision_proposal(self, proposal_id: str) -> RevisionProposal | None:
        return self._get("revision_proposals", RevisionProposal, proposal_id)

    def list_revision_proposals(self, draft_id: str) -> list[RevisionProposal]:
        return self._list("revision_proposals", RevisionProposal, "draft_id", draft_id)

    def save_revision_action(self, action: RevisionAction) -> RevisionAction:
        self._save("revision_actions", action, {"issue_id": action.issue_id})
        return action

    def list_revision_actions(self, issue_id: str) -> list[RevisionAction]:
        return self._list("revision_actions", RevisionAction, "issue_id", issue_id)

    def save_user_confirmation(self, confirmation: UserConfirmation) -> UserConfirmation:
        self._save("user_confirmations", confirmation, {"document_id": confirmation.document_id})
        return confirmation

    def list_user_confirmations(self, document_id: str) -> list[UserConfirmation]:
        return self._list("user_confirmations", UserConfirmation, "document_id", document_id)

    def save_render_projection(self, projection: RenderProjection) -> RenderProjection:
        self._save("render_projections", projection, {"draft_id": projection.draft_id})
        return projection

    def get_render_projection(self, projection_id: str) -> RenderProjection | None:
        return self._get("render_projections", RenderProjection, projection_id)

    def save_export_artifact(self, artifact: ExportArtifact) -> ExportArtifact:
        self._save(
            "export_artifacts",
            artifact,
            {"document_id": artifact.document_id, "draft_id": artifact.draft_id},
        )
        return artifact

    def list_export_artifacts(self, document_id: str) -> list[ExportArtifact]:
        return self._list("export_artifacts", ExportArtifact, "document_id", document_id)

    def save_context_source(self, source: ContextSource) -> ContextSource:
        self._save("context_sources", source, {"workspace_id": source.workspace_id})
        return source

    def get_context_source(self, source_id: str) -> ContextSource | None:
        return self._get("context_sources", ContextSource, source_id)

    def list_context_sources(self, workspace_id: str) -> list[ContextSource]:
        return self._list("context_sources", ContextSource, "workspace_id", workspace_id)

    def delete_context_source(self, source_id: str) -> bool:
        cursor = self.connection.execute("DELETE FROM context_sources WHERE id = ?", (source_id,))
        self.connection.commit()
        return cursor.rowcount > 0
