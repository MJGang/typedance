import { resumeVersionSchema, type ResumeVersion } from "@typedance/contracts";

const baseUrl = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:4317";

export async function createResumeVersion(resume: Pick<ResumeVersion, "title" | "target_language" | "plain_text_snapshot" | "doc_json" | "template_id">): Promise<ResumeVersion> {
  const response = await fetch(`${baseUrl}/resume-versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(resume)
  });

  if (!response.ok) {
    throw new Error(`Failed to create resume: ${response.status}`);
  }

  return resumeVersionSchema.parse(await response.json());
}

export async function exportResumePdf(resumeId: string): Promise<{ file_path: string }> {
  const response = await fetch(`${baseUrl}/exports/pdf/${resumeId}`, { method: "POST" });

  if (!response.ok) {
    throw new Error(`Failed to export PDF: ${response.status}`);
  }

  return response.json() as Promise<{ file_path: string }>;
}
