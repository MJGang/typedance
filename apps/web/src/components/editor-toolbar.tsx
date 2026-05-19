import type { ComponentType, ReactNode, SVGProps } from "react"
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Check,
  IndentDecrease,
  IndentIncrease,
  List,
  ListCollapse,
  ListOrdered,
  Minus,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type ToolbarIcon = ComponentType<SVGProps<SVGSVGElement>>

export type ToolbarAlignment = "left" | "center" | "right" | "justify"
export type ToolbarOrderedListStyle = "decimal" | "lower-alpha" | "decimal-nested"
export type ToolbarBulletListStyle = "disc" | "circle" | "dash"
export type ToolbarLineHeight = "default" | "1" | "1.15" | "1.5" | "2" | "2.5" | "3"

type ToolbarIconButtonProps = {
  label: string
  icon: ToolbarIcon
  isActive?: boolean
  disabled?: boolean
  onClick: () => void
  className?: string
}

type ToolbarDropdownProps = {
  label: string
  icon: ToolbarIcon
  disabled?: boolean
  isActive?: boolean
  contentClassName?: string
  children: ReactNode
}

const ALIGNMENT_OPTIONS: Array<{ value: ToolbarAlignment; label: string; icon: ToolbarIcon }> = [
  { value: "left", label: "左对齐", icon: AlignLeft },
  { value: "center", label: "居中对齐", icon: AlignCenter },
  { value: "right", label: "右对齐", icon: AlignRight },
  { value: "justify", label: "两端对齐", icon: AlignJustify },
]

const ORDERED_LIST_OPTIONS: Array<{ value: ToolbarOrderedListStyle; label: string; samples: string[] }> = [
  { value: "decimal", label: "数字编号", samples: ["1.", "2."] },
  { value: "lower-alpha", label: "小写字母", samples: ["a.", "b."] },
  { value: "decimal-nested", label: "多级编号", samples: ["1.", "1.1"] },
]

const BULLET_LIST_OPTIONS: Array<{ value: ToolbarBulletListStyle; label: string; marker: string }> = [
  { value: "disc", label: "实心圆", marker: "•" },
  { value: "circle", label: "空心圆", marker: "○" },
  { value: "dash", label: "短横线", marker: "-" },
]

const LINE_HEIGHT_OPTIONS: Array<{ value: ToolbarLineHeight; label: string }> = [
  { value: "default", label: "默认" },
  { value: "1", label: "1" },
  { value: "1.15", label: "1.15" },
  { value: "1.5", label: "1.5" },
  { value: "2", label: "2" },
  { value: "2.5", label: "2.5" },
  { value: "3", label: "3" },
]

export function ToolbarIconButton({
  label,
  icon: Icon,
  isActive = false,
  disabled = false,
  onClick,
  className,
}: ToolbarIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          data-active={isActive || undefined}
          disabled={disabled}
          className={cn("td-editor-toolbar-button", className)}
          onClick={onClick}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function ToolbarDropdown({
  label,
  icon: Icon,
  disabled = false,
  isActive = false,
  contentClassName,
  children,
}: ToolbarDropdownProps) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={label}
              data-active={isActive || undefined}
              disabled={disabled}
              className="td-editor-toolbar-button td-editor-toolbar-dropdown-trigger"
            >
              <Icon />
              <span className="td-toolbar-triangle" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className={cn("td-editor-toolbar-menu", contentClassName)}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ToolbarGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("td-editor-toolbar-group", className)}>{children}</div>
}

export function ToolbarVerticalSeparator() {
  return (
    <span role="separator" aria-orientation="vertical" className="td-editor-toolbar-separator">
      |
    </span>
  )
}

export function AlignmentToolbarButton({
  value,
  disabled,
  onChange,
}: {
  value: ToolbarAlignment
  disabled?: boolean
  onChange: (value: ToolbarAlignment) => void
}) {
  const current = ALIGNMENT_OPTIONS.find((option) => option.value === value) ?? ALIGNMENT_OPTIONS[0]

  return (
    <ToolbarDropdown label="对齐方式" icon={current.icon} disabled={disabled} contentClassName="td-alignment-menu">
      <div className="td-alignment-menu-grid">
        {ALIGNMENT_OPTIONS.map((option) => {
          const Icon = option.icon
          return (
            <button
              key={option.value}
              type="button"
              aria-label={option.label}
              className="td-alignment-menu-button"
              data-selected={option.value === value || undefined}
              onClick={() => onChange(option.value)}
            >
              <Icon />
            </button>
          )
        })}
      </div>
    </ToolbarDropdown>
  )
}

export function OrderedListToolbarButton({
  value,
  disabled,
  isActive,
  onChange,
}: {
  value: ToolbarOrderedListStyle
  disabled?: boolean
  isActive?: boolean
  onChange: (value: ToolbarOrderedListStyle) => void
}) {
  return (
    <ToolbarDropdown
      label="有序列表"
      icon={ListOrdered}
      disabled={disabled}
      isActive={isActive}
      contentClassName="td-list-style-menu td-ordered-list-style-menu"
    >
      <div className="td-list-style-grid">
        {ORDERED_LIST_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            className="td-list-style-card"
            data-selected={option.value === value || undefined}
            onClick={() => onChange(option.value)}
          >
            {option.samples.map((sample) => (
              <span key={sample} className="td-list-style-preview-row">
                <span>{sample}</span>
                <i />
              </span>
            ))}
          </button>
        ))}
      </div>
    </ToolbarDropdown>
  )
}

export function BulletListToolbarButton({
  value,
  disabled,
  isActive,
  onChange,
}: {
  value: ToolbarBulletListStyle
  disabled?: boolean
  isActive?: boolean
  onChange: (value: ToolbarBulletListStyle) => void
}) {
  return (
    <ToolbarDropdown
      label="无序列表"
      icon={List}
      disabled={disabled}
      isActive={isActive}
      contentClassName="td-list-style-menu"
    >
      <div className="td-list-style-grid">
        {BULLET_LIST_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            className="td-list-style-card td-bullet-list-style-card"
            data-selected={option.value === value || undefined}
            onClick={() => onChange(option.value)}
          >
            {[0, 1, 2].map((row) => (
              <span key={row} className="td-list-style-preview-row">
                <span>{option.marker}</span>
                <i />
              </span>
            ))}
          </button>
        ))}
      </div>
    </ToolbarDropdown>
  )
}

export function IndentToolbarButton({
  disabled,
  onIncrease,
  onDecrease,
}: {
  disabled?: boolean
  onIncrease: () => void
  onDecrease: () => void
}) {
  return (
    <ToolbarDropdown label="缩进调整" icon={IndentIncrease} disabled={disabled} contentClassName="td-indent-menu">
      <DropdownMenuItem className="td-editor-toolbar-menu-item" onSelect={onIncrease}>
        <IndentIncrease />
        <span>增加缩进</span>
      </DropdownMenuItem>
      <DropdownMenuItem className="td-editor-toolbar-menu-item" onSelect={onDecrease}>
        <IndentDecrease />
        <span>减少缩进</span>
      </DropdownMenuItem>
    </ToolbarDropdown>
  )
}

export function LineHeightToolbarButton({
  value,
  disabled,
  onChange,
}: {
  value: ToolbarLineHeight
  disabled?: boolean
  onChange: (value: ToolbarLineHeight) => void
}) {
  return (
    <ToolbarDropdown label="行高调整" icon={ListCollapse} disabled={disabled} contentClassName="td-line-height-menu">
      {LINE_HEIGHT_OPTIONS.map((option) => (
        <DropdownMenuItem
          key={option.value}
          className="td-editor-toolbar-menu-item td-line-height-menu-item"
          onSelect={() => onChange(option.value)}
        >
          <span className="td-editor-toolbar-check">{option.value === value ? <Check /> : null}</span>
          <span>{option.label}</span>
        </DropdownMenuItem>
      ))}
    </ToolbarDropdown>
  )
}

export function DividerToolbarButton({
  disabled,
  onClick,
}: {
  disabled?: boolean
  onClick: () => void
}) {
  return <ToolbarIconButton label="分割线" icon={Minus} disabled={disabled} onClick={onClick} />
}
