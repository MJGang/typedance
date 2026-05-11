import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the resume workspace instead of a landing page", () => {
    render(<App />);

    expect(screen.getAllByText("TypeDance").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Resume text")).toBeInTheDocument();
    expect(screen.queryByLabelText("A4 resume preview")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /A4/i }));

    expect(screen.getByLabelText("A4 resume preview")).toBeInTheDocument();
  });

  it("opens the template library from the sidebar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "not found" }), { status: 404 })),
    )

    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: /\u6a21\u677f\u5e93|Template Library/i }))

    expect(await screen.findByRole("heading", { name: "\u6a21\u677f\u5e93" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /\u7ecf\u5178 A4|Classic A4/ })).toBeInTheDocument()
  })
});
