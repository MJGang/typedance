import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const PRESET_COLORS = [
  "#000000", "#1a1a1a", "#334155", "#475569", "#64748b",
  "#0f172a", "#1e293b", "#1e3a8a", "#174ea6", "#2563eb",
  "#ffffff", "#f8fafc", "#f1f5f9", "#e2e8f0", "#cbd5e1",
];

type ColorPickerProps = {
  value?: string;
  onChange: (value: string) => void;
  label: string;
};

export function ColorPicker({ value = "#000000", onChange, label }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const isValidHex = /^#[0-9a-fA-F]{6}$/.test(value);

  return (
    <div className="flex items-center gap-2">
      <label className="flex-1 text-xs text-muted-foreground">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-6 w-6 rounded border border-border ring-offset-background transition-colors hover:ring-2 hover:ring-ring hover:ring-offset-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            style={{ backgroundColor: isValidHex ? value : "#000000" }}
            aria-label={`当前颜色 ${value}`}
          />
        </PopoverTrigger>
        <PopoverContent className="w-56" align="end">
          <div className="grid grid-cols-5 gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="h-7 w-7 rounded border border-border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ backgroundColor: c, outline: c === value ? "2px solid hsl(var(--primary))" : undefined, outlineOffset: "1px" }}
                onClick={() => { onChange(c); setOpen(false); }}
                aria-label={c}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-2">
            <span className="font-mono text-xs text-muted-foreground">#</span>
            <Input
              value={value.replace("#", "")}
              className="h-7 font-mono text-xs"
              onChange={(e) => onChange(`#${e.target.value}`)}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
