import { describe, expect, it } from "vitest"
import { defaultClassicA4Style } from "./data"
import {
  ARIAL_FONT_VALUE,
  COMMON_FONTS,
  MICROSOFT_YAHEI_FONT_STACK,
  MICROSOFT_YAHEI_FONT_VALUE,
  SEGOE_UI_FONT_VALUE,
  buildFontFamilyStack,
  moveFontFamilySelection,
  parseFontFamilySelection,
} from "./style-engine/fonts"
import { CLASSIC_A4_PRESETS } from "./style-engine/presets"

describe("defaultClassicA4Style", () => {
  it("uses the A4 WYSIWYG classic typography preset", () => {
    const blocks = defaultClassicA4Style.blocks ?? {}

    expect(blocks).toEqual(CLASSIC_A4_PRESETS.classic)
    expect(blocks.paragraph).toMatchObject({
      fontFamily: MICROSOFT_YAHEI_FONT_STACK,
      fontSize: "16px",
      lineHeight: 1.62,
      color: "#213547",
      marginBottom: "12px",
    })
    expect(blocks.heading1).toMatchObject({
      fontSize: "34px",
      fontWeight: 600,
      lineHeight: 1.3,
      textAlign: "left",
    })
  })

  it("exposes multi-select font options without System UI", () => {
    expect(COMMON_FONTS).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: expect.objectContaining({ "en-US": "System UI" }),
      }),
    ]))
    expect(COMMON_FONTS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        value: MICROSOFT_YAHEI_FONT_VALUE,
        label: { "zh-CN": "Microsoft YaHei", "en-US": "Microsoft YaHei" },
      }),
      expect.objectContaining({
        value: ARIAL_FONT_VALUE,
        label: { "zh-CN": "Arial", "en-US": "Arial" },
      }),
      expect.objectContaining({
        value: SEGOE_UI_FONT_VALUE,
        label: { "zh-CN": "Segoe UI", "en-US": "Segoe UI" },
      }),
    ]))
    expect(defaultClassicA4Style.blocks?.paragraph?.fontFamily).toBe(MICROSOFT_YAHEI_FONT_STACK)
  })

  it("builds, parses, and reorders font family selections", () => {
    const selected = [MICROSOFT_YAHEI_FONT_VALUE, SEGOE_UI_FONT_VALUE, ARIAL_FONT_VALUE]

    expect(buildFontFamilyStack(selected)).toBe(MICROSOFT_YAHEI_FONT_STACK)
    expect(parseFontFamilySelection(MICROSOFT_YAHEI_FONT_STACK)).toEqual(selected)
    expect(moveFontFamilySelection(selected, ARIAL_FONT_VALUE, -1)).toEqual([MICROSOFT_YAHEI_FONT_VALUE, ARIAL_FONT_VALUE, SEGOE_UI_FONT_VALUE])
    expect(moveFontFamilySelection(selected, MICROSOFT_YAHEI_FONT_VALUE, -1)).toEqual(selected)
  })
})
