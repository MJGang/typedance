import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SourceResumeCanvas } from "@typedance/contracts"
import { saveSourceResumeCanvas } from "@/api"
import { assertAccountSession, captureAccountSession, type CapturedAccountSession } from "@/accountSession"
import { clearDuplicateCanvasNodeIds } from "../workspace/editor"
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
  return coordinatorRegistry.has(`${captureAccountSession().epoch}:${documentId}`)
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (![...coordinatorRegistry.values()].some((coordinator) => coordinator.hasUnsavedChanges())) return
    event.preventDefault()
    event.returnValue = ""
  })
}

class SourceCanvasAutosaveCoordinator {
  private disposed = false
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

  constructor(private readonly documentId: string, private readonly session: CapturedAccountSession, private readonly registryKey: string) {
    session.signal.addEventListener("abort", () => this.dispose(), { once: true })
  }

  private dispose() {
    this.disposed = true
    this.clearDebounceTimer()
    this.pendingSave = null
    this.latestLocalDocJson = null
    this.latestSavedCanvas = null
    this.listeners.clear()
    coordinatorRegistry.delete(this.registryKey)
  }

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
    if (this.disposed) return
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

  flush(retryFailed = false) {
    return retryFailed && this.failed ? this.retry() : this.drain()
  }

  hasUnsavedChanges() {
    return Boolean(this.latestLocalDocJson || this.pendingSave || this.inFlight || this.failed)
  }

  retry() {
    if (this.pendingSave) {
      const docJson = clearDuplicateCanvasNodeIds(this.pendingSave.docJson)
      this.pendingSave = { ...this.pendingSave, docJson }
      this.latestLocalDocJson = docJson
    }
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
    if (this.disposed) return Promise.resolve(false)
    if (this.inFlight) return this.inFlight
    if (this.failed || !this.pendingSave) return Promise.resolve(!this.failed)

    const drainPromise = (async () => {
      while (this.pendingSave && !this.failed) {
        const saving = this.pendingSave
        this.pendingSave = null
        this.saveStatus = "saving"
        this.notify()

        try {
          assertAccountSession(this.session)
          const savedCanvas = await saveSourceResumeCanvas(
            this.documentId,
            saving.docJson as unknown as Record<string, unknown>,
          )
          if (this.disposed) return false
          this.latestSavedCanvas = savedCanvas
          this.saveError = null
          this.notify()
        } catch (error) {
          if (this.disposed) return false
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
      && coordinatorRegistry.get(this.registryKey) === this
    ) {
      coordinatorRegistry.delete(this.registryKey)
    }
  }
}

function getSourceCanvasAutosaveCoordinator(documentId: string) {
  const session = captureAccountSession()
  const registryKey = `${session.epoch}:${documentId}`
  const existingCoordinator = coordinatorRegistry.get(registryKey)
  if (existingCoordinator) return existingCoordinator
  const coordinator = new SourceCanvasAutosaveCoordinator(documentId, session, registryKey)
  coordinatorRegistry.set(registryKey, coordinator)
  coordinator.scheduleInitialPrune()
  return coordinator
}

export function flushSourceCanvasSaves(documentId: string): Promise<boolean> {
  return coordinatorRegistry.get(`${captureAccountSession().epoch}:${documentId}`)?.flush() ?? Promise.resolve(true)
}

export async function flushAllSourceCanvasSaves(): Promise<boolean> {
  const results = await Promise.all([...coordinatorRegistry.values()].map((coordinator) => coordinator.flush()))
  return results.every(Boolean)
}

/** The locking screen owns retries while the editor and its retry control are hidden. */
export async function retryAllSourceCanvasSaves(): Promise<boolean> {
  const results = await Promise.all([...coordinatorRegistry.values()].map((coordinator) => coordinator.flush(true)))
  return results.every(Boolean)
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
