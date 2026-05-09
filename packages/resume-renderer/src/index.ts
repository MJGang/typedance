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

  let body = ""

  if (lines.length === 0) {
    body = '<p class="muted">Start writing your resume.</p>'
  } else {
    // First line = name, second line = title, rest = experience
    const name = escapeHtml(lines[0])
    const title = lines.length > 1 ? escapeHtml(lines[1]) : ""
    const experience = lines.slice(2)

    body = `<header class="resume-header">\n      <h1>${name}</h1>\n      ${title ? `<p class="resume-title">${title}</p>` : ""}\n    </header>`

    if (experience.length > 0) {
      body += "\n    <section class=\"resume-body\">\n      "
      body += experience.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n      ")
      body += "\n    </section>"
    }
  }

  return `<!doctype html>\n<html lang="${resume.target_language}">\n  <head>\n    <meta charset="utf-8" />\n    <style>\n      @page { size: A4; margin: 20mm 22mm; }\n      body {\n        font-family: "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif;\n        color: #1f2937;\n        line-height: 1.6;\n        font-size: 11pt;\n      }\n      .resume-header {\n        border-bottom: 2px solid #174ea6;\n        margin-bottom: 16px;\n        padding-bottom: 12px;\n      }\n      h1 {\n        font-size: 22pt;\n        margin: 0 0 4px;\n        font-weight: 700;\n        color: #101827;\n      }\n      .resume-title {\n        font-size: 11pt;\n        margin: 0;\n        color: #174ea6;\n        font-weight: 600;\n      }\n      .resume-body p {\n        margin: 0 0 8px;\n        font-size: 10pt;\n        line-height: 1.55;\n        color: #374151;\n      }\n      .muted { color: #9ca3af; font-style: italic; }\n    </style>\n  </head>\n  <body>\n    ${body}\n  </body>\n</html>`
}