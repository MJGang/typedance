import { z } from "zod";
import {
  editorCapabilityCatalogSchema,
  editorNodeOriginSchema,
  editorTextOriginSchema,
  type EditorOperation,
  documentListItemSchema,
  documentSchema,
  contextSourceChildSchema,
  contextSourceSchema,
  draftVersionSchema,
  evidenceLinkSchema,
  renderProjectionSchema,
  revisionIssueSchema,
  revisionProposalSchema,
  sourceDocumentSchema,
  sourceResumeCanvasSchema,
  templateSampleContentSchema,
  templateStyleConfigSchema,
  userConfirmationSchema,
  workspaceViewSchema,
  type DocumentListItem,
  type CanvasPrintSnapshot,
  type Document as RevisionDocument,
  type ContextSource,
  type ContextSourceChild,
  type DraftVersion,
  type EvidenceLink,
  type RenderProjection,
  type RevisionIssue,
  type RevisionProposal,
  type SourceDocument,
  type SourceResumeCanvas,
  type TemplateSampleContent,
  type TemplateStyleConfig,
  type UserConfirmation,
  type WorkspaceView,
} from "@typedance/contracts";
import { chooseHtmlSavePathInTauri, choosePdfSavePathInTauri, isTauri } from "./tauri";
const baseUrl = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:4317";

export async function getEditorCapabilities() {
  const response = await fetch(`${baseUrl}/editor/capabilities`)
  return parseTemplateResponse(response, (value) => editorCapabilityCatalogSchema.parse(value), "无法读取编辑能力")
}

export async function migrateEditorPageMargins(documentId: string, margins: { top: number; bottom: number; left: number; right: number } | null, originalValue: string) {
  const response = await fetch(`${baseUrl}/documents/${encodeURIComponent(documentId)}/editor/migrate-page-margins`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ margins, original_value: originalValue }),
  })
  return parseTemplateResponse(response, (value) => sourceResumeCanvasSchema.parse(value), "页面边距迁移失败，原始值已保留")
}

export async function prepareEditorOperations(docJson: Record<string, unknown>, operations: EditorOperation[], templateStyle?: TemplateStyleConfig) {
  const catalog = await getEditorCapabilities()
  const response = await fetch(`${baseUrl}/editor/prepare`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ doc_json: docJson, operations, catalog_revision: catalog.revision, template_style: templateStyle }) })
  return parseTemplateResponse(response, (value) => z.object({ doc_json: z.record(z.unknown()), catalog_revision: z.string(), node_origins: z.array(editorNodeOriginSchema).max(10000), text_origins: z.array(editorTextOriginSchema).max(10000),
    effects: z.array(z.object({ capability: z.string(), title: z.string(), effect: z.string() })) }).parse(value), "无法准备编辑操作")
}

type SaveFilePickerOptions = {
  suggestedName?: string
  types?: Array<{
    description: string
    accept: Record<string, string[]>
  }>
}

type WindowWithSaveFilePicker = Window & {
  showSaveFilePicker?: (options: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
}

function getSaveFilePicker() {
  return (window as WindowWithSaveFilePicker).showSaveFilePicker
}

function decodeHeaderPath(value: string | null): string | undefined {
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export type CreateRevisionDocumentInput = {
  title: string
  pack_id?: string
  target_language?: "zh-CN" | "en-US"
  initial_mode?: "import_old_resume" | "blank" | "base_resume" | "opportunity_variant"
}

export async function createRevisionDocument(
  document: CreateRevisionDocumentInput,
): Promise<RevisionDocument> {
  const response = await fetch(`${baseUrl}/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(document),
  })
  return parseTemplateResponse(
    response,
    (value) => documentSchema.parse(value),
    "Failed to create revision document",
  )
}

export async function listRevisionDocuments(): Promise<DocumentListItem[]> {
  const response = await fetch(`${baseUrl}/documents`)
  return parseTemplateResponse(
    response,
    (value) => z.array(documentListItemSchema).parse(value),
    "Failed to list revision documents",
  )
}

export async function duplicateRevisionDocument(documentId: string): Promise<RevisionDocument> {
  const response = await fetch(`${baseUrl}/documents/${documentId}/duplicate`, { method: "POST" })
  return parseTemplateResponse(
    response,
    (value) => documentSchema.parse(value),
    "Failed to duplicate revision document",
  )
}

export async function updateRevisionDocument(
  documentId: string,
  data: Partial<Pick<RevisionDocument, "title" | "template_id">>,
): Promise<RevisionDocument> {
  const response = await fetch(`${baseUrl}/documents/${documentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  })
  return parseTemplateResponse(
    response,
    (value) => documentSchema.parse(value),
    "Failed to update revision document",
  )
}

export async function deleteRevisionDocument(documentId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/documents/${documentId}`, { method: "DELETE" })
  if (!response.ok) throw new Error(`Failed to delete revision document: ${response.status}`)
}

export async function getRevisionWorkspaceView(documentId: string): Promise<WorkspaceView> {
  const response = await fetch(`${baseUrl}/documents/${documentId}/workspace-view`)
  return parseTemplateResponse(
    response,
    (value) => workspaceViewSchema.parse(value),
    "Failed to load revision workspace",
  )
}

export async function listContextSources(workspaceId: string): Promise<ContextSource[]> {
  const response = await fetch(`${baseUrl}/documents/${workspaceId}/context-sources`)
  return parseTemplateResponse(
    response,
    (value) => z.array(contextSourceSchema).parse(value),
    "Failed to list context sources",
  )
}

export async function addFileContextSource(workspaceId: string, path: string): Promise<ContextSource> {
  const response = await fetch(`${baseUrl}/documents/${workspaceId}/context-sources/file`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  })
  return parseTemplateResponse(
    response,
    (value) => contextSourceSchema.parse(value),
    "Failed to add file context source",
  )
}

export async function addDirectoryContextSource(workspaceId: string, path: string): Promise<ContextSource> {
  const response = await fetch(`${baseUrl}/documents/${workspaceId}/context-sources/directory`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  })
  return parseTemplateResponse(
    response,
    (value) => contextSourceSchema.parse(value),
    "Failed to add directory context source",
  )
}

export async function addWebpageContextSource(workspaceId: string, url: string): Promise<ContextSource> {
  const response = await fetch(`${baseUrl}/documents/${workspaceId}/context-sources/webpage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  })
  return parseTemplateResponse(
    response,
    (value) => contextSourceSchema.parse(value),
    "Failed to add webpage context source",
  )
}

export async function updateContextSourceTitle(sourceId: string, title: string): Promise<ContextSource> {
  const response = await fetch(`${baseUrl}/context-sources/${sourceId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  })
  return parseTemplateResponse(
    response,
    (value) => contextSourceSchema.parse(value),
    "Failed to update context source",
  )
}

export async function removeContextSource(sourceId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/context-sources/${sourceId}`, { method: "DELETE" })
  if (!response.ok) throw new Error(`Failed to remove context source: ${response.status}`)
}

export async function listContextSourceChildren(sourceId: string, path = ""): Promise<ContextSourceChild[]> {
  const searchParams = new URLSearchParams({ path })
  const response = await fetch(`${baseUrl}/context-sources/${sourceId}/children?${searchParams}`)
  return parseTemplateResponse(
    response,
    (value) => z.array(contextSourceChildSchema).parse(value),
    "Failed to list context source children",
  )
}

export async function refreshContextSource(sourceId: string): Promise<ContextSource> {
  const response = await fetch(`${baseUrl}/context-sources/${sourceId}/refresh`, { method: "POST" })
  return parseTemplateResponse(
    response,
    (value) => contextSourceSchema.parse(value),
    "Failed to refresh context source",
  )
}

export async function openContextSource(sourceId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/context-sources/${sourceId}/open`, { method: "POST" })
  if (!response.ok) throw new Error(`Failed to open context source: ${response.status}`)
}

export async function revealContextSource(sourceId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/context-sources/${sourceId}/reveal`, { method: "POST" })
  if (!response.ok) throw new Error(`Failed to reveal context source: ${response.status}`)
}

export async function openContextSourceChild(sourceId: string, path: string): Promise<void> {
  const searchParams = new URLSearchParams({ path })
  const response = await fetch(`${baseUrl}/context-sources/${sourceId}/children/open?${searchParams}`, { method: "POST" })
  if (!response.ok) throw new Error(`Failed to open context source child: ${response.status}`)
}

export async function revealContextSourceChild(sourceId: string, path: string): Promise<void> {
  const searchParams = new URLSearchParams({ path })
  const response = await fetch(`${baseUrl}/context-sources/${sourceId}/children/reveal?${searchParams}`, { method: "POST" })
  if (!response.ok) throw new Error(`Failed to reveal context source child: ${response.status}`)
}

export async function saveSourceResumeCanvas(
  documentId: string,
  docJson: Record<string, unknown>,
): Promise<SourceResumeCanvas> {
  const response = await fetch(`${baseUrl}/documents/${documentId}/source-resume-canvas`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ doc_json: docJson }),
  })
  return parseTemplateResponse(
    response,
    (value) => sourceResumeCanvasSchema.parse(value),
    "Failed to save source resume canvas",
  )
}

export async function createRevisionSource(
  documentId: string,
  source: {
    source_type: SourceDocument["source_type"]
    title: string
    raw_text?: string
    file_path?: string
    original_uri?: string
    mime_type?: string
  },
): Promise<SourceDocument> {
  const response = await fetch(`${baseUrl}/documents/${documentId}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(source),
  })
  return parseTemplateResponse(
    response,
    (value) => sourceDocumentSchema.parse(value),
    "Failed to create revision source",
  )
}

export async function createRevisionUploadedSource(
  documentId: string,
  file: File,
): Promise<SourceDocument> {
  const formData = new FormData()
  formData.append("file", file)
  const response = await fetch(`${baseUrl}/documents/${documentId}/sources/import-file`, {
    method: "POST",
    body: formData,
  })
  return parseTemplateResponse(
    response,
    (value) => sourceDocumentSchema.parse(value),
    "Failed to create revision source from file",
  )
}

export type ImportOldResumeInput = {
  title: string
  raw_text?: string
  file?: File
  target_language?: "zh-CN" | "en-US"
}

export type ImportOldResumeProgressStep =
  | "create_document"
  | "save_source"
  | "load_workspace"

export async function importOldResume(
  input: ImportOldResumeInput,
  onProgress?: (step: ImportOldResumeProgressStep) => void,
): Promise<WorkspaceView> {
  const hasRawText = typeof input.raw_text === "string" && input.raw_text.trim().length > 0
  const hasFile = input.file instanceof File
  if (hasRawText === hasFile) {
    throw new Error("Import requires exactly one source")
  }

  onProgress?.("create_document")
  const document = await createRevisionDocument({
    title: input.title,
    pack_id: "resume",
    target_language: input.target_language ?? "zh-CN",
    initial_mode: "import_old_resume",
  })
  onProgress?.("save_source")
  if (input.file) {
    await createRevisionUploadedSource(document.id, input.file)
  } else {
    await createRevisionSource(document.id, {
      source_type: "old_resume",
      title: "旧简历",
      raw_text: input.raw_text,
      mime_type: "text/plain",
    })
  }
  onProgress?.("load_workspace")
  return getRevisionWorkspaceView(document.id)
}

export async function createBlankResume(input: { title: string }): Promise<WorkspaceView> {
  const document = await createRevisionDocument({
    title: input.title,
    pack_id: "resume",
    target_language: "zh-CN",
    initial_mode: "blank",
  })
  return getRevisionWorkspaceView(document.id)
}

export async function renderRevisionDraft(
  draftId: string,
  renderProfile?: string,
): Promise<RenderProjection> {
  const response = await fetch(`${baseUrl}/drafts/${draftId}/render`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ render_profile: renderProfile }),
  })
  return parseTemplateResponse(
    response,
    (value) => renderProjectionSchema.parse(value),
    "Failed to render revision draft",
  )
}

export async function acceptRevisionDraft(draftId: string): Promise<DraftVersion> {
  const response = await fetch(`${baseUrl}/drafts/${draftId}/accept`, { method: "POST" })
  return parseTemplateResponse(
    response,
    (value) => draftVersionSchema.parse(value),
    "Failed to accept revision draft",
  )
}

export async function dismissRevisionIssue(issueId: string): Promise<RevisionIssue> {
  const response = await fetch(`${baseUrl}/issues/${issueId}/dismiss`, { method: "POST" })
  return parseTemplateResponse(
    response,
    (value) => revisionIssueSchema.parse(value),
    "Failed to dismiss revision issue",
  )
}

export async function acceptRevisionProposal(proposalId: string): Promise<RevisionProposal> {
  const response = await fetch(`${baseUrl}/proposals/${proposalId}/accept`, { method: "POST" })
  return parseTemplateResponse(
    response,
    (value) => revisionProposalSchema.parse(value),
    "Failed to accept revision proposal",
  )
}

export async function rejectRevisionProposal(proposalId: string): Promise<RevisionProposal> {
  const response = await fetch(`${baseUrl}/proposals/${proposalId}/reject`, { method: "POST" })
  return parseTemplateResponse(
    response,
    (value) => revisionProposalSchema.parse(value),
    "Failed to reject revision proposal",
  )
}

export async function confirmRevisionClaim(
  claimId: string,
  confirmation: {
    document_id: string
    confirmation_type?: "truth_confirmed" | "risk_accepted" | "source_verified"
    evidence_link_id?: string
    issue_id?: string
    note?: string
  },
): Promise<UserConfirmation> {
  const response = await fetch(`${baseUrl}/claims/${claimId}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(confirmation),
  })
  return parseTemplateResponse(
    response,
    (value) => userConfirmationSchema.parse(value),
    "Failed to confirm revision claim",
  )
}

export async function confirmEvidenceLink(evidenceLinkId: string): Promise<EvidenceLink> {
  const response = await fetch(`${baseUrl}/evidence-links/${evidenceLinkId}/confirm`, { method: "POST" })
  return parseTemplateResponse(
    response,
    (value) => evidenceLinkSchema.parse(value),
    "Failed to confirm evidence link",
  )
}

type RevisionDocumentExportFormat = "pdf" | "html"

type RevisionDocumentExportOptions = {
  printSnapshot: CanvasPrintSnapshot
}

type RevisionDocumentExportResult = {
  fileName: string
  filePath?: string
  artifactId?: string
  format: RevisionDocumentExportFormat
}

const REVISION_EXPORT_CONFIG: Record<RevisionDocumentExportFormat, {
  extension: string
  mimeType: string
  pickerDescription: string
  pickerExtensions: string[]
  pathHeader: "X-Pdf-Path" | "X-Html-Path"
}> = {
  pdf: {
    extension: "pdf",
    mimeType: "application/pdf",
    pickerDescription: "PDF",
    pickerExtensions: [".pdf"],
    pathHeader: "X-Pdf-Path",
  },
  html: {
    extension: "html",
    mimeType: "text/html",
    pickerDescription: "HTML",
    pickerExtensions: [".html", ".htm"],
    pathHeader: "X-Html-Path",
  },
}

function safeExportTitle(title: string) {
  return title.replace(/[/\\?%*:|"<>]/g, "_")
}

async function chooseRevisionExportPathInTauri(format: RevisionDocumentExportFormat, fileName: string) {
  if (format === "pdf") return choosePdfSavePathInTauri(fileName)
  return chooseHtmlSavePathInTauri(fileName)
}

export async function exportCanvasDocument(
  format: RevisionDocumentExportFormat,
  documentId: string,
  title: string,
  options: RevisionDocumentExportOptions,
): Promise<RevisionDocumentExportResult | null> {
  const config = REVISION_EXPORT_CONFIG[format]
  let fileHandle: FileSystemFileHandle | null = null
  let fileName = `resume-${safeExportTitle(title)}.${config.extension}`
  let outputPath: string | null = null

  if (isTauri()) {
    outputPath = await chooseRevisionExportPathInTauri(format, fileName)
    if (!outputPath) return null
    fileName = outputPath.split(/[/\\]/).pop() ?? fileName
  }

  const showPicker = getSaveFilePicker()
  if (!outputPath && showPicker) {
    try {
      fileHandle = await showPicker({
        suggestedName: fileName,
        types: [
          {
            description: config.pickerDescription,
            accept: { [config.mimeType]: config.pickerExtensions },
          },
        ],
      })
      fileName = fileHandle.name
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return null
      }
    }
  }

  const body: {
    output_path?: string
    print_snapshot: CanvasPrintSnapshot
  } = { print_snapshot: options.printSnapshot }
  if (outputPath) body.output_path = outputPath

  const response = await fetch(`${baseUrl}/documents/${documentId}/canvas-export/${format}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = typeof payload?.detail === "object" && payload.detail && "message" in payload.detail
      ? String(payload.detail.message)
      : `${response.status}`
    throw new Error(`Failed to export revision ${format.toUpperCase()}: ${message}`)
  }

  const filePath = decodeHeaderPath(response.headers.get(config.pathHeader))
  const artifactId = response.headers.get("X-Export-Artifact-Id") ?? undefined

  if (outputPath) {
    await response.blob()
    const savedPath = filePath ?? outputPath
    const savedName = savedPath.split(/[/\\]/).pop() ?? fileName
    return { fileName: savedName, filePath: savedPath, artifactId, format }
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

  return { fileName, filePath, artifactId, format }
}

export async function exportCanvasPdf(
  documentId: string,
  title: string,
  options: RevisionDocumentExportOptions,
): Promise<RevisionDocumentExportResult | null> {
  return exportCanvasDocument("pdf", documentId, title, options)
}

export async function exportCanvasHtml(
  documentId: string,
  title: string,
  options: RevisionDocumentExportOptions,
): Promise<RevisionDocumentExportResult | null> {
  return exportCanvasDocument("html", documentId, title, options)
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

  const showPicker = getSaveFilePicker()
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

  const showPicker = getSaveFilePicker()
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
    const details = typeof payload?.detail === "string"
      ? payload.detail
      : Array.isArray(payload?.detail)
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

export async function listTemplateStyles(): Promise<TemplateStyleConfig[]> {
  const response = await fetch(`${baseUrl}/template-styles`);
  return parseTemplateResponse(
    response,
    (value) => z.array(templateStyleConfigSchema).parse(value),
    "Failed to list template styles",
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

export async function deleteTemplateStyle(templateId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/template-styles/${templateId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Failed to delete template style: ${response.status}`);
}

