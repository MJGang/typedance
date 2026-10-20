export const RESUME_PACK_BASE_PATH = "/packs/resume" as const

export const resumePackPaths = {
  workspaces: `${RESUME_PACK_BASE_PATH}/workspaces`,
  workspace: (documentId: string) => `${RESUME_PACK_BASE_PATH}/workspaces/${documentId}`,
  templates: `${RESUME_PACK_BASE_PATH}/templates`,
  template: (templateId: string) => `${RESUME_PACK_BASE_PATH}/templates/${encodeURIComponent(templateId)}`,
} as const
