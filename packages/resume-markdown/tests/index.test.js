import { describe, expect, it } from "vitest"
import {
  markdownBlockToResumeDocNodes,
  markdownToResumeDocJson,
} from "../src/index.js"

describe("resume markdown conversion", () => {
  it("converts Markdown syntax into Tiptap document JSON", () => {
    const doc = markdownToResumeDocJson("## 核心能力\n\n- **前端架构**: Vue\n\n---")

    expect(doc).toMatchObject({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "核心能力" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "前端架构", marks: [{ type: "bold" }] },
                    { type: "text", text: ": Vue" },
                  ],
                },
              ],
            },
          ],
        },
        { type: "horizontalRule" },
      ],
    })
  })

  it("preserves nested ordered and unordered Markdown list structure", () => {
    const doc = markdownToResumeDocJson([
      "1. 一级有序",
      "   1. 二级有序",
      "      1. 三级有序",
      "",
      "- 一级无序",
      "  - 二级无序",
      "    - 三级无序",
    ].join("\n"))

    expect(doc.content?.[0]).toMatchObject({
      type: "orderedList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "一级有序" }],
            },
            {
              type: "orderedList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "二级有序" }],
                    },
                    {
                      type: "orderedList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "三级有序" }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })

    expect(doc.content?.[1]).toMatchObject({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "一级无序" }],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "二级无序" }],
                    },
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "三级无序" }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
  })

  it("preserves bold marks and mixed nested resume list structure", () => {
    const doc = markdownToResumeDocJson([
      "- **集群架构**: 负责 Kubernetes 多集群治理与容量规划",
      "  - 平台可观测能力",
      "    - 汇总核心链路指标与告警",
      "  1. 统一控制面接入部署、发布与回滚流程",
      "     - 通过健康检查保护灰度发布",
      "  2. 建立跨集群资源调度策略",
    ].join("\n"))

    expect(doc.content?.[0]).toMatchObject({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "集群架构", marks: [{ type: "bold" }] },
                { type: "text", text: ": 负责 Kubernetes 多集群治理与容量规划" },
              ],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "平台可观测能力" }],
                    },
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "汇总核心链路指标与告警" }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "orderedList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "统一控制面接入部署、发布与回滚流程" }],
                    },
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "通过健康检查保护灰度发布" }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "建立跨集群资源调度策略" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
  })

  it("applies source canvas attrs without keeping Markdown markers", () => {
    const [node] = markdownBlockToResumeDocNodes("- **前端架构**: Vue", {
      fallbackType: "list",
      attrs: {
        canvasNodeId: "node_block_1",
        sourceBlockId: "block_1",
        moduleId: "mod_skills",
      },
    })

    expect(node).toMatchObject({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          attrs: {
            canvasNodeId: "node_block_1",
            sourceBlockId: "block_1",
            moduleId: "mod_skills",
          },
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "前端架构", marks: [{ type: "bold" }] },
                { type: "text", text: ": Vue" },
              ],
            },
          ],
        },
      ],
    })
  })

  it("uses parsed inline marks when plain section headings come from parser block types", () => {
    const [node] = markdownBlockToResumeDocNodes("专业**技能**", {
      fallbackType: "heading",
      attrs: {
        canvasNodeId: "node_heading",
        sourceBlockId: "heading",
      },
    })

    expect(node).toMatchObject({
      type: "heading",
      attrs: {
        level: 2,
        canvasNodeId: "node_heading",
        sourceBlockId: "heading",
      },
      content: [
        { type: "text", text: "专业" },
        { type: "text", text: "技能", marks: [{ type: "bold" }] },
      ],
    })
  })
})
