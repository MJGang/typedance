import { describe, expect, it } from "vitest"
import { defaultClassicA4Style } from "./data"
import { COMMON_FONTS, VUE_DOC_FONT_STACK } from "./style-engine/fonts"
import { CLASSIC_A4_PRESETS } from "./style-engine/presets"

describe("defaultClassicA4Style", () => {
  it("uses the A4 WYSIWYG classic typography preset", () => {
    const blocks = defaultClassicA4Style.blocks ?? {}

    expect(blocks).toEqual(CLASSIC_A4_PRESETS.classic)
    expect(blocks.paragraph).toMatchObject({
      fontFamily: expect.stringContaining("BlinkMacSystemFont"),
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

  it("exposes the Vue-doc inspired system font in the template style panel", () => {
    expect(COMMON_FONTS[0]).toMatchObject({
      value: VUE_DOC_FONT_STACK,
      label: { "zh-CN": "系统界面", "en-US": "System UI" },
    })
    expect(defaultClassicA4Style.blocks?.paragraph?.fontFamily).toBe(VUE_DOC_FONT_STACK)
  })
})
