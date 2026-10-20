import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { loadPanelWidths, resolvePanelLayout, savePanelWidths } from "../revision/panelLayout"

// 在路由外层持有面板尺寸，两个编辑模式共用同一份测量值和用户偏好。
export function useResumePackPanels(leftVisible: boolean, rightVisible: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [requested, setRequested] = useState(loadPanelWidths)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => setContainerWidth(container.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const updateLeft = useCallback((left: number) => {
    setRequested((current) => ({ ...current, left }))
  }, [])
  const updateRight = useCallback((right: number) => {
    setRequested((current) => ({ ...current, right }))
  }, [])
  const persistLeft = useCallback((left: number) => {
    setRequested((current) => {
      const next = { ...current, left }
      savePanelWidths(next)
      return next
    })
  }, [])
  const persistRight = useCallback((right: number) => {
    setRequested((current) => {
      const next = { ...current, right }
      savePanelWidths(next)
      return next
    })
  }, [])

  return {
    containerRef,
    panelLayout: resolvePanelLayout({ containerWidth, leftVisible, rightVisible, requested }),
    updateLeft, updateRight, persistLeft, persistRight,
  }
}
