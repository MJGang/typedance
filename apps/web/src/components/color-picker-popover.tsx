import { useState } from "react"
import type { ComponentType, CSSProperties, SVGProps } from "react"
import { Baseline, Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export const DEFAULT_TEXT_COLOR = "#262626"

const SOLID_COLOR_ROWS = [
  ["#000000", "#262626", "#595959", "#8c8c8c", "#bfbfbf", "#d9d9d9", "#e8e8e8", "#f0f0f0", "#f5f5f5", "#ffffff"],
  ["#f5222d", "#fa541c", "#fadb14", "#d4b106", "#52c41a", "#13c2c2", "#1677ff", "#2f54eb", "#722ed1", "#c41d7f"],
  ["#ffccc7", "#ffd8bf", "#fff1b8", "#ffffb8", "#d9f7be", "#b5f5ec", "#bae0ff", "#d6e4ff", "#efdbff", "#ffd6e7"],
  ["#ffa39e", "#ffbb96", "#ffe58f", "#fffb8f", "#b7eb8f", "#87e8de", "#91caff", "#adc6ff", "#d3adf7", "#ffadd2"],
  ["#ff4d4f", "#ff7a45", "#ffc53d", "#ffec3d", "#73d13d", "#36cfc9", "#4096ff", "#597ef7", "#9254de", "#f759ab"],
  ["#cf1322", "#d4380d", "#d48806", "#d4b106", "#389e0d", "#08979c", "#0958d9", "#1d39c4", "#531dab", "#9e1068"],
  ["#820014", "#871400", "#874d00", "#614700", "#135200", "#00474f", "#002c8c", "#061178", "#22075e", "#780650"],
]

const GRADIENT_COLORS = [
  { value: "#13c2c2", gradient: "linear-gradient(135deg, #13c2c2, #1677ff)" },
  { value: "#722ed1", gradient: "linear-gradient(135deg, #1677ff, #722ed1)" },
  { value: "#f759ab", gradient: "linear-gradient(135deg, #f5222d, #f759ab)" },
  { value: "#fa541c", gradient: "linear-gradient(135deg, #fadb14, #fa541c)" },
  { value: "#cf1322", gradient: "linear-gradient(135deg, #f5222d, #820014)" },
]

type ColorPickerKind = "text" | "background"
type ColorIcon = ComponentType<SVGProps<SVGSVGElement>>

type ColorPickerPopoverProps = {
  kind: ColorPickerKind
  value?: string | null
  disabled?: boolean
  icon?: ColorIcon
  ariaLabel?: string
  onChange: (value: string | null) => void
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
}

function BackgroundColorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20h16" className="td-color-picker-icon-indicator" />
      <path d="m14.5 4.5 5 5" />
      <path d="m13 6 5 5-8.5 8.5H4.5V14.5L13 6Z" />
      <path d="m7 17 1.5 1.5" />
    </svg>
  )
}

export function ColorPickerPopover({
  kind,
  value,
  disabled = false,
  icon,
  ariaLabel,
  onChange,
}: ColorPickerPopoverProps) {
  const [open, setOpen] = useState(false)
  const [recentColors, setRecentColors] = useState<string[]>([])
  const safeValue = isHexColor(value) ? value : kind === "text" ? DEFAULT_TEXT_COLOR : null
  const Icon = icon ?? (kind === "text" ? Baseline : BackgroundColorIcon)
  const showsGradients = kind === "text"
  const label = ariaLabel ?? (kind === "text" ? "文字颜色" : "背景颜色")
  const triggerStyle = {
    "--td-color-picker-indicator": safeValue ?? "currentColor",
  } as CSSProperties

  const selectColor = (color: string) => {
    onChange(color)
    setRecentColors((current) => [color, ...current.filter((item) => item !== color)].slice(0, 8))
    setOpen(false)
  }

  const clearColor = () => {
    if (kind === "text") {
      selectColor(DEFAULT_TEXT_COLOR)
      return
    }
    onChange(null)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={label}
              disabled={disabled}
              className="td-color-picker-trigger"
              data-kind={kind}
              style={triggerStyle}
            >
              <Icon className="td-color-picker-icon" />
              <span className="td-toolbar-triangle" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="td-color-picker-content">
        <button type="button" className="td-color-picker-default" onClick={clearColor}>
          {kind === "background" ? (
            <span className="td-color-picker-no-fill-swatch" />
          ) : (
            <span className="td-color-picker-default-swatch" style={{ backgroundColor: DEFAULT_TEXT_COLOR }} />
          )}
          <span>{kind === "background" ? "无填充色" : "默认"}</span>
        </button>

        <div className="td-color-picker-grid" aria-label="常用颜色">
          {SOLID_COLOR_ROWS.flat().map((color) => (
            <button
              key={color}
              type="button"
              className="td-color-picker-swatch"
              aria-label={color}
              data-selected={safeValue?.toLowerCase() === color.toLowerCase()}
              style={{ backgroundColor: color }}
              onClick={() => selectColor(color)}
            >
              {safeValue?.toLowerCase() === color.toLowerCase() ? <Check className="size-3.5" /> : null}
            </button>
          ))}
        </div>

        {showsGradients ? (
          <>
            <div className="td-color-picker-section-label">渐变色</div>
            <div className="td-color-picker-gradient-row">
              {GRADIENT_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className="td-color-picker-gradient-swatch"
                  aria-label={color.value}
                  style={{ background: color.gradient }}
                  onClick={() => selectColor(color.value)}
                />
              ))}
            </div>
          </>
        ) : null}

        <div className="td-color-picker-section-label">最近使用自定义颜色</div>
        {recentColors.length > 0 ? (
          <div className="td-color-picker-recent-row">
            {recentColors.map((color) => (
              <button
                key={color}
                type="button"
                className="td-color-picker-swatch"
                aria-label={color}
                data-selected={safeValue?.toLowerCase() === color.toLowerCase()}
                style={{ backgroundColor: color }}
                onClick={() => selectColor(color)}
              >
                {safeValue?.toLowerCase() === color.toLowerCase() ? <Check className="size-3.5" /> : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="td-color-picker-empty-recent">暂无</div>
        )}

        <label className="td-color-picker-more-color">
          <span className="td-color-picker-rainbow-dot" />
          <span>更多颜色</span>
          <span className="td-color-picker-more-arrow" aria-hidden="true" />
          <Input
            type="color"
            className="sr-only"
            value={safeValue ?? DEFAULT_TEXT_COLOR}
            onChange={(event) => selectColor(event.target.value)}
          />
        </label>
      </PopoverContent>
    </Popover>
  )
}
