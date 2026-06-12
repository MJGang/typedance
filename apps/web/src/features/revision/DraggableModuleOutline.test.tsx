import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ModuleAnchor } from "@typedance/contracts"
import {
  DraggableModuleOutline,
  type DraggableModuleOutlineProps,
} from "./DraggableModuleOutline"

const anchors: ModuleAnchor[] = [
  {
    module_id: "module-project",
    canvas_node_ids: ["node-project"],
    title: "项目经历",
    order: 0,
  },
  {
    module_id: "module-education",
    canvas_node_ids: ["node-education"],
    title: "教育经历",
    order: 1,
  },
]

function createProps(
  overrides: Partial<DraggableModuleOutlineProps> = {},
): DraggableModuleOutlineProps {
  return {
    anchors,
    activeModuleId: null,
    expanded: true,
    floating: false,
    outlineTop: 40,
    panelWidth: 264,
    saveStatus: "idle",
    onExpandedChange: vi.fn(),
    onActivateModule: vi.fn(),
    onScrollToAnchor: vi.fn(),
    ...overrides,
  }
}

describe("DraggableModuleOutline", () => {
  it("renders a top-left toggle and lets it expand or collapse the outline panel", () => {
    const props = createProps()
    const { rerender } = render(<DraggableModuleOutline {...props} />)

    expect(screen.getByRole("button", { name: "收起大纲" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    expect(screen.getByLabelText("简历模块大纲")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "项目经历" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "收起大纲" }))
    expect(props.onExpandedChange).toHaveBeenCalledWith(false)

    rerender(<DraggableModuleOutline {...props} expanded={false} />)

    expect(screen.getByRole("button", { name: "展开大纲" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    expect(screen.getByTestId("module-outline-panel")).toContainElement(
      screen.getByTestId("module-outline-main-toggle"),
    )
    expect(screen.getByTestId("module-outline-panel")).toHaveClass("size-8")
    expect(screen.queryByTestId("module-outline-row-module-project")).not.toBeInTheDocument()
  })

  it("marks the active module item", () => {
    render(
      <DraggableModuleOutline
        {...createProps({ activeModuleId: "module-project" })}
      />,
    )

    const activeItem = screen.getByRole("button", { name: "项目经历" })
    expect(activeItem).toHaveAttribute("aria-current", "true")
    expect(activeItem).toHaveAttribute("data-active", "true")
    expect(activeItem).toHaveClass("text-primary", "font-semibold")
    expect(activeItem).toHaveClass("hover:text-primary")
    const inactiveItem = screen.getByRole("button", { name: "教育经历" })
    expect(inactiveItem).not.toHaveAttribute("aria-current")
    expect(inactiveItem).toHaveClass("hover:text-primary/70")
  })

  it("activates a module before scrolling to its anchor", () => {
    const calls: string[] = []
    const props = createProps({
      onActivateModule: vi.fn(() => calls.push("activate")),
      onScrollToAnchor: vi.fn(() => calls.push("scroll")),
    })
    render(<DraggableModuleOutline {...props} />)

    fireEvent.click(screen.getByRole("button", { name: "项目经历" }))

    expect(calls).toEqual(["activate", "scroll"])
    expect(props.onActivateModule).toHaveBeenCalledWith("module-project")
    expect(props.onScrollToAnchor).toHaveBeenCalledWith(expect.objectContaining(anchors[0]))
  })

  it("announces save status and retries failed saves", () => {
    const onRetrySave = vi.fn()
    const { rerender } = render(
      <DraggableModuleOutline
        {...createProps({ saveStatus: "saving", onRetrySave })}
      />,
    )

    expect(screen.getByText("正在保存")).toHaveAttribute("aria-live", "polite")

    rerender(
      <DraggableModuleOutline
        {...createProps({ saveStatus: "saved", onRetrySave })}
      />,
    )
    expect(screen.getByText("已保存")).toHaveAttribute("aria-live", "polite")

    rerender(
      <DraggableModuleOutline
        {...createProps({ saveStatus: "error", onRetrySave })}
      />,
    )
    expect(screen.getByText("保存失败")).toHaveAttribute("aria-live", "polite")
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }))
    expect(onRetrySave).toHaveBeenCalledTimes(1)
  })

  it("renders the empty anchor state", () => {
    render(<DraggableModuleOutline {...createProps({ anchors: [] })} />)

    expect(screen.getByText("暂无可用模块大纲。")).toBeInTheDocument()
  })

  it("uses a glass floating panel when the A4 page cannot fit beside the minimum outline", () => {
    render(
      <DraggableModuleOutline
        {...createProps({ floating: true, panelWidth: 224 })}
      />,
    )

    const shell = screen.getByTestId("module-outline-shell")
    expect(shell).toHaveAttribute("data-layout", "floating")
    expect(shell).toHaveClass("left-4")
    expect(shell).toHaveStyle({ top: "40px" })
    expect(shell).not.toHaveClass("bg-background/70")
    expect(shell).not.toHaveClass("ring-1")
    expect(shell.getAttribute("style")).toContain("--td-module-outline-panel-width: 224px")
    const toggle = screen.getByTestId("module-outline-main-toggle")
    const panel = screen.getByTestId("module-outline-panel")
    expect(panel).toContainElement(toggle)
    expect(toggle).toHaveClass("bg-transparent")
    expect(toggle).not.toHaveClass("border-border/70")
    expect(toggle).not.toHaveClass("bg-background/85")
    expect(screen.getByTestId("module-outline-main-toggle-icon")).toHaveAttribute("data-icon", "chevrons-left")
    expect(panel).toHaveClass("border", "border-border/50", "backdrop-blur-xl")
  })

  it("aligns the expanded toggle top edge to the first A4 page top", () => {
    render(<DraggableModuleOutline {...createProps({ expanded: true, outlineTop: 56 })} />)

    const shell = screen.getByTestId("module-outline-shell")
    const panel = screen.getByTestId("module-outline-panel")
    const toggle = screen.getByTestId("module-outline-main-toggle")

    expect(panel).toContainElement(toggle)
    expect(shell).toHaveStyle({ top: "56px" })
  })

  it("aligns the collapsed toggle top edge directly to the first A4 page top", () => {
    render(<DraggableModuleOutline {...createProps({ expanded: false, outlineTop: 56 })} />)

    expect(screen.getByTestId("module-outline-shell")).toHaveStyle({ top: "56px" })
    expect(screen.getByTestId("module-outline-panel")).toHaveClass("size-8")
  })

  it("uses a double-left arrow for the docked expanded outline toggle", () => {
    render(<DraggableModuleOutline {...createProps({ floating: false, expanded: true })} />)

    const panel = screen.getByTestId("module-outline-panel")
    const toggle = screen.getByTestId("module-outline-main-toggle")
    expect(panel).toContainElement(toggle)
    expect(toggle).not.toHaveClass("border-border/70")
    expect(screen.getByTestId("module-outline-main-toggle-icon")).toHaveAttribute(
      "data-icon",
      "chevrons-left",
    )
  })

  it("uses the menu icon when the outline is collapsed", () => {
    render(<DraggableModuleOutline {...createProps({ floating: false, expanded: false })} />)

    const panel = screen.getByTestId("module-outline-panel")
    const toggle = screen.getByTestId("module-outline-main-toggle")
    expect(panel).toContainElement(toggle)
    expect(panel).toHaveClass("border", "border-border", "shadow-sm", "size-8")
    expect(toggle).toHaveClass("border-transparent", "bg-transparent")
    expect(toggle).toHaveClass("hover:bg-transparent")
    expect(toggle).not.toHaveClass("hover:bg-accent/60")
    expect(screen.getByTestId("module-outline-main-toggle-icon")).toHaveAttribute(
      "data-icon",
      "menu",
    )
  })

  it("does not animate panel dimensions when toggling the outline", () => {
    const { rerender } = render(<DraggableModuleOutline {...createProps({ expanded: true })} />)

    expect(screen.getByTestId("module-outline-panel")).not.toHaveClass(
      "transition-[width,max-height]",
    )

    rerender(<DraggableModuleOutline {...createProps({ expanded: false })} />)

    expect(screen.getByTestId("module-outline-panel")).not.toHaveClass(
      "transition-[width,max-height]",
    )
  })

  it("keeps the expanded outline panel vertical padding balanced", () => {
    render(<DraggableModuleOutline {...createProps({ expanded: true })} />)

    expect(screen.getByTestId("module-outline-scroll")).toHaveClass("p-2")
    expect(screen.getByTestId("module-outline-main-toggle")).toHaveClass("mb-2")
  })

  it("indents heading outline items by heading level", () => {
    const headingAnchors = [
      {
        module_id: "module-project",
        canvas_node_ids: ["node-project"],
        title: "项目经历",
        order: 0,
        outline_level: 2,
      },
      {
        module_id: "module-project-a",
        canvas_node_ids: ["node-project-a"],
        title: "项目 A",
        order: 1,
        outline_level: 3,
      },
      {
        module_id: "module-project-a-detail",
        canvas_node_ids: ["node-project-a-detail"],
        title: "项目 A 细节",
        order: 2,
        outline_level: 5,
      },
    ] as unknown as ModuleAnchor[]
    render(<DraggableModuleOutline {...createProps({ anchors: headingAnchors })} />)

    expect(screen.getByRole("button", { name: "项目经历" })).toHaveAttribute(
      "data-depth",
      "0",
    )
    expect(screen.getByRole("button", { name: "项目经历" })).toHaveStyle({
      paddingLeft: "10px",
    })
    expect(screen.getByRole("button", { name: "项目 A" })).toHaveAttribute(
      "data-depth",
      "1",
    )
    expect(screen.getByRole("button", { name: "项目 A" })).toHaveStyle({
      paddingLeft: "28px",
    })
    expect(screen.getByRole("button", { name: "项目 A 细节" })).toHaveAttribute(
      "data-depth",
      "2",
    )
    expect(screen.getByRole("button", { name: "项目 A 细节" })).toHaveStyle({
      paddingLeft: "46px",
    })
  })

  it("uses heading levels rather than resume title text to build hierarchy", () => {
    const headingAnchors = [
      {
        module_id: "module-info",
        canvas_node_ids: ["node-info"],
        title: "个人信息",
        order: 0,
        outline_level: 2,
      },
      {
        module_id: "module-work",
        canvas_node_ids: ["node-work"],
        title: "工作经历",
        order: 1,
        outline_level: 2,
      },
      {
        module_id: "module-work-a",
        canvas_node_ids: ["node-work-a"],
        title: "杭州恒生芸擎网络科技有限公司 | 前端技术负责人",
        order: 2,
        outline_level: 3,
      },
      {
        module_id: "module-projects",
        canvas_node_ids: ["node-projects"],
        title: "重点项目",
        order: 3,
        outline_level: 2,
      },
      {
        module_id: "module-project-a",
        canvas_node_ids: ["node-project-a"],
        title: "TypeDance AI-native 简历改稿系统 | 个人项目 / 独立全栈开发",
        order: 4,
        outline_level: 4,
      },
    ] as unknown as ModuleAnchor[]
    render(<DraggableModuleOutline {...createProps({ anchors: headingAnchors })} />)

    expect(screen.getByRole("button", { name: "工作经历" })).toHaveStyle({
      paddingLeft: "10px",
    })
    expect(
      screen.getByRole("button", {
        name: "杭州恒生芸擎网络科技有限公司 | 前端技术负责人",
      }),
    ).toHaveStyle({ paddingLeft: "28px" })
    expect(screen.getByRole("button", { name: "重点项目" })).toHaveStyle({
      paddingLeft: "10px",
    })
    expect(
      screen.getByRole("button", {
        name: "TypeDance AI-native 简历改稿系统 | 个人项目 / 独立全栈开发",
      }),
    ).toHaveStyle({ paddingLeft: "28px" })

    fireEvent.pointerEnter(screen.getByTestId("module-outline-row-module-work"))
    expect(screen.getByRole("button", { name: "收起 工作经历 子模块" })).toBeInTheDocument()
  })

  it("truncates long child titles instead of wrapping them", () => {
    const longChildTitle = "杭州恒生芸擎网络科技有限公司 | 前端技术负责人 | 负责跨端低代码设计器和复杂表格渲染治理"
    const headingAnchors = [
      {
        module_id: "module-work",
        canvas_node_ids: ["node-work"],
        title: "工作经历",
        order: 0,
        outline_level: 2,
      },
      {
        module_id: "module-work-a",
        canvas_node_ids: ["node-work-a"],
        title: longChildTitle,
        order: 1,
        outline_level: 3,
      },
    ] as unknown as ModuleAnchor[]
    render(<DraggableModuleOutline {...createProps({ anchors: headingAnchors })} />)

    const childButton = screen.getByRole("button", { name: longChildTitle })
    const childText = screen.getByText(longChildTitle)

    expect(childButton).toHaveClass("overflow-hidden")
    expect(childButton).not.toHaveClass("whitespace-normal")
    expect(childText).toHaveClass("truncate", "whitespace-nowrap")
  })

  it("reveals solid triangle collapse controls only while hovering a parent row", () => {
    const headingAnchors = [
      {
        module_id: "module-project",
        canvas_node_ids: ["node-project"],
        title: "项目经历",
        order: 0,
        outline_level: 2,
      },
      {
        module_id: "module-project-a",
        canvas_node_ids: ["node-project-a"],
        title: "项目 A",
        order: 1,
        outline_level: 3,
      },
    ] as unknown as ModuleAnchor[]
    render(<DraggableModuleOutline {...createProps({ anchors: headingAnchors })} />)

    expect(screen.getByRole("button", { name: "项目 A" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "收起 项目经历 子模块" })).not.toBeInTheDocument()

    fireEvent.pointerEnter(screen.getByTestId("module-outline-row-module-project"))
    const toggle = screen.getByRole("button", { name: "收起 项目经历 子模块" })
    const expandedIcon = screen.getByTestId("module-outline-toggle-icon-module-project")
    expect(expandedIcon).toHaveAttribute("data-direction", "up")
    expect(expandedIcon).toHaveClass("fill-current")
    fireEvent.click(toggle)

    expect(screen.queryByRole("button", { name: "项目 A" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "展开 项目经历 子模块" })).toBeInTheDocument()
    const collapsedIcon = screen.getByTestId("module-outline-toggle-icon-module-project")
    expect(collapsedIcon).toHaveAttribute("data-direction", "down")
    expect(collapsedIcon).toHaveClass("fill-current")
  })

  it("marks the outline chrome as module-interaction-only", () => {
    render(<DraggableModuleOutline {...createProps()} />)

    expect(screen.getByTestId("module-outline-shell")).toHaveClass(
      "td-module-interaction-only",
    )
  })
})
