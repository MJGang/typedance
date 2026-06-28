import { Paintbrush } from "lucide-react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ThemeSelectorOption = {
  id: string;
  title: string;
  source: "default" | "custom";
};

type ThemeSelectorProps = {
  value: string;
  options: ThemeSelectorOption[];
  onChange: (themeId: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
};

function ThemeOptionGroup({
  label,
  options,
}: {
  label: string;
  options: ThemeSelectorOption[];
}) {
  if (options.length === 0) return null;

  return (
    <SelectGroup>
      <SelectLabel>{label}</SelectLabel>
      {options.map((theme) => (
        <SelectItem key={theme.id} value={theme.id} className="text-xs">
          {theme.title}
        </SelectItem>
      ))}
    </SelectGroup>
  );
}

export function ThemeSelector({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel = "选择主题",
}: ThemeSelectorProps) {
  const customThemes = options.filter((theme) => theme.source === "custom");
  const defaultThemes = options.filter((theme) => theme.source === "default");

  return (
    <div className="flex items-center gap-2">
      <Paintbrush className="size-3.5 text-muted-foreground shrink-0" />
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger size="sm" className="w-40 justify-between text-xs" aria-label={ariaLabel}>
          <SelectValue placeholder="选择主题" />
        </SelectTrigger>
        <SelectContent className="min-w-48">
          <ThemeOptionGroup label="我的主题" options={customThemes} />
          <ThemeOptionGroup label="官方主题" options={defaultThemes} />
        </SelectContent>
      </Select>
    </div>
  );
}
