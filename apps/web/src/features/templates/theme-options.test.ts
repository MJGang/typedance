import { describe, expect, it } from "vitest"
import type { TemplateStyleConfig } from "./types"
import { defaultClassicA4Style } from "./data"
import { buildTemplateThemes } from "./theme-options"

const savedClassic: TemplateStyleConfig = {
  ...defaultClassicA4Style,
  name: "经典 A4 已保存",
  blocks: { ...defaultClassicA4Style.blocks },
  updated_at: "2026-06-28T00:00:00.000Z",
}

const customTheme: TemplateStyleConfig = {
  ...defaultClassicA4Style,
  template_id: "custom-theme-1",
  name: "我的主题",
  preset: "",
  blocks: { ...defaultClassicA4Style.blocks },
  updated_at: "2026-06-28T01:00:00.000Z",
}

describe("buildTemplateThemes", () => {
  it("merges saved custom and official styles into one ordered option list", () => {
    const themes = buildTemplateThemes([savedClassic, customTheme], "zh-CN")

    expect(themes.map(({ id, source }) => ({ id, source }))).toEqual([
      { id: "custom-theme-1", source: "custom" },
      { id: "classic-a4", source: "default" },
    ])
    expect(themes.find((theme) => theme.id === "classic-a4")?.styleConfig).toBe(savedClassic)
  })

  it("uses the built-in classic style only for the configured official template", () => {
    const themes = buildTemplateThemes([], "zh-CN")

    expect(themes).toHaveLength(1)
    expect(themes[0]).toMatchObject({
      id: "classic-a4",
      title: "经典 A4",
      source: "default",
      styleConfig: defaultClassicA4Style,
    })
    expect(themes.some((theme) => theme.source === "custom")).toBe(false)
  })
})
