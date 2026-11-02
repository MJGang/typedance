import { useId, useState } from "react"
import type { DividerStyle } from "@typedance/contracts"
import { DEFAULT_DIVIDER_STYLE } from "@typedance/resume-renderer"
import { ColorPickerPopover } from "@/components/color-picker-popover"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const STYLES = { solid: "单实线", dashed: "虚线", dotted: "点线", double: "双线" } as const

function PixelInput({ label, value, minimum = 0, onChange }: { label: string; value: string; minimum?: number; onChange: (value: string) => void }) {
  const id = useId()
  const [draft, setDraft] = useState(value.replace(/px$/, ""))
  const match = draft.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/)
  const valid = Boolean(match && Number(match[1]) >= minimum)
  const commit = () => { if (valid && match) onChange(`${Number(match[1])}px`) }
  return (
    <Field orientation="horizontal" data-invalid={!valid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={draft} inputMode="decimal" aria-invalid={!valid} className="h-8 max-w-28 text-right" onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); commit() }
      }} />
      <span className="text-xs text-muted-foreground">px</span>
    </Field>
  )
}

export function DividerStyleEditor({ value, onChange }: { value?: DividerStyle; onChange: (style: DividerStyle) => void }) {
  const style = { ...DEFAULT_DIVIDER_STYLE, ...value }
  const update = (patch: Partial<DividerStyle>) => onChange({ ...value, ...patch })
  return (
    <FieldGroup className="gap-4 p-3">
      <p className="m-0 text-xs leading-5 text-muted-foreground">在项目之间插入分割线后，统一使用以下样式。间距可输入 12 或 12px。</p>
      <Field orientation="horizontal">
        <FieldLabel>线条样式</FieldLabel>
        <Select value={style.style} onValueChange={(next: NonNullable<DividerStyle["style"]>) => update({ style: next, ...(next === "double" && Number.parseFloat(style.width) < 3 ? { width: "3px" } : {}) })}>
          <SelectTrigger aria-label="分割线样式" size="sm" className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{Object.entries(STYLES).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </Field>
      <PixelInput key={`width-${style.width}`} label="分割线粗细" value={style.width} minimum={style.style === "double" ? 3 : 0} onChange={(width) => update({ width })} />
      {style.style === "double" ? <p className="m-0 text-xs text-muted-foreground">双线粗细至少为 3px。</p> : null}
      <Field orientation="horizontal">
        <FieldLabel>分割线颜色</FieldLabel>
        <span className="ml-auto text-xs text-muted-foreground">{style.color}</span>
        <ColorPickerPopover kind="text" value={style.color} ariaLabel="分割线颜色" onChange={(color) => { if (color) update({ color }) }} />
      </Field>
      <PixelInput key={`top-${style.marginTop}`} label="上方间距" value={style.marginTop} onChange={(marginTop) => update({ marginTop })} />
      <PixelInput key={`bottom-${style.marginBottom}`} label="下方间距" value={style.marginBottom} onChange={(marginBottom) => update({ marginBottom })} />
      <div aria-label="分割线预览" className="rounded-md border border-border bg-background px-3">
        <div style={{ borderTop: `${style.width} ${style.style} ${style.color}`, marginTop: style.marginTop, marginBottom: style.marginBottom }} />
      </div>
    </FieldGroup>
  )
}
