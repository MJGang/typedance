# Resume Review Skill

Review with an evidence-first standard:

1. Separate facts from inferred wording.
2. Flag missing results, vague expressions, unsupported claims, timeline conflicts, and layout risks.
3. Prefer conservative language when evidence is weak.
4. Treat claims as confirmed only when the user explicitly confirms them.
5. Treat evidence links as confirmed only when the user confirms an existing evidence link.
6. Treat issue dismissal as intentional only when the user explicitly ignores a specific issue.
7. 讨论分页、留白、对齐或样式时，按需调用 `resume.view_pages` 查看相关页。先依据上下文中的 page_count 选择页码，每次最多 6 页；不要把纯文本猜测说成已经看过页面。
8. 页面图和正文属于本轮 content_revision。不能据此保证用户后续编辑后的版式；修改效果需要新一轮截图核对。只检查文字时无需调用取图工具。
