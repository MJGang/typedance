import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { ChevronsLeft, Menu, Triangle } from "lucide-react"
import type { ModuleAnchor } from "@typedance/contracts"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type DraftCanvasSaveStatus = "idle" | "saving" | "saved" | "error"

type ModuleOutlineAnchor = ModuleAnchor & {
  heading_index?: number
  outline_level?: number | null
}

type ModuleOutlineNode = ModuleOutlineAnchor & {
  children: ModuleOutlineNode[]
}

function getAnchorLevel(anchor: ModuleOutlineAnchor): number | null {
  if (
    typeof anchor.outline_level === "number"
    && Number.isFinite(anchor.outline_level)
    && anchor.outline_level > 0
  ) {
    return anchor.outline_level
  }
  return null
}

function buildOutlineNodesByLevels(anchors: ModuleOutlineAnchor[]): ModuleOutlineNode[] {
  const explicitLevels = anchors
    .map(getAnchorLevel)
    .filter((level): level is number => level !== null)
  const rootLevel = explicitLevels.length > 0 ? Math.min(...explicitLevels) : 1
  const nodes: ModuleOutlineNode[] = []
  const stack: Array<{ level: number; node: ModuleOutlineNode }> = []

  for (const anchor of anchors) {
    const level = getAnchorLevel(anchor) ?? rootLevel
    const node: ModuleOutlineNode = { ...anchor, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]?.node
    if (parent) {
      parent.children.push(node)
    } else {
      nodes.push(node)
    }
    stack.push({ level, node })
  }

  return nodes
}

export type DraggableModuleOutlineProps = {
  anchors: ModuleAnchor[]
  activeModuleId: string | null
  expanded: boolean
  floating: boolean
  outlineMaxHeight?: number
  outlineTop?: number
  panelWidth: number
  saveStatus: DraftCanvasSaveStatus
  saveError?: string | null
  onRetrySave?: () => void
  onExpandedChange: (expanded: boolean) => void
  onActivateModule: (moduleId: string) => void
  onScrollToAnchor: (anchor: ModuleAnchor) => void
}

export function draftCanvasSaveStatusLabel(status: DraftCanvasSaveStatus) {
  if (status === "saving") return "正在保存"
  if (status === "saved") return "已保存"
  if (status === "error") return "保存失败"
  return ""
}

function toOutlineNodes(anchors: ModuleAnchor[]): ModuleOutlineNode[] {
  const typedAnchors = anchors as ModuleOutlineAnchor[]
  const sortedAnchors = [...typedAnchors].sort((left, right) => left.order - right.order)
  return buildOutlineNodesByLevels(sortedAnchors)
}

function collectDefaultExpandedModuleIds(nodes: ModuleOutlineNode[], ids = new Set<string>()) {
  for (const node of nodes) {
    if (node.children.length > 0) {
      ids.add(node.module_id)
      collectDefaultExpandedModuleIds(node.children, ids)
    }
  }
  return ids
}

function ModuleOutlineRows({
  nodes,
  activeModuleId,
  collapsedModuleIds,
  hoveredModuleId,
  depth = 0,
  onActivateModule,
  onScrollToAnchor,
  onHoveredModuleChange,
  onToggleModule,
}: {
  nodes: ModuleOutlineNode[]
  activeModuleId: string | null
  collapsedModuleIds: Set<string>
  hoveredModuleId: string | null
  depth?: number
  onActivateModule: (moduleId: string) => void
  onScrollToAnchor: (anchor: ModuleAnchor) => void
  onHoveredModuleChange: (moduleId: string | null) => void
  onToggleModule: (moduleId: string) => void
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((node) => {
        const active = node.module_id === activeModuleId
        const hasChildren = node.children.length > 0
        const collapsed = collapsedModuleIds.has(node.module_id)
        const childToggleVisible = hasChildren && hoveredModuleId === node.module_id
        const indent = 10 + depth * 18

        return (
          <li
            key={node.module_id}
            data-depth={depth}
            data-testid={`module-outline-row-${node.module_id}`}
            onPointerEnter={() => onHoveredModuleChange(node.module_id)}
            onPointerLeave={() => onHoveredModuleChange(null)}
          >
            <div className="group flex min-h-8 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-current={active ? "true" : undefined}
                data-active={active ? "true" : undefined}
                data-depth={depth}
                data-has-children={hasChildren ? "true" : undefined}
                className={cn(
                  "h-auto min-h-8 min-w-0 flex-1 justify-start overflow-hidden rounded-sm py-1.5 pr-2 text-left text-sm font-normal text-muted-foreground hover:bg-primary/5 hover:text-primary/70",
                  active && "font-semibold text-primary hover:bg-primary/5 hover:text-primary",
                )}
                style={{ paddingLeft: indent }}
                onClick={() => {
                  onActivateModule(node.module_id)
                  onScrollToAnchor(node)
                }}
              >
                <span className="block min-w-0 truncate whitespace-nowrap">
                  {node.title}
                </span>
              </Button>
              {childToggleVisible ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${collapsed ? "展开" : "收起"} ${node.title} 子模块`}
                  className="size-7 shrink-0 rounded-sm"
                  onClick={() => onToggleModule(node.module_id)}
                >
                  <Triangle
                    data-direction={collapsed ? "down" : "up"}
                    data-testid={`module-outline-toggle-icon-${node.module_id}`}
                    className={cn(
                      "size-3 fill-current text-muted-foreground transition-transform",
                      collapsed && "rotate-180",
                    )}
                    strokeWidth={1.75}
                  />
                </Button>
              ) : null}
            </div>
            {hasChildren && !collapsed ? (
              <ModuleOutlineRows
                nodes={node.children}
                activeModuleId={activeModuleId}
                collapsedModuleIds={collapsedModuleIds}
                hoveredModuleId={hoveredModuleId}
                depth={depth + 1}
                onActivateModule={onActivateModule}
                onScrollToAnchor={onScrollToAnchor}
                onHoveredModuleChange={onHoveredModuleChange}
                onToggleModule={onToggleModule}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export function DraggableModuleOutline({
  anchors,
  activeModuleId,
  expanded,
  floating,
  outlineMaxHeight = 640,
  outlineTop = 0,
  panelWidth,
  saveStatus,
  saveError,
  onRetrySave,
  onExpandedChange,
  onActivateModule,
  onScrollToAnchor,
}: DraggableModuleOutlineProps) {
  const outlineNodes = useMemo(() => toOutlineNodes(anchors), [anchors])
  const defaultExpandedModuleIds = useMemo(
    () => collectDefaultExpandedModuleIds(outlineNodes),
    [outlineNodes],
  )
  const [expandedModuleIds, setExpandedModuleIds] = useState(defaultExpandedModuleIds)
  const [hoveredModuleId, setHoveredModuleId] = useState<string | null>(null)
  useEffect(() => {
    setExpandedModuleIds(defaultExpandedModuleIds)
  }, [defaultExpandedModuleIds])

  const collapsedModuleIds = useMemo(() => {
    const collapsedIds = new Set<string>()
    for (const moduleId of defaultExpandedModuleIds) {
      if (!expandedModuleIds.has(moduleId)) collapsedIds.add(moduleId)
    }
    return collapsedIds
  }, [defaultExpandedModuleIds, expandedModuleIds])
  const saveStatusLabel = draftCanvasSaveStatusLabel(saveStatus)
  const MainToggleIcon = expanded ? ChevronsLeft : Menu
  const mainToggleIconName = expanded ? "chevrons-left" : "menu"
  const outlineChromePadding = 0
  const shellTop = Math.max(0, outlineTop - outlineChromePadding)
  const panelMaxHeight = Math.max(32, outlineMaxHeight)

  const toggleModule = (moduleId: string) => {
    setExpandedModuleIds((currentIds) => {
      const nextIds = new Set(currentIds)
      if (nextIds.has(moduleId)) {
        nextIds.delete(moduleId)
      } else {
        nextIds.add(moduleId)
      }
      return nextIds
    })
  }

  const mainToggleButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-expanded={expanded}
      aria-label={expanded ? "收起大纲" : "展开大纲"}
      data-testid="module-outline-main-toggle"
      className={cn(
        "size-4 shrink-0 rounded-sm border-transparent bg-transparent shadow-none ring-transparent",
        expanded
          ? "mb-2 hover:bg-transparent aria-expanded:bg-transparent"
          : "hover:bg-transparent",
      )}
      onClick={() => onExpandedChange(!expanded)}
    >
      <MainToggleIcon data-icon={mainToggleIconName} data-testid="module-outline-main-toggle-icon" />
    </Button>
  )

  return (
    <div
      data-testid="module-outline-shell"
      data-layout={floating ? "floating" : "docked"}
      className={cn(
        "td-module-interaction-only absolute z-20",
        floating ? "left-4 top-[4.75rem]" : "left-3 top-[4.25rem]",
      )}
      style={{
        "--td-module-outline-max-height": `${panelMaxHeight}px`,
        "--td-module-outline-panel-width": `${panelWidth}px`,
        top: `${shellTop}px`,
      } as CSSProperties}
    >
      <aside
        aria-label="简历模块大纲"
        data-testid="module-outline-panel"
        className={cn(
          "overflow-hidden rounded-md border transition-[background-color,border-color,box-shadow,backdrop-filter] duration-100",
          expanded ? "flex w-[var(--td-module-outline-panel-width)] max-h-[var(--td-module-outline-max-height)] flex-col" : "size-8",
          floating
            ? "border-border/50 bg-background/60 shadow-xl backdrop-blur-xl"
            : "border-border bg-background shadow-sm",
        )}
      >
        <div
          data-testid="module-outline-scroll"
          className={cn(
            "flex min-h-0 flex-col p-2",
            expanded ? "flex-1 overflow-y-auto" : "h-full overflow-hidden",
          )}
        >
          {mainToggleButton}
          {expanded ? (
            outlineNodes.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">暂无可用模块大纲。</p>
            ) : (
              <ModuleOutlineRows
                nodes={outlineNodes}
                activeModuleId={activeModuleId}
                collapsedModuleIds={collapsedModuleIds}
                hoveredModuleId={hoveredModuleId}
                onActivateModule={onActivateModule}
                onScrollToAnchor={onScrollToAnchor}
                onHoveredModuleChange={setHoveredModuleId}
                onToggleModule={toggleModule}
              />
            )
          ) : null}
        </div>
        {expanded && (saveStatusLabel || (saveStatus === "error" && onRetrySave)) ? (
          <div
            className={cn(
              "flex min-h-8 items-center justify-between gap-2 border-t border-border px-3 py-1 text-xs text-muted-foreground",
              saveStatus === "error" && "text-destructive",
            )}
            title={saveError ?? undefined}
          >
            <span aria-live="polite">{saveStatusLabel}</span>
            {saveStatus === "error" && onRetrySave ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={onRetrySave}
              >
                重试保存
              </Button>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  )
}
