import os
from pathlib import Path

from typedance_sidecar.db import connect
from typedance_sidecar.mcp.resume_tools import ResumeMcpTools
from typedance_sidecar.revision_repository import RevisionRepository


def app_data_dir() -> Path:
    override = os.environ.get("TYPEDANCE_DATA_DIR")
    if override:
        return Path(override)
    return Path.home() / ".typedance"


def revision_repository() -> RevisionRepository:
    return RevisionRepository(connect(app_data_dir() / "typedance.sqlite"))


def create_resume_mcp_server():
    from mcp.server.fastmcp import FastMCP

    tools = ResumeMcpTools(
        revision_repository,
        export_dir_factory=lambda: app_data_dir() / "files" / "exports",
    )
    server = FastMCP("TypeDance Resume Pack")

    @server.tool(name="resume.getDocument")
    def resume_get_document(document_id: str) -> dict:
        """Get a resume document by id."""
        return tools.get_document(document_id)

    @server.tool(name="resume.getWorkspaceView")
    def resume_get_workspace_view(document_id: str) -> dict:
        """Get the current resume workspace view."""
        return tools.get_workspace_view(document_id)

    @server.tool(name="resume.saveSourceResumeCanvas")
    def resume_save_source_resume_canvas(document_id: str, doc_json: dict) -> dict:
        """Save the user-edited source resume canvas document."""
        return tools.save_source_resume_canvas(document_id, doc_json)

    @server.tool(name="resume.acceptProposal")
    def resume_accept_proposal(proposal_id: str) -> dict:
        """Accept and apply a resume revision proposal."""
        return tools.accept_proposal(proposal_id)

    @server.tool(name="resume.rejectProposal")
    def resume_reject_proposal(proposal_id: str) -> dict:
        """Reject a resume revision proposal."""
        return tools.reject_proposal(proposal_id)

    @server.tool(name="resume.dismissIssue")
    def resume_dismiss_issue(issue_id: str) -> dict:
        """Dismiss an open resume issue."""
        return tools.dismiss_issue(issue_id)

    @server.tool(name="resume.confirmClaim")
    def resume_confirm_claim(
        document_id: str,
        claim_id: str,
        confirmation_type: str = "truth_confirmed",
        evidence_link_id: str | None = None,
        issue_id: str | None = None,
        note: str | None = None,
    ) -> dict:
        """Record user confirmation for a resume claim."""
        if confirmation_type not in {"truth_confirmed", "risk_accepted", "source_verified"}:
            raise ValueError("Unsupported confirmation_type")
        return tools.confirm_claim(
            document_id,
            claim_id,
            confirmation_type=confirmation_type,
            evidence_link_id=evidence_link_id,
            issue_id=issue_id,
            note=note,
        )

    @server.tool(name="resume.confirmEvidenceLink")
    def resume_confirm_evidence_link(evidence_link_id: str) -> dict:
        """Mark an evidence link as user confirmed."""
        return tools.confirm_evidence_link(evidence_link_id)

    @server.tool(name="resume.renderDraft")
    def resume_render_draft(draft_id: str, render_profile: str | None = None) -> dict:
        """Render a draft into an HTML/doc_json projection."""
        return tools.render_draft(draft_id, render_profile)

    @server.tool(name="resume.exportDocument")
    def resume_export_document(
        document_id: str,
        export_format: str,
        output_path: str | None = None,
        source_doc_json: dict | None = None,
        page_margins: dict | None = None,
        template_style: dict | None = None,
    ) -> dict:
        """Export a resume document to PDF or HTML and return artifact metadata."""
        if export_format not in {"pdf", "html"}:
            raise ValueError("export_format must be pdf or html")
        return tools.export_document(
            document_id,
            export_format,
            output_path=output_path,
            source_doc_json=source_doc_json,
            page_margins=page_margins,
            template_style=template_style,
        )

    return server


def main() -> None:
    create_resume_mcp_server().run()


if __name__ == "__main__":
    main()
