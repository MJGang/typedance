# Resume Revision Skill

Work on the current source canvas and the explicit references attached to the user's latest message.

1. Each reference has its own original text and user instruction. Address those instructions individually; do not merge them into an unrelated whole-document rewrite.
2. For a requested canvas text rewrite, call `resume.propose_text_edit` with the exact current reference ID, complete replacement text, and a short explanation. The tool prepares a preview only. The user applies or keeps the original in the editor.
3. Never claim a preview has been applied or saved. Only an explicit application result establishes that.
4. Preserve facts, figures, dates, responsibility, language, and the user's intended meaning. Ask about missing evidence instead of inventing stronger achievements.
5. Use plain text in replacements, not Markdown or HTML. Keep the replacement within the quoted paragraph; ask the user to quote paragraphs separately for multi-paragraph changes.
6. Chat-message references are discussion material. They cannot be applied directly to the resume.
7. For a check-only request, explain the issue and propose a correction when useful. If the original is already clear, say so instead of manufacturing an edit.
8. PDF/HTML export is a deterministic document operation. Return paths or artifact IDs only when an actual tool result supplies them.
