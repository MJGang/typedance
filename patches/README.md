# 依赖补丁

## tiptap-pagination-plus 3.1.0

分页库通过编辑器最后一个 DOM 元素的边界计算页数。StarterKit 为列表、栅栏、时间轴等末尾结构块补齐空段落；这个输入位置可能被挤到下一页，产生无法手动删除的空白页。

补丁让页数计算跳过带 `data-rm-pagination-ignore` 视图标记的末尾元素。前端 `TrailingParagraphPlaceholder` 只为结构块之后的单个末尾空段落添加该标记，并将其作为不占正文空间的输入区域。输入文字后标记自动移除；连续空段落照常排版，文档数据不变。静态导出排除带标记的输入占位。

补丁由 `pnpm-workspace.yaml` 的 `patchedDependencies` 与锁文件共同固定，安装依赖时自动应用。升级分页库时需重新核对其页数计算，运行 `apps/web/e2e/trailing-paragraph.spec.ts` 并验收预览与 PDF 的分页、最后一个列表项、继续输入和撤销行为。
