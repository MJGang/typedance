import { expect, test, type Page } from "@playwright/test"
import type { SourceResumeCanvas, WorkspaceView } from "@typedance/contracts"

const NOW = "2026-06-01T08:00:00.000Z"

type CanvasNode = {
  type: "heading" | "paragraph"
  attrs: {
    canvasNodeId: string
    sourceBlockId: string
    moduleId: string
    level?: number
  }
  content: Array<{ type: "text"; text: string }>
}

function canvasNode(
  id: string,
  moduleId: string,
  text: string,
  type: CanvasNode["type"] = "paragraph",
): CanvasNode {
  return {
    type,
    attrs: {
      canvasNodeId: id,
      sourceBlockId: `block_${id}`,
      moduleId,
      ...(type === "heading" ? { level: 2 } : {}),
    },
    content: [{ type: "text", text }],
  }
}

function buildLongWorkspace(documentId: string): WorkspaceView {
  const basicNodes = [
    canvasNode("basic_title", "mod_basic", "个人信息", "heading"),
    canvasNode("basic_name", "mod_basic", "张三 | 前端工程师 | zhangsan@example.com"),
  ]
  const skillNodes = [
    canvasNode("skill_title", "mod_skills", "专业技能", "heading"),
    canvasNode("skill_body", "mod_skills", "React、TypeScript、Node.js、性能优化、工程化治理"),
  ]
  const workNodes = [
    canvasNode("work_title", "mod_work", "工作经历", "heading"),
    ...Array.from({ length: 74 }, (_, index) => (
      canvasNode(
        `work_${index}`,
        "mod_work",
        `星河科技有限公司 | 前端工程师 | 第 ${index + 1} 条经历：负责交易链路重构、组件治理与质量保障。`,
      )
    )),
  ]
  const projectNodes = [
    canvasNode("project_title", "mod_project", "项目经历", "heading"),
    ...Array.from({ length: 18 }, (_, index) => (
      canvasNode(
        `project_${index}`,
        "mod_project",
        `ETC 平台项目第 ${index + 1} 条：完成页面架构设计、接口联调和性能复验。`,
      )
    )),
  ]
  const nodes = [...basicNodes, ...skillNodes, ...workNodes, ...projectNodes]
  const sourceResumeCanvas: SourceResumeCanvas = {
    id: `canvas_${documentId}`,
    document_id: documentId,
    old_resume_source_id: `source_${documentId}`,
    doc_json: {
      type: "doc",
      content: nodes,
    },
    node_map: nodes.map((node) => ({
      canvas_node_id: node.attrs.canvasNodeId,
      source_block_id: node.attrs.sourceBlockId,
      node_type: node.type,
      text: node.content[0]?.text ?? "",
      source_span: {},
      module_id: node.attrs.moduleId,
    })),
    module_anchors: [
      {
        module_id: "mod_basic",
        canvas_node_ids: basicNodes.map((node) => node.attrs.canvasNodeId),
        title: "个人信息",
        order: 0,
      },
      {
        module_id: "mod_skills",
        canvas_node_ids: skillNodes.map((node) => node.attrs.canvasNodeId),
        title: "专业技能",
        order: 1,
      },
      {
        module_id: "mod_work",
        canvas_node_ids: workNodes.map((node) => node.attrs.canvasNodeId),
        title: "工作经历",
        order: 2,
      },
      {
        module_id: "mod_project",
        canvas_node_ids: projectNodes.map((node) => node.attrs.canvasNodeId),
        title: "项目经历",
        order: 3,
      },
    ],
    created_at: NOW,
    updated_at: NOW,
  }

  return {
    document: {
      id: documentId,
      pack_id: "resume",
      title: `${documentId} 多页简历`,
      status: "active",
      target_language: "zh-CN",
      current_draft_id: `draft_${documentId}`,
      created_at: NOW,
      updated_at: NOW,
    },
    current_draft: {
      id: `draft_${documentId}`,
      document_id: documentId,
      run_id: `run_${documentId}`,
      pack_id: "resume",
      status: "in_review",
      summary: "多页原始简历",
      applied_proposal_ids: [],
      unresolved_issue_ids: [],
      variant_type: "base",
      created_at: NOW,
      updated_at: NOW,
    },
    modules: [],
    claims: [],
    issues: Array.from({ length: 18 }, (_, index) => ({
      id: `issue_${index}`,
      run_id: `run_${documentId}`,
      document_id: documentId,
      draft_id: `draft_${documentId}`,
      module_id: "mod_work",
      type: "missing_result",
      severity: index % 3 === 0 ? "blocking" : "warning",
      title: `第 ${index + 1} 个评审问题`,
      message: "这条问题说明较长，用来模拟评审栏内容超过当前工作区高度后的滚动表现。",
      reason: "评审栏应固定在工作区高度内，并通过自身纵向滚动承载长内容。",
      actions: [],
      status: "open",
      created_by_agent: "ResumeReviewer",
      evidence_link_ids: [],
      created_at: NOW,
    })),
    proposals: [],
    evidence: [],
    source_summaries: [],
    source_resume_canvas: sourceResumeCanvas,
    quality_gate: {
      status: "ready",
      blocking_issue_ids: [],
      warning_issue_ids: [],
    },
    run_status: {
      run_id: `run_${documentId}`,
      status: "completed",
    },
    coach_summary: {
      summary: "原始简历已完成结构识别。",
      next_action_ids: [],
    },
    available_actions: [],
  }
}

async function installWorkspaceRoutes(page: Page) {
  const workspaces = new Map([
    ["doc_long", buildLongWorkspace("doc_long")],
    ["doc_other", buildLongWorkspace("doc_other")],
  ])

  await page.route("http://127.0.0.1:4317/documents/*/workspace-view", async (route) => {
    const documentId = new URL(route.request().url()).pathname.split("/")[2] ?? ""
    const workspace = workspaces.get(documentId)
    await route.fulfill({
      status: workspace ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(workspace ?? { detail: "Not found" }),
    })
  })
  await page.route("http://127.0.0.1:4317/documents/*/source-resume-canvas", async (route) => {
    const documentId = new URL(route.request().url()).pathname.split("/")[2] ?? ""
    const workspace = workspaces.get(documentId)
    await route.fulfill({
      status: workspace ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(workspace?.source_resume_canvas ?? { detail: "Not found" }),
    })
  })
}

async function getOutlinePosition(page: Page) {
  return page.getByLabel("简历模块大纲").evaluate((outline) => ({
    left: Number.parseFloat((outline as HTMLElement).style.left),
    top: Number.parseFloat((outline as HTMLElement).style.top),
  }))
}

test("stretches the source resume toolbar across the draft panel on wide screens", async ({ page }) => {
  await page.setViewportSize({ width: 1750, height: 912 })
  await installWorkspaceRoutes(page)
  await page.goto("/packs/resume/workspaces/doc_long")

  await expect(page.getByRole("heading", { name: "doc_long 多页简历" })).toBeVisible()
  const toolbarGeometry = await page.locator(".td-source-resume-canvas .td-rich-editor-toolbar").evaluate((toolbar) => {
    const draftPanel = toolbar.closest('[data-testid="revision-draft-panel"]')
    const canvas = toolbar.closest(".td-source-resume-canvas")
    if (!(draftPanel instanceof HTMLElement) || !(canvas instanceof HTMLElement)) return null
    const toolbarRect = toolbar.getBoundingClientRect()
    const draftPanelRect = draftPanel.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    return {
      canvasWidth: canvasRect.width,
      leftOffset: toolbarRect.left - draftPanelRect.left,
      panelWidth: draftPanel.clientWidth,
      panelScrollWidth: draftPanel.scrollWidth,
      toolbarWidth: toolbarRect.width,
    }
  })
  expect(toolbarGeometry).not.toBeNull()
  if (!toolbarGeometry) throw new Error("Expected source canvas toolbar geometry")
  expect(toolbarGeometry.leftOffset).toBeGreaterThanOrEqual(0)
  expect(toolbarGeometry.leftOffset).toBeLessThanOrEqual(1)
  expect(toolbarGeometry.canvasWidth).toBeGreaterThanOrEqual(toolbarGeometry.panelWidth - 1)
  expect(toolbarGeometry.panelScrollWidth).toBeLessThanOrEqual(toolbarGeometry.panelWidth + 1)
  expect(toolbarGeometry.toolbarWidth).toBeGreaterThanOrEqual(toolbarGeometry.panelWidth - 1)
})

test("keeps multi-page module interactions visible, draggable, and workspace-scoped", async ({ page }) => {
  await page.setViewportSize({ width: 1126, height: 912 })
  await installWorkspaceRoutes(page)
  await page.goto("/packs/resume/workspaces/doc_long")

  await expect(page.getByRole("heading", { name: "doc_long 多页简历" })).toBeVisible()
  const backgroundColors = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-slot="sidebar-inner"]')
    const workspace = document.querySelector('[data-testid="revision-workspace-grid"]')?.parentElement
    const pageNode = document.querySelector(".td-rich-editor-content > .ProseMirror")
    if (!(sidebar instanceof HTMLElement) || !(workspace instanceof HTMLElement) || !(pageNode instanceof HTMLElement)) return null
    return {
      sidebar: getComputedStyle(sidebar).backgroundColor,
      workspace: getComputedStyle(workspace).backgroundColor,
      page: getComputedStyle(pageNode).backgroundColor,
    }
  })
  expect(backgroundColors).toEqual({
    sidebar: "rgb(249, 242, 231)",
    workspace: "rgb(251, 248, 243)",
    page: "rgb(255, 255, 255)",
  })
  const gaps = page.locator(".rm-pagination-gap")
  await expect.poll(() => gaps.count()).toBeGreaterThanOrEqual(2)
  const workspaceGridOverflow = await page.getByTestId("revision-workspace-grid").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(workspaceGridOverflow.scrollWidth).toBeLessThanOrEqual(workspaceGridOverflow.clientWidth + 1)
  const draftPanelOverflow = await page.getByTestId("revision-draft-panel").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(draftPanelOverflow.scrollWidth).toBeGreaterThanOrEqual(896)
  expect(draftPanelOverflow.scrollWidth).toBeGreaterThan(draftPanelOverflow.clientWidth)
  expect(draftPanelOverflow.scrollHeight).toBeGreaterThan(draftPanelOverflow.clientHeight)
  const toolbarGeometry = await page.getByRole("toolbar", { name: "简历格式工具栏" }).evaluate((toolbar) => {
    const draftPanel = toolbar.closest('[data-testid="revision-draft-panel"]')
    if (!(draftPanel instanceof HTMLElement)) return null
    const toolbarRect = toolbar.getBoundingClientRect()
    const draftPanelRect = draftPanel.getBoundingClientRect()
    return {
      leftOffset: toolbarRect.left - draftPanelRect.left,
      topOffset: toolbarRect.top - draftPanelRect.top,
      width: toolbarRect.width,
      panelWidth: draftPanel.clientWidth,
    }
  })
  expect(toolbarGeometry).not.toBeNull()
  if (!toolbarGeometry) throw new Error("Expected source canvas toolbar geometry")
  expect(toolbarGeometry.leftOffset).toBeGreaterThanOrEqual(0)
  expect(toolbarGeometry.leftOffset).toBeLessThanOrEqual(1)
  expect(toolbarGeometry.topOffset).toBeGreaterThanOrEqual(0)
  expect(toolbarGeometry.topOffset).toBeLessThanOrEqual(1)
  expect(toolbarGeometry.width).toBeGreaterThanOrEqual(toolbarGeometry.panelWidth)
  const reviewActionsGeometry = await page.getByTestId("revision-review-actions").evaluate((actions) => {
    const reviewPanel = actions.closest('[data-testid="revision-review-panel"]')
    if (!(reviewPanel instanceof HTMLElement)) return null
    const actionsRect = actions.getBoundingClientRect()
    const reviewPanelRect = reviewPanel.getBoundingClientRect()
    return {
      topOffset: actionsRect.top - reviewPanelRect.top,
      leftOffset: actionsRect.left - reviewPanelRect.left,
    }
  })
  expect(reviewActionsGeometry).not.toBeNull()
  if (!reviewActionsGeometry) throw new Error("Expected review action toolbar geometry")
  expect(reviewActionsGeometry.topOffset).toBeGreaterThanOrEqual(16)
  expect(reviewActionsGeometry.topOffset).toBeLessThanOrEqual(17)
  expect(reviewActionsGeometry.leftOffset).toBeGreaterThanOrEqual(16)
  expect(reviewActionsGeometry.leftOffset).toBeLessThanOrEqual(17)
  const blockTrigger = page.locator(".td-toolbar-block-trigger").first()
  const blockTriggerBackgroundBeforeHover = await blockTrigger.evaluate((element) => getComputedStyle(element).backgroundColor)
  await blockTrigger.hover()
  await page.waitForTimeout(200)
  const blockTriggerBackgroundAfterHover = await blockTrigger.evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(blockTriggerBackgroundBeforeHover).not.toBe(blockTriggerBackgroundAfterHover)
  const hoverRgb = blockTriggerBackgroundAfterHover.match(/\d+/g)?.map(Number)
  expect(hoverRgb).toBeDefined()
  if (!hoverRgb) throw new Error("Expected toolbar hover background rgb value")
  expect(hoverRgb[0]).toBeGreaterThan(hoverRgb[2])
  expect(hoverRgb[1]).toBeGreaterThan(hoverRgb[2])
  expect(hoverRgb[2]).toBeLessThan(205)
  const panelBounds = await page.evaluate(() => {
    const draftPanel = document.querySelector('[data-testid="revision-draft-panel"]')
    const reviewPanel = document.querySelector('[data-testid="revision-review-panel"]')
    if (!(draftPanel instanceof HTMLElement) || !(reviewPanel instanceof HTMLElement)) return null
    const draftRect = draftPanel.getBoundingClientRect()
    const reviewRect = reviewPanel.getBoundingClientRect()
    return {
      draftBottom: draftRect.bottom,
      reviewBottom: reviewRect.bottom,
      viewportHeight: window.innerHeight,
    }
  })
  expect(panelBounds).not.toBeNull()
  if (!panelBounds) throw new Error("Expected fixed workspace panel geometry")
  expect(panelBounds.draftBottom).toBeLessThanOrEqual(panelBounds.viewportHeight + 1)
  expect(panelBounds.reviewBottom).toBeLessThanOrEqual(panelBounds.viewportHeight + 1)
  const printWrapperOverflow = await page.locator(".td-editor-print-wrapper").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(printWrapperOverflow.scrollWidth).toBeLessThanOrEqual(printWrapperOverflow.clientWidth + 1)
  expect(printWrapperOverflow.scrollHeight).toBeLessThanOrEqual(printWrapperOverflow.clientHeight + 1)
  const printWrapperLeftGutter = await page.locator(".td-editor-print-wrapper").evaluate((element) => {
    const pageNode = element.querySelector(".ProseMirror")
    if (!(pageNode instanceof HTMLElement)) return 0
    return pageNode.getBoundingClientRect().left - element.getBoundingClientRect().left
  })
  expect(printWrapperLeftGutter).toBeGreaterThanOrEqual(48)
  const blankPoint = await page.locator(".td-source-resume-canvas .td-rich-editor-content > .ProseMirror").evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.left + 24, y: rect.top + 24 }
  })
  await page.mouse.move(blankPoint.x, blankPoint.y)
  await page.waitForTimeout(200)
  await expect(page.locator(".td-resume-drag-handle-floating")).toHaveClass(/td-resume-drag-handle-suppressed/)
  const workParagraphNode = page.locator("[data-canvas-node-id='work_0']")
  await workParagraphNode.scrollIntoViewIfNeeded()
  await workParagraphNode.hover({ force: true })
  await page.waitForSelector('[data-testid="resume-drag-handle"]', { state: "attached" })
  await expect(page.locator(".td-resume-drag-handle-floating")).not.toHaveClass(/td-resume-drag-handle-suppressed/)
  await page.waitForTimeout(200)
  const canvasCursorStyles = await page.evaluate(() => {
    const content = document.querySelector(".td-source-resume-canvas .td-rich-editor-content")
    const draftPanel = document.querySelector('[data-testid="revision-draft-panel"]')
    const wrapper = document.querySelector(".td-source-resume-canvas .td-editor-print-wrapper")
    const pageNode = document.querySelector(".td-source-resume-canvas .td-rich-editor-content > .ProseMirror")
    const textNode = document.querySelector("[data-canvas-node-id='work_0']")
    if (
      !(content instanceof HTMLElement)
      || !(draftPanel instanceof HTMLElement)
      || !(wrapper instanceof HTMLElement)
      || !(pageNode instanceof HTMLElement)
      || !(textNode instanceof HTMLElement)
    ) return null
    const textRect = textNode.getBoundingClientRect()
    const textCenterY = textRect.top + textRect.height / 2
    const pageShell = textNode.closest(".page") ?? pageNode
    const pageShellRect = pageShell instanceof HTMLElement ? pageShell.getBoundingClientRect() : pageNode.getBoundingClientRect()
    const draftPanelRect = draftPanel.getBoundingClientRect()
    const blankX = Math.min(
      Math.max(pageShellRect.left + 24, draftPanelRect.left + 8),
      Math.min(pageShellRect.right - 8, draftPanelRect.right - 8),
    )
    const blankY = Math.min(
      Math.max(textCenterY, draftPanelRect.top + 8),
      Math.min(pageShellRect.bottom - 8, draftPanelRect.bottom - 8),
    )
    const blankElement = document.elementFromPoint(blankX, blankY)
    return {
      cursorClassActive: document.body.classList.contains("td-source-canvas-cursor-text"),
      content: getComputedStyle(content).cursor,
      wrapper: getComputedStyle(wrapper).cursor,
      page: getComputedStyle(pageNode).cursor,
      pageShell: pageShell instanceof HTMLElement ? getComputedStyle(pageShell).cursor : "",
      pageBlank: blankElement instanceof HTMLElement ? getComputedStyle(blankElement).cursor : "",
      textNode: getComputedStyle(textNode).cursor,
    }
  })
  expect(canvasCursorStyles).toEqual({
    cursorClassActive: true,
    content: "text",
    wrapper: "text",
    page: "text",
    pageShell: "text",
    pageBlank: "text",
    textNode: "text",
  })
  const dragHandleTransition = await page.locator(".td-resume-drag-handle-floating").evaluate((element) => ({
    property: getComputedStyle(element).transitionProperty,
    duration: getComputedStyle(element).transitionDuration,
  }))
  expect(dragHandleTransition.property).toContain("left")
  expect(dragHandleTransition.property).toContain("top")
  expect(dragHandleTransition.duration).toContain("0.12s")
  const dragHandleGeometry = await workParagraphNode.evaluate((node) => {
    const handle = document.querySelector('[data-testid="resume-drag-handle"] .td-drag-handle')
    if (!(node instanceof HTMLElement) || !(handle instanceof HTMLElement)) return null
    const nodeRect = node.getBoundingClientRect()
    const handleRect = handle.getBoundingClientRect()
    const lineHeight = parseFloat(getComputedStyle(node).lineHeight) || nodeRect.height
    return {
      gap: nodeRect.left - handleRect.right,
      centerDelta: (handleRect.top + handleRect.height / 2) - (nodeRect.top + lineHeight / 2),
    }
  })
  expect(dragHandleGeometry).not.toBeNull()
  if (!dragHandleGeometry) throw new Error("Expected drag handle geometry")
  expect(dragHandleGeometry.gap).toBeGreaterThanOrEqual(1.5)
  expect(dragHandleGeometry.gap).toBeLessThanOrEqual(2.5)
  expect(Math.abs(dragHandleGeometry.centerDelta)).toBeLessThanOrEqual(1)

  const workItem = page.getByRole("button", { name: "工作经历" })
  await workItem.click()
  await expect(workItem).toHaveAttribute("data-active", "true")
  await expect(page.getByTestId("module-region-mod_work")).toHaveCount(0)

  const viewport = page.getByTestId("revision-draft-panel")
  const beforeScrollTop = await viewport.evaluate((element) => element.scrollTop)
  const projectItem = page.getByRole("button", { name: "项目经历" })
  await projectItem.click()
  await expect(projectItem).toHaveAttribute("data-active", "true")
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(beforeScrollTop)
  const getProjectOffset = () => page.locator("[data-canvas-node-id='project_title']").evaluate((node) => {
    const viewportNode = node.closest(".td-source-resume-canvas-viewport")
    if (!(viewportNode instanceof HTMLElement)) return -1
    return node.getBoundingClientRect().top - viewportNode.getBoundingClientRect().top
  })
  const projectOffset = await getProjectOffset()
  expect(projectOffset).toBeGreaterThanOrEqual(8)
  await expect.poll(getProjectOffset).toBeLessThanOrEqual(48)

  await viewport.evaluate((element) => element.scrollTo({ top: 0, left: 0 }))
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0)

  const outline = page.getByLabel("简历模块大纲")
  const canvas = page.locator(".td-source-resume-canvas")
  const handle = page.getByTestId("module-outline-drag-handle")
  const handleBox = await handle.boundingBox()
  const canvasBox = await canvas.boundingBox()
  expect(handleBox).not.toBeNull()
  expect(canvasBox).not.toBeNull()
  if (!handleBox || !canvasBox) throw new Error("Expected draggable outline geometry")
  await page.mouse.move(handleBox.x + 24, handleBox.y + 16)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + 120, canvasBox.y + 120, { steps: 4 })
  await page.mouse.up()

  const draggedPosition = await getOutlinePosition(page)
  expect(draggedPosition.left).toBeLessThan(240)
  expect(draggedPosition.top).toBeLessThan(180)
  const outlineBox = await outline.boundingBox()
  expect(outlineBox).not.toBeNull()
  if (!outlineBox) throw new Error("Expected outline geometry")
  expect(draggedPosition.left).toBeGreaterThanOrEqual(0)
  expect(draggedPosition.top).toBeGreaterThanOrEqual(0)
  expect(draggedPosition.left + outlineBox.width).toBeLessThanOrEqual(canvasBox.width + 1)
  expect(draggedPosition.top + outlineBox.height).toBeLessThanOrEqual(canvasBox.height + 1)

  await page.getByRole("button", { name: "折叠模块大纲" }).click()
  await expect(page.getByRole("button", { name: "展开模块大纲" })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("button", { name: "展开模块大纲" })).toBeVisible()
  await expect.poll(() => getOutlinePosition(page)).toEqual(draggedPosition)

  await page.goto("/packs/resume/workspaces/doc_other")
  await expect(page.getByRole("heading", { name: "doc_other 多页简历" })).toBeVisible()
  await expect(page.getByRole("button", { name: "折叠模块大纲" })).toBeVisible()
  expect(await getOutlinePosition(page)).not.toEqual(draggedPosition)

  const otherWorkItem = page.getByRole("button", { name: "工作经历" })
  await otherWorkItem.click()
  await expect(otherWorkItem).toHaveAttribute("data-active", "true")
  await expect(page.getByTestId("module-region-mod_work")).toHaveCount(0)
  await page.getByRole("button", { name: "模块大纲", exact: true }).click()
  await expect(outline).not.toBeVisible()
  await expect(page.getByTestId("module-region-mod_work")).toHaveCount(0)
  await page.getByRole("button", { name: "模块大纲", exact: true }).click()
  await expect(page.getByLabel("简历模块大纲")).toBeVisible()
})
