import {
  resumeVersionSchema,
  templateSampleContentSchema,
  templateStyleConfigSchema,
  type ResumeVersion,
  type TemplateSampleContent,
  type TemplateStyleConfig,
} from "@typedance/contracts";

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

export async function exportResumePdf(resumeId: string): Promise<{ file_path: string; preview_pdf_url: string }> {
  const response = await fetch(`${baseUrl}/exports/pdf/${resumeId}`, { method: "POST" });

  if (!response.ok) {
    throw new Error(`Failed to export PDF: ${response.status}`);
  }

  return response.json() as Promise<{ file_path: string; preview_pdf_url: string }>;
}

function deepStripNull(obj: unknown): unknown {
  if (obj === null) return undefined;
  if (Array.isArray(obj)) return obj.map(deepStripNull);
  if (typeof obj === "object" && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .map(([k, v]) => [k, deepStripNull(v)])
        .filter(([_, v]) => v !== undefined),
    );
  }
  return obj;
}

async function parseTemplateResponse<T>(
  response: Response,
  parser: (value: unknown) => T,
  fallbackMessage: string,
): Promise<T> {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const details = Array.isArray(payload?.detail)
      ? payload.detail
          .map((item: Record<string, unknown>) => JSON.stringify(item))
          .join(", ")
      : `${response.status}`;
    throw new Error(`${fallbackMessage}: ${details}`);
  }

  return parser(deepStripNull(payload));
}

export async function getTemplateSample(sampleId: string): Promise<TemplateSampleContent> {
  const response = await fetch(`${baseUrl}/template-samples/${sampleId}`);
  return parseTemplateResponse(
    response,
    templateSampleContentSchema.parse,
    "Failed to load template sample",
  );
}

export async function saveTemplateSample(sample: TemplateSampleContent): Promise<TemplateSampleContent> {
  const response = await fetch(`${baseUrl}/template-samples/${sample.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sample),
  });
  return parseTemplateResponse(
    response,
    templateSampleContentSchema.parse,
    "Failed to save template sample",
  );
}

export async function getTemplateStyle(templateId: string): Promise<TemplateStyleConfig> {
  const response = await fetch(`${baseUrl}/template-styles/${templateId}`);
  return parseTemplateResponse(
    response,
    templateStyleConfigSchema.parse,
    "Failed to load template style",
  );
}

export async function saveTemplateStyle(style: TemplateStyleConfig): Promise<TemplateStyleConfig> {
  const response = await fetch(`${baseUrl}/template-styles/${style.template_id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(style),
  });
  return parseTemplateResponse(
    response,
    templateStyleConfigSchema.parse,
    "Failed to save template style",
  );
}

