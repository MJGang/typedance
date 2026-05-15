import { describe, expect, it, vi } from "vitest"
import { getTemplateSample } from "./api"

describe("template api", () => {
  it("loads a template sample", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "sample-tech-zh",
      name: { "zh-CN": "通用技术岗样张", "en-US": "General technical sample" },
      target_language: "zh-CN",
      doc_json: { type: "doc", content: [] },
      plain_text_snapshot: "",
      updated_at: "2026-05-11T00:00:00.000Z",
    }))))
    await expect(getTemplateSample("sample-tech-zh")).resolves.toMatchObject({ id: "sample-tech-zh" })
  })
})

describe("exportResumePdf", () => {
  it("calls sidecar API and triggers download", async () => {
    const blobContent = "%PDF-1.4 test pdf";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      blobContent,
      { headers: { "content-type": "application/pdf" } },
    )));

    const { exportResumePdf } = await import("./api");

    // Mock document.createElement and click to prevent actual download
    const clickMock = vi.fn();
    const createElementMock = vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      click: clickMock,
    } as unknown as HTMLAnchorElement);
    // jsdom doesn't have URL.createObjectURL, so stub it
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:test"),
      revokeObjectURL: vi.fn(),
    });

    await exportResumePdf("resume-123", "My Resume");

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/exports/pdf/resume-123",
      { method: "POST" },
    );
    expect(clickMock).toHaveBeenCalled();

    createElementMock.mockRestore();
  });
})
