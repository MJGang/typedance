import { Palette } from "lucide-react"

import { ColorPickerPopover } from "@/components/color-picker-popover"

type Props = {
  value: string
  onChange: (accentColor: string) => void
}

export function ThemeAccentColorControl({ value, onChange }: Props) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border/70 bg-background px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <Palette className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">主题强调色</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="size-5 shrink-0 rounded-md border border-border" style={{ backgroundColor: value }} aria-hidden="true" />
        <span className="max-w-20 truncate font-mono text-xs text-muted-foreground">{value}</span>
        <ColorPickerPopover
          kind="text"
          value={value}
          ariaLabel="主题强调色"
          onChange={(color) => {
            if (color && /^#[0-9A-Fa-f]{6}$/.test(color)) onChange(color)
          }}
        />
      </div>
    </div>
  )
}
