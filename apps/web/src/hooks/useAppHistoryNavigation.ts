import { useCallback, useRef } from "react"
import { useLocation, useNavigate, useNavigationType } from "react-router-dom"

function readHistoryIndex() {
  const index = window.history.state?.idx
  return typeof index === "number" && Number.isFinite(index) ? index : 0
}

export function useAppHistoryNavigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const currentIndex = readHistoryIndex()
  const baseIndexRef = useRef(currentIndex)
  const maxIndexRef = useRef(currentIndex)
  const lastLocationKeyRef = useRef(location.key)

  if (lastLocationKeyRef.current !== location.key) {
    lastLocationKeyRef.current = location.key
    if (navigationType === "PUSH") {
      maxIndexRef.current = currentIndex
    } else {
      maxIndexRef.current = Math.max(maxIndexRef.current, currentIndex)
    }
  }

  const canGoBack = currentIndex > baseIndexRef.current
  const canGoForward = currentIndex < maxIndexRef.current

  const goBack = useCallback(() => {
    if (readHistoryIndex() > baseIndexRef.current) navigate(-1)
  }, [navigate])

  const goForward = useCallback(() => {
    if (readHistoryIndex() < maxIndexRef.current) navigate(1)
  }, [navigate])

  return { canGoBack, canGoForward, goBack, goForward }
}
