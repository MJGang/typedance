import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("agent host api", () => {
  it("starts a resume pack run through the TS agent host", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "run_1",
      capability_policy: {
        scope_ids: ["pack:resume"],
        plugin_ids: ["resume.agent"],
      },
      status: "running",
      created_at: "2026-06-16T00:00:00.000Z",
      updated_at: "2026-06-16T00:00:00.000Z",
    }))))

    const { startResumeAgentRun } = await import("./agentHost")
    const run = await startResumeAgentRun({
      action: "quality_review",
      userMessage: "运行基础质量检查",
      context: { document_id: "doc_1", base_draft_id: "draft_1" },
    })

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4327/packs/resume/runs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "quality_review",
          user_message: "运行基础质量检查",
          context: { document_id: "doc_1", base_draft_id: "draft_1" },
        }),
      },
    )
    expect(run.capability_policy.scope_ids).toEqual(["pack:resume"])
  })
})
