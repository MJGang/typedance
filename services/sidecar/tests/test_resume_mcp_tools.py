from test_revision_api import repo_for, seed_workspace

from typedance_sidecar.mcp.resume_tools import ResumeMcpTools


def test_resume_mcp_tools_expose_resume_workspace_actions(tmp_path):
    seed_workspace(tmp_path)
    tools = ResumeMcpTools(lambda: repo_for(tmp_path))

    workspace = tools.get_workspace_view("doc_1")

    assert workspace["document"]["id"] == "doc_1"
    assert workspace["current_draft"]["id"] == "draft_1"
    assert workspace["issues"][0]["id"] == "issue_1"

    saved_canvas = tools.save_source_resume_canvas(
        "doc_1",
        {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "attrs": {"canvasNodeId": "node_1", "moduleId": "mod_1"},
                    "content": [{"type": "text", "text": "用户编辑后的旧简历正文"}],
                }
            ],
        },
    )
    assert saved_canvas["version"] == 2
    assert saved_canvas["node_map"][0]["text"] == "用户编辑后的旧简历正文"

    accepted = tools.accept_proposal("prop_1")
    assert accepted["status"] == "applied"

    dismissed = tools.dismiss_issue("issue_1")
    assert dismissed["status"] == "dismissed"

    confirmation = tools.confirm_claim(
        "doc_1",
        "claim_1",
        evidence_link_id="ev_1",
        issue_id="issue_1",
        note="用户确认真实。",
    )
    assert confirmation["claim_id"] == "claim_1"
    assert confirmation["note"] == "用户确认真实。"


def test_resume_mcp_tools_raise_clear_error_for_missing_entities(tmp_path):
    tools = ResumeMcpTools(lambda: repo_for(tmp_path))

    try:
        tools.get_workspace_view("doc_missing")
    except ValueError as exc:
        assert "Document not found" in str(exc)
    else:
        raise AssertionError("expected missing document error")
