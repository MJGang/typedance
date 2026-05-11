import { describe, expect, it } from "vitest"
import type { PdfClassPolicy } from "@typedance/contracts"
import { splitClasses, validateTemplateClasses } from "./classPolicy"

const policy: PdfClassPolicy = {
  allowlist: ["bg-white", "text-slate-900", "font-sans", "border-b-2"],
  blocklist: ["fixed", "animate-spin"],
  groups: {
    spacing: {
      label: { "zh-CN": "间距", "en-US": "Spacing" },
      allowlist: ["pb-3", "mb-4"],
    },
  },
  updated_at: "2026-05-11T00:00:00.000Z",
}

describe("splitClasses", () => {
  it("removes duplicate whitespace and empty class fragments", () => {
    expect(splitClasses(" bg-white   pb-3\nfont-sans ")).toEqual([
      "bg-white",
      "pb-3",
      "font-sans",
    ])
  })
})

describe("validateTemplateClasses", () => {
  it("accepts allowlisted classes from root and groups", () => {
    expect(validateTemplateClasses("bg-white pb-3", policy)).toEqual([])
  })

  it("blocks blacklisted classes before allowlist checks", () => {
    expect(validateTemplateClasses("bg-white fixed", policy)).toEqual([
      { className: "fixed", reason: "blocked" },
    ])
  })

  it("marks unknown classes as not allowed", () => {
    expect(validateTemplateClasses("shadow-xl", policy)).toEqual([
      { className: "shadow-xl", reason: "not_allowed" },
    ])
  })
})
