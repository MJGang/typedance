import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
