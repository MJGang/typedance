import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the resume workspace instead of a landing page", () => {
    render(<App />);

    expect(screen.getByText("TypeDance")).toBeInTheDocument();
    expect(screen.getByLabelText("Resume text")).toBeInTheDocument();
    expect(screen.getByLabelText("A4 resume preview")).toBeInTheDocument();
  });
});
