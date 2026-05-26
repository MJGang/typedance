import { z } from "zod";
import {
  documentListItemSchema,
  documentSchema,
  draftVersionSchema,
  evidenceLinkSchema,
  exportArtifactSchema,
  modelSettingsResponseSchema,
  modelSettingsTestResponseSchema,
  modelSettingsUpdateSchema,
  renderProjectionSchema,
  resumeVersionSchema,
  revisionIssueSchema,
  revisionProposalSchema,
  revisionRunSchema,
  sourceDocumentSchema,
  templateSampleContentSchema,
  templateStyleConfigSchema,
  userConfirmationSchema,
  workspaceViewSchema,
  type DocumentListItem,
  type Document as RevisionDocument,
  type DraftVersion,
  type EvidenceLink,
  type ExportArtifact,
  type ModelSettingsResponse,
  type ModelSettingsTestResponse,
  type ModelSettingsUpdate,
  type RenderProjection,
  type ResumeVersion,
  type RevisionIssue,
  type RevisionProposal,
  type RevisionRun,
  type SourceDocument,
  type TemplateSampleContent,
  type TemplateStyleConfig,
  type UserConfirmation,
  type WorkspaceView,
} from "@typedance/contracts";
import { chooseHtmlSavePathInTauri, choosePdfSavePathInTauri, isTauri } from "./tauri";
const baseUrl = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:4317";

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

export type CreateRevisionDocumentInput = {
  title: string
  pack_id?: string
  target_language?: "zh-CN" | "en-US"
  initial_mode?: "import_old_resume" | "blank_guided" | "base_resume" | "opportunity_variant"
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

export async function getRevisionWorkspaceView(documentId: string): Promise<WorkspaceView> {
  const response = await fetch(`${baseUrl}/documents/${documentId}/workspace-view`)
  return parseTemplateResponse(
    response,
    (value) => workspaceViewSchema.parse(value),
    "Failed to load revision workspace",
  )
}

export async function projectLegacyResumeToRevisionWorkspace(resumeId: string): Promise<WorkspaceView> {
  const response = await fetch(`${baseUrl}/legacy/resume-versions/${resumeId}/revision-document`, {
    method: "POST",
  })
  return parseTemplateResponse(
    response,
    (value) => workspaceViewSchema.parse(value),
    "Failed to project legacy resume",
  )
}

export async function getModelSettings(): Promise<ModelSettingsResponse> {
  const response = await fetch(`${baseUrl}/settings/model`)
  return parseTemplateResponse(
    response,
    (value) => modelSettingsResponseSchema.parse(value),
    "Failed to load model settings",
  )
}

export async function saveModelSettings(input: ModelSettingsUpdate): Promise<ModelSettingsResponse> {
  const payload = modelSettingsUpdateSchema.parse(input)
  const response = await fetch(`${baseUrl}/settings/model`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseTemplateResponse(
    response,
    (value) => modelSettingsResponseSchema.parse(value),
    "Failed to save model settings",
  )
}

export async function testModelSettings(): Promise<ModelSettingsTestResponse> {
  const response = await fetch(`${baseUrl}/settings/model/test`, { method: "POST" })
  return parseTemplateResponse(
    response,
    (value) => modelSettingsTestResponseSchema.parse(value),
    "Failed to test model settings",
  )
}

export async function clearModelApiKey(): Promise<ModelSettingsResponse> {
  const response = await fetch(`${baseUrl}/settings/model/api-key`, { method: "DELETE" })
  return parseTemplateResponse(
    response,
    (value) => modelSettingsResponseSchema.parse(value),
    "Failed to clear model API key",
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

export async function createRevisionRun(
  documentId: string,
  run: {
    run_type: RevisionRun["run_type"]
    source_document_ids?: string[]
    base_draft_id?: string
    user_intent?: string
    selected_module_id?: string
    selected_issue_id?: string
    selected_action_id?: string
  },
): Promise<RevisionRun> {
  const response = await fetch(`${baseUrl}/documents/${documentId}/revision-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(run),
  })
  return parseTemplateResponse(
    response,
    (value) => revisionRunSchema.parse(value),
    "Failed to create revision run",
  )
}

export type ImportOldResumeInput = {
  title: string
  raw_text: string
  target_language?: "zh-CN" | "en-US"
}

export async function importOldResume(input: ImportOldResumeInput): Promise<WorkspaceView> {
  const document = await createRevisionDocument({
    title: input.title,
    pack_id: "resume",
    target_language: input.target_language ?? "zh-CN",
    initial_mode: "import_old_resume",
  })
  const source = await createRevisionSource(document.id, {
    source_type: "old_resume",
    title: "旧简历",
    raw_text: input.raw_text,
    mime_type: "text/plain",
  })
  await createRevisionRun(document.id, {
    run_type: "import_reconstruct",
    source_document_ids: [source.id],
    user_intent: "导入旧简历并生成可审阅草稿",
  })
  return getRevisionWorkspaceView(document.id)
}

export type StartBlankGuidedResumeInput = {
  title: string
  identity_status?: string
  name?: string
  phone?: string
  email?: string
  target_role?: string
  skills?: string
  work_experience?: string
  project_experience?: string
}

export async function startBlankGuidedResume(input: StartBlankGuidedResumeInput): Promise<WorkspaceView> {
  const document = await createRevisionDocument({
    title: input.title,
    pack_id: "resume",
    target_language: "zh-CN",
    initial_mode: "blank_guided",
  })
  const rawText = [
    ["身份状态", input.identity_status],
    ["姓名", input.name],
    ["电话", input.phone],
    ["邮箱", input.email],
    ["目标方向", input.target_role],
    ["技能", input.skills],
    ["工作经历", input.work_experience],
    ["项目经历", input.project_experience],
  ]
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n")
  const source = await createRevisionSource(document.id, {
    source_type: "manual_user_input",
    title: "空白引导信息",
    raw_text: rawText,
    mime_type: "text/plain",
  })
  await createRevisionRun(document.id, {
    run_type: "blank_guided_generate",
    source_document_ids: [source.id],
    user_intent: "从空白引导生成基础简历",
  })
  return getRevisionWorkspaceView(document.id)
}

export async function runRevisionQualityReview(
  documentId: string,
  baseDraftId?: string,
): Promise<RevisionRun> {
  return createRevisionRun(documentId, {
    run_type: "quality_review",
    base_draft_id: baseDraftId,
    user_intent: "运行基础质量检查",
  })
}

export type CalibrateRevisionOpportunityInput = {
  title: string
  raw_text: string
}

export async function calibrateRevisionOpportunity(
  documentId: string,
  baseDraftId: string,
  input: CalibrateRevisionOpportunityInput,
): Promise<WorkspaceView> {
  const source = await createRevisionSource(documentId, {
    source_type: "external_context",
    title: input.title,
    raw_text: input.raw_text,
    mime_type: "text/plain",
  })
  await createRevisionRun(documentId, {
    run_type: "opportunity_calibrate",
    source_document_ids: [source.id],
    base_draft_id: baseDraftId,
    user_intent: "生成岗位校准版本",
  })
  return getRevisionWorkspaceView(documentId)
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

export async function exportRevisionDraftPdf(
  draftId: string,
  title: string,
  options: { forceWithRisk?: boolean } = {},
): Promise<{ fileName: string; filePath?: string; artifactId?: string; reviewStatus?: ExportArtifact["review_status"] } | null> {
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
      if (err instanceof DOMException && err.name === "AbortError") {
        return null
      }
    }
  }

  const body: { output_path?: string; force_with_risk?: boolean } = {
    force_with_risk: options.forceWithRisk ?? false,
  }
  if (outputPath) body.output_path = outputPath

  const response = await fetch(`${baseUrl}/drafts/${draftId}/export/pdf`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = typeof payload?.detail === "object" && payload.detail && "message" in payload.detail
      ? String(payload.detail.message)
      : `${response.status}`
    throw new Error(`Failed to export revision PDF: ${message}`)
  }

  const filePath = decodeHeaderPath(response.headers.get("X-Pdf-Path"))
  const artifactId = response.headers.get("X-Export-Artifact-Id") ?? undefined
  const rawReviewStatus = response.headers.get("X-Export-Review-Status")
  const reviewStatus = rawReviewStatus
    ? exportArtifactSchema.shape.review_status.parse(rawReviewStatus)
    : undefined

  if (outputPath) {
    await response.blob()
    const savedPath = filePath ?? outputPath
    const savedName = savedPath.split(/[/\\]/).pop() ?? fileName
    return { fileName: savedName, filePath: savedPath, artifactId, reviewStatus }
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

  return { fileName, filePath, artifactId, reviewStatus }
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

