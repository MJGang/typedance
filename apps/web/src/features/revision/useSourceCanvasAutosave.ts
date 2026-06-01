import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SourceResumeCanvas } from "@typedance/contracts"
import { saveSourceResumeCanvas } from "@/api"
import type { ResumeDocJson, ResumeEditorChange } from "../workspace/editor"
import type { DraftCanvasSaveStatus } from "./DraftCanvas"

const AUTOSAVE_DELAY_MS = 600

type PendingSave = {
  docJson: ResumeDocJson
  version: number
}

type AutosaveQueueOptions = {
  documentId: string
  onSaved: (canvas: SourceResumeCanvas) => void
  onSettled: () => void
  onStatusChange: (status: DraftCanvasSaveStatus) => void
}

function createAutosaveQueue({
  documentId,
  onSaved,
  onSettled,
  onStatusChange,
}: AutosaveQueueOptions) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let failed = false
  let inFlight: Promise<boolean> | null = null
  let latestVersion = 0
  let pendingSave: PendingSave | null = null

  const clearDebounceTimer = () => {
    if (!debounceTimer) return
    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  const startDrain = () => {
    clearDebounceTimer()
    if (inFlight) return inFlight
    if (failed || !pendingSave) return Promise.resolve(!failed)

    const drainPromise = (async () => {
      while (pendingSave && !failed) {
        const saving = pendingSave
        pendingSave = null
        onStatusChange("saving")

        try {
          const savedCanvas = await saveSourceResumeCanvas(
            documentId,
            saving.docJson as unknown as Record<string, unknown>,
          )
          onSaved(savedCanvas)
        } catch {
          const queuedAfterFailure = pendingSave as PendingSave | null
          if (!queuedAfterFailure || queuedAfterFailure.version < saving.version) {
            pendingSave = saving
          }
          failed = true
          onStatusChange("error")
          return false
        }

        clearDebounceTimer()
        if (saving.version === latestVersion && !pendingSave) {
          onSettled()
          onStatusChange("saved")
        }
      }

      return !failed
    })()

    inFlight = drainPromise.finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    enqueue(docJson: ResumeDocJson) {
      latestVersion += 1
      pendingSave = { docJson, version: latestVersion }
      failed = false
      onStatusChange("idle")
      clearDebounceTimer()
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        void startDrain()
      }, AUTOSAVE_DELAY_MS)
    },
    flush() {
      failed = false
      return startDrain()
    },
    hasActivity() {
      return Boolean(pendingSave || inFlight)
    },
    retry() {
      failed = false
      return startDrain()
    },
  }
}

export function useSourceCanvasAutosave(
  documentId: string | undefined,
  onSaved: (canvas: SourceResumeCanvas) => void,
) {
  const [localDocJson, setLocalDocJson] = useState<ResumeDocJson | null>(null)
  const [saveStatus, setSaveStatus] = useState<DraftCanvasSaveStatus>("idle")
  const mountedRef = useRef(false)
  const queueRef = useRef<ReturnType<typeof createAutosaveQueue> | null>(null)

  const queue = useMemo(() => {
    if (!documentId) return null

    const nextQueue = createAutosaveQueue({
      documentId,
      onSaved: (canvas) => {
        if (mountedRef.current && queueRef.current === nextQueue) onSaved(canvas)
      },
      onSettled: () => {
        if (mountedRef.current && queueRef.current === nextQueue) setLocalDocJson(null)
      },
      onStatusChange: (status) => {
        if (mountedRef.current && queueRef.current === nextQueue) setSaveStatus(status)
      },
    })
    return nextQueue
  }, [documentId, onSaved])
  queueRef.current = queue

  useEffect(() => {
    mountedRef.current = true
    setLocalDocJson(null)
    setSaveStatus("idle")

    if (!queue) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!queue.hasActivity()) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)

    return () => {
      mountedRef.current = false
      window.removeEventListener("beforeunload", handleBeforeUnload)
      void queue.flush()
    }
  }, [queue])

  const handleChange = useCallback((change: ResumeEditorChange) => {
    if (!queue) return
    setLocalDocJson(change.docJson)
    queue.enqueue(change.docJson)
  }, [queue])

  const flush = useCallback(() => queue?.flush() ?? Promise.resolve(true), [queue])
  const retry = useCallback(() => {
    void queue?.retry()
  }, [queue])

  return {
    flush,
    handleChange,
    localDocJson,
    retry,
    saveStatus,
  }
}
