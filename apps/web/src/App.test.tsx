import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders the resume workspace and loads the saved PDF preview", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          id: "resume_saved",
          title: "我的目标岗位简历",
          target_language: "zh-CN",
          template_id: "classic-a4",
          doc_json: { type: "doc", content: [] },
          plain_text_snapshot: "张三",
          preview_pdf_path: "E:/tmp/resume_saved.pdf",
          preview_pdf_url: "http://127.0.0.1:4317/previews/resume_saved.pdf",
          source_refs: [],
          accepted_edit_ids: [],
          created_at: "2026-05-08T08:00:00.000Z",
          updated_at: "2026-05-08T08:00:00.000Z",
        }),
      })),
    )

    render(<App />);

    expect(screen.getAllByText("TypeDance").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Resume text")).toBeInTheDocument();
    expect(screen.queryByLabelText("A4 resume preview")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /保存版本|Save version/i }));
    await waitFor(() => expect(screen.getByText(/Saved resume_saved/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /A4/i }));

    expect(screen.getByLabelText("A4 resume preview")).toHaveAttribute(
      "src",
      "http://127.0.0.1:4317/previews/resume_saved.pdf",
    );
  });

  it("opens the template library from the sidebar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "not found" }), { status: 404 })),
    )

    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: /模板库|Template Library/i }))

    expect(await screen.findByRole("heading", { name: "模板库" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /经典 A4|Classic A4/ })).toBeInTheDocument()
  })
});
