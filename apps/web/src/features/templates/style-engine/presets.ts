import type { BlockStyle, BlockType } from "./types";
import { MICROSOFT_YAHEI_FONT_STACK } from "./fonts";

export type StylePreset = Record<BlockType, BlockStyle>;

export const CLASSIC_A4_PRESETS: Record<string, StylePreset> = {
  classic: {
    heading1: { fontFamily: MICROSOFT_YAHEI_FONT_STACK, fontSize: "34px", fontWeight: 600, lineHeight: 1.3, color: "#213547", textAlign: "left", marginBottom: "28px" },
    heading2: { fontFamily: MICROSOFT_YAHEI_FONT_STACK, fontSize: "24px", fontWeight: 600, lineHeight: 1.5, color: "#213547", marginTop: "30px", marginBottom: "14px" },
    heading3: { fontFamily: MICROSOFT_YAHEI_FONT_STACK, fontSize: "19px", fontWeight: 600, lineHeight: 1.5, color: "#213547", marginTop: "22px", marginBottom: "10px" },
    paragraph: { fontFamily: MICROSOFT_YAHEI_FONT_STACK, fontSize: "16px", lineHeight: 1.62, color: "#213547", marginBottom: "12px" },
    bulletList: { fontFamily: MICROSOFT_YAHEI_FONT_STACK, fontSize: "16px", lineHeight: 1.62, color: "#213547", listStyleType: "disc", paddingLeft: "24px", marginTop: "6px", marginBottom: "12px" },
    orderedList: { fontFamily: MICROSOFT_YAHEI_FONT_STACK, fontSize: "16px", lineHeight: 1.62, color: "#213547", listStyleType: "decimal", paddingLeft: "24px", marginTop: "6px", marginBottom: "12px" },
  },
  modern: {
    heading1: { fontSize: "26px", fontWeight: 600, color: "#0f172a", textAlign: "center", marginBottom: "10px", letterSpacing: "1px" },
    heading2: { fontSize: "13px", fontWeight: 600, color: "#475569", marginBottom: "6px" },
    heading3: { fontSize: "11px", fontWeight: 500, color: "#1e293b", marginBottom: "3px" },
    paragraph: { fontSize: "10px", lineHeight: 1.6, color: "#475569", marginBottom: "3px" },
    bulletList: { listStyleType: "disc", paddingLeft: "18px" },
    orderedList: { listStyleType: "decimal", paddingLeft: "18px" },
  },
  clean: {
    heading1: { fontSize: "22px", fontWeight: 700, color: "#0a0a0a", textAlign: "center", marginBottom: "12px" },
    heading2: { fontSize: "12px", fontWeight: 700, color: "#0a0a0a", marginBottom: "8px", letterSpacing: "0.5px" },
    heading3: { fontSize: "10.5px", fontWeight: 600, color: "#171717", marginBottom: "4px" },
    paragraph: { fontSize: "10px", lineHeight: 1.7, color: "#525252", marginBottom: "3px" },
    bulletList: { listStyleType: "circle", paddingLeft: "18px" },
    orderedList: { listStyleType: "decimal", paddingLeft: "18px" },
  },
};

export function getPresetNames(): string[] {
  return Object.keys(CLASSIC_A4_PRESETS);
}

export function getPreset(name: string): StylePreset | undefined {
  return CLASSIC_A4_PRESETS[name];
}

export function defaultBlockStyle(): BlockStyle {
  return {};
}
