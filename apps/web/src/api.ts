import { z } from "zod";
import {
  resumeVersionSchema,
  templateSampleContentSchema,
  templateStyleConfigSchema,
  type ResumeVersion,
  type TemplateSampleContent,
  type TemplateStyleConfig,
} from "@typedance/contracts";
import { chooseHtmlSavePathInTauri, choosePdfSavePathInTauri, isTauri } from "./tauri";
const baseUrl = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:4317";

function decodeHeaderPath(value: string | null): string | undefined {
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export async function listResumeVersions(): Promise<ResumeVersion[]> {
  const response = await fetch(`${baseUrl}/resume-versions`);
  if (!response.ok) throw new Error(`Failed to list resumes: ${response.status}`);
  return z.array(resumeVersionSchema).parse(deepStripNull(await response.json()));
}

export async function getResumeVersion(resumeId: string): Promise<ResumeVersion> {
  const response = await fetch(`${baseUrl}/resume-versions/${resumeId}`);
  if (!response.ok) throw new Error(`Failed to get resume: ${response.status}`);
  return resumeVersionSchema.parse(deepStripNull(await response.json()));
}

export async function updateResumeVersion(
  resumeId: string,
  data: Partial<Pick<ResumeVersion, "title" | "target_language" | "template_id" | "doc_json" | "plain_text_snapshot">>,
): Promise<ResumeVersion> {
  const response = await fetch(`${baseUrl}/resume-versions/${resumeId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`Failed to update resume: ${response.status}`);
  return resumeVersionSchema.parse(deepStripNull(await response.json()));
}

export async function deleteResumeVersion(resumeId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/resume-versions/${resumeId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Failed to delete resume: ${response.status}`);
}

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

export async function exportResumePdf(
  resumeId: string,
  title: string,
): Promise<{ fileName: string; previewUrl: string; filePath?: string } | null> {
  // 1. 让用户选择保存位置（File System Access API，仅 Chromium 支持）
  let fileHandle: FileSystemFileHandle | null = null
  let fileName = `resume-${title.replace(/[/\\?%*:|"<>]/g, "_")}.pdf`
  let outputPath: string | null = null

  if (isTauri()) {
    outputPath = await choosePdfSavePathInTauri(fileName)
    if (!outputPath) return null
    fileName = outputPath.split(/[/\\]/).pop() ?? fileName
  }

  const showPicker = (window as any).showSaveFilePicker as ((opts: Record<string, unknown>) => Promise<FileSystemFileHandle>) | undefined
  if (!outputPath && showPicker) {
    try {
      fileHandle = await showPicker({
        suggestedName: fileName,
        types: [
          { description: "PDF", accept: { "application/pdf": [".pdf"] } },
        ],
      })
      fileName = fileHandle.name
    } catch (err) {
      // 用户取消或浏览器不支持
      if (err instanceof DOMException && err.name === "AbortError") {
        return null
      }
      // 其他错误：fallback 到默认下载
    }
  }

  // 2. 请求 Sidecar 生成 PDF
  const requestInit: RequestInit = outputPath
    ? {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ output_path: outputPath }),
      }
    : { method: "POST" }

  const response = await fetch(`${baseUrl}/exports/pdf/${resumeId}`, requestInit)

  if (!response.ok) {
    throw new Error(`Failed to export PDF: ${response.status}`)
  }

  const previewUrl = `${baseUrl}/previews/${resumeId}.pdf`
  const filePath = decodeHeaderPath(response.headers.get("X-Pdf-Path"))

  if (outputPath) {
    await response.blob()
    const savedPath = filePath ?? outputPath
    const savedName = savedPath.split(/[/\\]/).pop() ?? fileName
    return { fileName: savedName, previewUrl, filePath: savedPath }
  }

  const blob = await response.blob()

  // 3. 写入用户选择的位置，或触发浏览器下载
  if (fileHandle) {
    const writable = await fileHandle.createWritable()
    await writable.write(blob)
    await writable.close()
    return { fileName, previewUrl }
  } else {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return { fileName, previewUrl, filePath }
}

export async function exportResumeHtml(
  resumeId: string,
  title: string,
): Promise<{ fileName: string; filePath?: string } | null> {
  let fileHandle: FileSystemFileHandle | null = null
  let fileName = `resume-${title.replace(/[/\\?%*:|"<>]/g, "_")}.html`
  let outputPath: string | null = null

  if (isTauri()) {
    outputPath = await chooseHtmlSavePathInTauri(fileName)
    if (!outputPath) return null
    fileName = outputPath.split(/[/\\]/).pop() ?? fileName
  }

  const showPicker = (window as any).showSaveFilePicker as ((opts: Record<string, unknown>) => Promise<FileSystemFileHandle>) | undefined
  if (!outputPath && showPicker) {
    try {
      fileHandle = await showPicker({
        suggestedName: fileName,
        types: [
          { description: "HTML", accept: { "text/html": [".html", ".htm"] } },
        ],
      })
      fileName = fileHandle.name
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return null
      }
    }
  }

  const requestInit: RequestInit = outputPath
    ? {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ output_path: outputPath }),
      }
    : { method: "POST" }

  const response = await fetch(`${baseUrl}/exports/html/${resumeId}`, requestInit)

  if (!response.ok) {
    throw new Error(`Failed to export HTML: ${response.status}`)
  }

  const filePath = decodeHeaderPath(response.headers.get("X-Html-Path"))

  if (outputPath) {
    await response.blob()
    const savedPath = filePath ?? outputPath
    const savedName = savedPath.split(/[/\\]/).pop() ?? fileName
    return { fileName: savedName, filePath: savedPath }
  }

  const blob = await response.blob()

  if (fileHandle) {
    const writable = await fileHandle.createWritable()
    await writable.write(blob)
    await writable.close()
  } else {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return { fileName, filePath }
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

