import { useId, useState } from "react"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function PixelInput({ label, value, minimum = 0, onChange }: { label: string; value: string; minimum?: number; onChange: (value: string) => void }) {
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
