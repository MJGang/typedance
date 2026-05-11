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
    <div className="td-color-picker">
      <label className="text-sm">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="td-color-swatch"
            style={{ backgroundColor: isValidHex ? value : "#000000" }}
            aria-label={`当前颜色 ${value}`}
          />
        </PopoverTrigger>
        <PopoverContent className="w-56">
          <div className="grid grid-cols-5 gap-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="td-color-swatch-option"
                style={{ backgroundColor: c, border: c === value ? "2px solid #000" : "1px solid #ddd" }}
                onClick={() => { onChange(c); setOpen(false); }}
                aria-label={c}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs">Hex</span>
            <Input
              value={value}
              className="h-7 font-mono text-xs"
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
