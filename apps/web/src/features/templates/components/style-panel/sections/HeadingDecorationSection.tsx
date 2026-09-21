import { LayoutTemplate } from "lucide-react"
import type { Heading2DecorationStyle, TemplateStyleConfig } from "@typedance/contracts"
import { generateTemplateCSS } from "@typedance/resume-renderer"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { InspectorSection } from "../InspectorControls"

type Props = {
  value: Heading2DecorationStyle
  accentColor: string
  onChange: (value: Heading2DecorationStyle) => void
}

const OPTIONS: Array<{
  value: Heading2DecorationStyle
  name: string
  description: string
}> = [
  { value: "minimal-line", name: "极简底线", description: "清晰稳重的通栏底线" },
  { value: "accent-wash", name: "左线底纹", description: "左侧强调线搭配浅色底纹" },
  { value: "dot-ribbon", name: "圆点短纹", description: "圆点引导搭配紧凑短纹" },
]

function previewConfig(accentColor: string, decorationStyle: Heading2DecorationStyle): TemplateStyleConfig {
  return {
    template_id: "heading-decoration-preview",
    preset: "",
    theme: { accentColor },
    blocks: {
      heading1: {},
      heading2: {
        decorationStyle,
        fontSize: "13px",
        fontWeight: 600,
        lineHeight: 1.35,
        marginTop: "0",
        marginBottom: "0",
      },
      heading3: {},
      paragraph: {},
      bulletList: {},
      orderedList: {},
    },
    updated_at: "2026-09-21T00:00:00.000Z",
  }
}

export function HeadingDecorationSection({ value, accentColor, onChange }: Props) {
  const currentName = OPTIONS.find((option) => option.value === value)?.name
  const previewCss = OPTIONS
    .map((option) => generateTemplateCSS(previewConfig(accentColor, option.value)))
    .join("\n")

  return (
    <InspectorSection
      value="heading-decoration"
      icon={LayoutTemplate}
      title="标题款式"
      summary={currentName}
    >
      <style>{previewCss}</style>
      <RadioGroup
        value={value}
        onValueChange={(nextValue) => onChange(nextValue as Heading2DecorationStyle)}
        aria-label="标题款式"
        className="gap-2"
      >
        {OPTIONS.map((option) => {
          const id = `heading-decoration-${option.value}`
          return (
            <label
              key={option.value}
              htmlFor={id}
              data-heading-option={option.value}
              data-selected={value === option.value}
              className="grid w-full cursor-pointer grid-cols-[minmax(7rem,1fr)_minmax(6.5rem,0.9fr)_auto] items-center gap-2 rounded-md border border-border bg-background p-2 transition-colors hover:bg-muted/50 data-[selected=true]:border-primary/60 data-[selected=true]:bg-primary/5"
            >
              <span className="min-w-0 overflow-hidden rounded border border-border/60 bg-card px-2 py-2">
                <h2 className="td-resume-heading2" data-heading-style={option.value}>
                  <span className="td-heading-prefix" aria-hidden="true" />
                  <span className="td-heading-content">教育经历</span>
                  <span className="td-heading-suffix" aria-hidden="true" />
                </h2>
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium">{option.name}</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{option.description}</span>
              </span>
              <RadioGroupItem
                id={id}
                value={option.value}
                aria-label={`${option.name}：${option.description}`}
              />
            </label>
          )
        })}
      </RadioGroup>
    </InspectorSection>
  )
}
