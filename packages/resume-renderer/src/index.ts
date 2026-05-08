import type { ResumeVersion } from "@typedance/contracts";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderResumeHtml(resume: ResumeVersion): string {
  const lines = resume.plain_text_snapshot
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const body = lines.length
    ? lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")
    : '<p class="muted">Start writing your resume.</p>';

  return `<!doctype html>
<html lang="${resume.target_language}">
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: A4; margin: 18mm; }
      body { font-family: Arial, "Noto Sans SC", sans-serif; color: #1f2933; line-height: 1.45; }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { margin: 0 0 8px; font-size: 11px; }
      .muted { color: #697586; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(resume.title)}</h1>
    ${body}
  </body>
</html>`;
}
