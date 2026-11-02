import { Extension } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"

/** React 节点视图挂载后才有实际高度，通知分页器重测；装饰位置只属于渲染状态。 */
export const TimelineLayout = Extension.create({
  name: "timelineLayout",
  addProseMirrorPlugins() {
    return [new Plugin({
      view(view) {
        let frame: number | null = null
        let destroyed = false
        const observed = new Set<Element>()
        const schedule = () => {
          if (destroyed || frame !== null) return
          frame = requestAnimationFrame(() => {
            frame = null
            if (destroyed) return
            // 先读取全部几何数据，再更新绝对定位装饰，避免逐项交替触发布局。
            const breaks = Array.from(view.dom.querySelectorAll<HTMLElement>(".rm-page-break > .breaker"), (element) => element.getBoundingClientRect())
            const timelines = Array.from(view.dom.querySelectorAll<HTMLElement>(".td-timeline"), (timeline) => (
              Array.from(timeline.querySelectorAll<HTMLElement>(":scope > .td-timeline-entry > .td-timeline-item"), (item) => {
                const body = item.querySelector<HTMLElement>(".td-timeline-body")!
                const rect = item.getBoundingClientRect()
                const scale = rect.width / item.offsetWidth || 1
                const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
                let text = walker.nextNode()
                while (text && !text.textContent?.trim()) text = walker.nextNode()
                let center = 12
                if (text) {
                  const range = document.createRange()
                  range.setStart(text, 0)
                  range.setEnd(text, 1)
                  const first = range.getBoundingClientRect()
                  if (first.height) center = (first.top + first.height / 2 - rect.top) / scale
                }
                return { item, center, rect, scale }
              })
            ))
            for (const items of timelines) items.forEach(({ item, center, rect, scale }, index) => {
              item.querySelector<HTMLElement>(".td-timeline-dot")!.style.top = `${center - 4}px`
              const line = item.querySelector<HTMLElement>(".td-timeline-line")!
              line.style.top = `${center}px`
              line.style.bottom = `${-(items[index + 1]?.center ?? 12)}px`
              // 分页占位浮动元素包含页脚、页间空白及下一页页头；这些区域不画连线。
              const next = items[index + 1]
              const start = rect.top + center * scale
              const end = next ? next.rect.top + next.center * next.scale : start
              const stops = ["#cbd9f3 0px"]
              for (const gap of breaks) {
                if (gap.bottom <= start || gap.top >= end) continue
                const from = Math.max(0, (gap.top - start) / scale)
                const to = Math.min((end - start) / scale, (gap.bottom - start) / scale)
                stops.push(`#cbd9f3 ${from}px`, `transparent ${from}px`, `transparent ${to}px`, `#cbd9f3 ${to}px`)
              }
              stops.push(`#cbd9f3 ${Math.max(0, (end - start) / scale)}px`)
              line.style.borderLeftWidth = "0"
              line.style.width = "1px"
              line.style.backgroundImage = `linear-gradient(to bottom, ${stops.join(",")})`
            })
            // 无文档变更、无历史记录。现有分页器在 view.update 中读取最新 DOM。
            view.dispatch(view.state.tr.setMeta("addToHistory", false))
          })
        }
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule)
        const sync = () => {
          const current = new Set<Element>(view.dom.querySelectorAll(".td-timeline"))
          for (const element of observed) {
            if (!current.has(element)) { observer?.unobserve(element); observed.delete(element) }
          }
          for (const element of current) {
            if (!observed.has(element)) { observer?.observe(element); observed.add(element); schedule() }
          }
        }
        sync()
        void document.fonts?.ready.then(() => { if (observed.size) schedule() })
        return {
          update(current, previous) {
            sync()
            if (observed.size && current.state.doc !== previous.doc) schedule()
          },
          destroy() {
            destroyed = true
            observer?.disconnect()
            if (frame !== null) cancelAnimationFrame(frame)
          },
        }
      },
    })]
  },
})
