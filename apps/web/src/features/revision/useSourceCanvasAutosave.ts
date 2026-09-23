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

type AutosaveSnapshot = {
  documentId?: string
  latestSavedCanvas: SourceResumeCanvas | null
  localDocJson: ResumeDocJson | null
  saveError: string | null
  saveStatus: DraftCanvasSaveStatus
}

const emptySnapshot: AutosaveSnapshot = {
  latestSavedCanvas: null,
  localDocJson: null,
  saveError: null,
  saveStatus: "idle",
}

const coordinatorRegistry = new Map<string, SourceCanvasAutosaveCoordinator>()

export function __hasSourceCanvasAutosaveCoordinatorForTests(documentId: string) {
  return coordinatorRegistry.has(documentId)
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (![...coordinatorRegistry.values()].some((coordinator) => coordinator.hasUnsavedChanges())) return
    event.preventDefault()
    event.returnValue = ""
  })
}

class SourceCanvasAutosaveCoordinator {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private failed = false
  private inFlight: Promise<boolean> | null = null
  private latestLocalDocJson: ResumeDocJson | null = null
  private latestSavedCanvas: SourceResumeCanvas | null = null
  private latestVersion = 0
  private listeners = new Set<(snapshot: AutosaveSnapshot) => void>()
  private pendingSave: PendingSave | null = null
  private saveError: string | null = null
  private saveStatus: DraftCanvasSaveStatus = "idle"

  constructor(private readonly documentId: string) {}

  getSnapshot(): AutosaveSnapshot {
    return {
      documentId: this.documentId,
      latestSavedCanvas: this.latestSavedCanvas,
      localDocJson: this.latestLocalDocJson,
      saveError: this.saveError,
      saveStatus: this.saveStatus,
    }
  }

  subscribe(listener: (snapshot: AutosaveSnapshot) => void) {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.listeners.delete(listener)
      this.schedulePrune()
    }
  }

  scheduleInitialPrune() {
    setTimeout(() => this.pruneIfIdle(), 0)
  }

  enqueue(docJson: ResumeDocJson) {
    this.latestVersion += 1
    this.latestLocalDocJson = docJson
    this.pendingSave = { docJson, version: this.latestVersion }
    this.failed = false
    this.saveError = null
    this.saveStatus = "idle"
    this.clearDebounceTimer()
    this.notify()
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.drain()
    }, AUTOSAVE_DELAY_MS)
  }

  flush() {
    return this.drain()
  }

  hasUnsavedChanges() {
    return Boolean(this.latestLocalDocJson || this.pendingSave || this.inFlight || this.failed)
  }

  retry() {
    this.failed = false
    this.saveError = null
    this.saveStatus = "idle"
    this.notify()
    return this.drain()
  }

  private clearDebounceTimer() {
    if (!this.debounceTimer) return
    clearTimeout(this.debounceTimer)
    this.debounceTimer = null
  }

  private drain() {
    this.clearDebounceTimer()
    if (this.inFlight) return this.inFlight
    if (this.failed || !this.pendingSave) return Promise.resolve(!this.failed)

    const drainPromise = (async () => {
      while (this.pendingSave && !this.failed) {
        const saving = this.pendingSave
        this.pendingSave = null
        this.saveStatus = "saving"
        this.notify()

        try {
          const savedCanvas = await saveSourceResumeCanvas(
            this.documentId,
            saving.docJson as unknown as Record<string, unknown>,
          )
          this.latestSavedCanvas = savedCanvas
          this.saveError = null
          this.notify()
        } catch (error) {
          const queuedAfterFailure = this.pendingSave as PendingSave | null
          if (!queuedAfterFailure || queuedAfterFailure.version < saving.version) {
            this.pendingSave = saving
          }
          this.failed = true
          this.saveError = error instanceof Error ? error.message : "未知保存错误"
          this.saveStatus = "error"
          this.notify()
          return false
        }

        this.clearDebounceTimer()
        if (saving.version === this.latestVersion && !this.pendingSave) {
          this.latestLocalDocJson = null
          this.saveStatus = "saved"
          this.notify()
        }
      }

      return !this.failed
    })()

    this.inFlight = drainPromise.finally(() => {
      this.inFlight = null
      this.schedulePrune()
    })
    return this.inFlight
  }

  private notify() {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  private schedulePrune() {
    queueMicrotask(() => this.pruneIfIdle())
  }

  private pruneIfIdle() {
    if (
      this.listeners.size === 0
      && !this.pendingSave
      && !this.inFlight
      && !this.failed
      && !this.latestLocalDocJson
      && coordinatorRegistry.get(this.documentId) === this
    ) {
      coordinatorRegistry.delete(this.documentId)
    }
  }
}

function getSourceCanvasAutosaveCoordinator(documentId: string) {
  const existingCoordinator = coordinatorRegistry.get(documentId)
  if (existingCoordinator) return existingCoordinator
  const coordinator = new SourceCanvasAutosaveCoordinator(documentId)
  coordinatorRegistry.set(documentId, coordinator)
  coordinator.scheduleInitialPrune()
  return coordinator
}

export function useSourceCanvasAutosave(
  documentId: string | undefined,
  onSaved: (canvas: SourceResumeCanvas) => void,
) {
  const coordinator = useMemo(
    () => documentId ? getSourceCanvasAutosaveCoordinator(documentId) : null,
    [documentId],
  )
  const [snapshotState, setSnapshotState] = useState<AutosaveSnapshot>(
    () => coordinator?.getSnapshot() ?? emptySnapshot,
  )
  const deliveredSavedCanvasRef = useRef<SourceResumeCanvas | null>(null)
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved

  useEffect(() => {
    if (!coordinator) {
      setSnapshotState(emptySnapshot)
      return
    }

    const unsubscribe = coordinator.subscribe((snapshot) => {
      setSnapshotState(snapshot)
      if (snapshot.latestSavedCanvas && deliveredSavedCanvasRef.current !== snapshot.latestSavedCanvas) {
        deliveredSavedCanvasRef.current = snapshot.latestSavedCanvas
        onSavedRef.current(snapshot.latestSavedCanvas)
      }
    })
    return () => {
      unsubscribe()
      void coordinator.flush()
    }
  }, [coordinator])

  const snapshot = snapshotState.documentId === documentId
    ? snapshotState
    : coordinator?.getSnapshot() ?? emptySnapshot

  const handleChange = useCallback((change: ResumeEditorChange) => {
    coordinator?.enqueue(change.docJson)
  }, [coordinator])
  const flush = useCallback(() => coordinator?.flush() ?? Promise.resolve(true), [coordinator])
  const retry = useCallback(() => {
    void coordinator?.retry()
  }, [coordinator])

  return {
    flush,
    handleChange,
    latestSavedCanvas: snapshot.latestSavedCanvas,
    localDocJson: snapshot.localDocJson,
    retry,
    saveError: snapshot.saveError,
    saveStatus: snapshot.saveStatus,
  }
}
