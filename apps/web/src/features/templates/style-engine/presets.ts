import type { BlockStyle, BlockType } from "./types";

export type StylePreset = Record<BlockType, BlockStyle>;

export const CLASSIC_A4_PRESETS: Record<string, StylePreset> = {
  classic: {
    heading1: { fontSize: "24pt", fontWeight: 700, color: "#1a1a1a", textAlign: "center", marginBottom: "8pt", fontFamily: "Georgia, serif" },
    heading2: { fontSize: "14pt", fontWeight: 600, color: "#1e3a8a", marginBottom: "8pt", borderBottom: { style: "solid", width: "1.5pt", color: "#1e3a8a" } },
    heading3: { fontSize: "11pt", fontWeight: 600, color: "#1f2937", marginBottom: "4pt" },
    paragraph: { fontSize: "10pt", lineHeight: 1.5, color: "#334155", marginBottom: "4pt" },
    bulletList: { fontSize: "10pt", lineHeight: 1.4, color: "#334155", listStyleType: "disc", paddingLeft: "20pt" },
    orderedList: { fontSize: "10pt", lineHeight: 1.4, color: "#334155", listStyleType: "decimal", paddingLeft: "20pt" },
  },
  modern: {
    heading1: { fontSize: "26pt", fontWeight: 600, color: "#0f172a", textAlign: "center", marginBottom: "10pt", letterSpacing: "1pt" },
    heading2: { fontSize: "13pt", fontWeight: 600, color: "#475569", marginBottom: "6pt" },
    heading3: { fontSize: "11pt", fontWeight: 500, color: "#1e293b", marginBottom: "3pt" },
    paragraph: { fontSize: "10pt", lineHeight: 1.6, color: "#475569", marginBottom: "3pt" },
    bulletList: { fontSize: "10pt", lineHeight: 1.5, color: "#475569", listStyleType: "disc", paddingLeft: "18pt" },
    orderedList: { fontSize: "10pt", lineHeight: 1.5, color: "#475569", listStyleType: "decimal", paddingLeft: "18pt" },
  },
  clean: {
    heading1: { fontSize: "22pt", fontWeight: 700, color: "#0a0a0a", textAlign: "center", marginBottom: "12pt" },
    heading2: { fontSize: "12pt", fontWeight: 700, color: "#0a0a0a", marginBottom: "8pt", letterSpacing: "0.5pt" },
    heading3: { fontSize: "10.5pt", fontWeight: 600, color: "#171717", marginBottom: "4pt" },
    paragraph: { fontSize: "10pt", lineHeight: 1.7, color: "#525252", marginBottom: "3pt" },
    bulletList: { fontSize: "10pt", lineHeight: 1.6, color: "#525252", listStyleType: "circle", paddingLeft: "18pt" },
    orderedList: { fontSize: "10pt", lineHeight: 1.6, color: "#525252", listStyleType: "decimal", paddingLeft: "18pt" },
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
