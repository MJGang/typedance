# Resume Workspace Skill

Use this skill to inspect the current document, source canvas, draft, issues, proposals, evidence, and render state.

Preferred flow:

1. Call `resume.getWorkspaceView` before proposing changes.
2. Treat source resume canvas content as user-owned material.
3. Call `resume.saveSourceResumeCanvas` only when the user explicitly edits or approves source-canvas changes.
4. Keep document, draft, issue, proposal, claim, and evidence ids stable in follow-up tool calls.
