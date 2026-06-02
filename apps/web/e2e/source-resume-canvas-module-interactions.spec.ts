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
    issues: [],
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

test("keeps multi-page module interactions visible, draggable, and workspace-scoped", async ({ page }) => {
  await installWorkspaceRoutes(page)
  await page.goto("/packs/resume/workspaces/doc_long")

  await expect(page.getByRole("heading", { name: "doc_long 多页简历" })).toBeVisible()
  const gaps = page.locator(".rm-pagination-gap")
  await expect.poll(() => gaps.count()).toBeGreaterThanOrEqual(2)

  const workItem = page.getByRole("button", { name: "工作经历" })
  await workItem.click()
  await expect(workItem).toHaveAttribute("data-active", "true")
  const workRegions = page.getByTestId("module-region-mod_work")
  await expect.poll(() => workRegions.count()).toBeGreaterThanOrEqual(2)
  expect(await workRegions.evaluateAll((regions) => {
    const paginationGaps = [...document.querySelectorAll(".rm-pagination-gap")]
    return regions.every((region) => {
      const regionRect = region.getBoundingClientRect()
      return paginationGaps.every((gap) => {
        const gapRect = gap.getBoundingClientRect()
        return regionRect.bottom <= gapRect.top || regionRect.top >= gapRect.bottom
      })
    })
  })).toBe(true)

  const viewport = page.locator(".td-editor-print-wrapper")
  const beforeScrollTop = await viewport.evaluate((element) => element.scrollTop)
  const projectItem = page.getByRole("button", { name: "项目经历" })
  await projectItem.click()
  await expect(projectItem).toHaveAttribute("data-active", "true")
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(beforeScrollTop)
  const projectOffset = await page.locator("[data-canvas-node-id='project_title']").evaluate((node) => {
    const viewportNode = node.closest(".td-editor-print-wrapper")
    if (!(viewportNode instanceof HTMLElement)) return -1
    return node.getBoundingClientRect().top - viewportNode.getBoundingClientRect().top
  })
  expect(projectOffset).toBeGreaterThanOrEqual(8)
  expect(projectOffset).toBeLessThanOrEqual(24)

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
  await page.mouse.move(canvasBox.x + 48, canvasBox.y + canvasBox.height - 80, { steps: 4 })
  await page.mouse.up()

  const draggedPosition = await getOutlinePosition(page)
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
  await expect.poll(() => page.getByTestId("module-region-mod_work").count()).toBeGreaterThanOrEqual(2)
  await page.getByRole("button", { name: "模块大纲", exact: true }).click()
  await expect(outline).not.toBeVisible()
  await expect.poll(() => page.getByTestId("module-region-mod_work").count()).toBeGreaterThanOrEqual(2)
  await page.getByRole("button", { name: "模块大纲", exact: true }).click()
  await expect(page.getByLabel("简历模块大纲")).toBeVisible()
})
