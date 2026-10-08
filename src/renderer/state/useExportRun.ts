import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExportProgress, ExportRequest, ExportResult } from '../../shared/types'
import { estimateRemaining, formatRemaining, smoothRemaining } from '../../shared/progress'

/**
 * The export that is running, or last ran. Kept above the Export dialog, so
 * closing the dialog leaves it running and the top bar can show how far it has got.
 */
export interface ExportRun {
  running: boolean
  progress: ExportProgress | null
  /** Time left in words, once there is enough to go on. */
  remaining: string | null
  /** Every file the last export wrote. */
  done: string[] | null
  /** What went wrong with the last one, in plain words. */
  error: string | null
  /** ffmpeg's own words about it. */
  details: string | null
  /** The last one was stopped because you asked. */
  cancelled: boolean
  /** Something to know about the last one that finished, such as a transcript not written. */
  notes: string[]
  /** Task 47: the credits the finished video needs, none when empty; null before one has finished. */
  credits: string[] | null
  start: (request: ExportRequest) => Promise<void>
  cancel: () => void
  /** Forget what the last export wrote, as when the sequence changes after it. A failure is kept. */
  clearDone: () => void
}

export function useExportRun(): ExportRun {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [remaining, setRemaining] = useState<string | null>(null)
  const [done, setDone] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  /** Task 47: the credits the finished video's description needs, none when empty; null before one has finished. */
  const [credits, setCredits] = useState<string[] | null>(null)
  // When it started, and the last estimate and when it was made, for smoothing.
  const clock = useRef<{ started: number; estimate: number | null; at: number } | null>(null)

  useEffect(
    () =>
      window.api.onExportProgress((p) => {
        setProgress(p)
        const c = clock.current
        if (!c || p.stage === 'done' || p.stage === 'failed' || p.stage === 'cancelled') return
        const now = Date.now()
        const estimate = smoothRemaining(c.estimate, estimateRemaining(p.fraction, now - c.started), (now - c.at) / 1000)
        clock.current = { started: c.started, estimate, at: now }
        setRemaining(formatRemaining(estimate))
      }),
    []
  )

  // Set at once, not at the next render, so a second click never starts a second export.
  const going = useRef(false)

  const start = useCallback(async (request: ExportRequest) => {
    if (going.current) return
    going.current = true
    setRunning(true)
    setDone(null)
    setError(null)
    setDetails(null)
    setCancelled(false)
    setNotes([])
    setCredits(null)
    setRemaining(null)
    setProgress({ stage: 'segment', fraction: 0 })
    const now = Date.now()
    clock.current = { started: now, estimate: null, at: now }
    // A start refused outright, rather than an export that failed, still lets go of the button.
    const result: ExportResult = await window.api.startExport(request).catch((err: unknown) => ({
      ok: false,
      outputs: [],
      error: `The export could not start: ${err instanceof Error ? err.message : String(err)}`
    }))
    going.current = false
    clock.current = null
    setRunning(false)
    setRemaining(null)
    // Files finished before a failure or a cancel are there all the same, so they are listed.
    setDone(result.outputs.length > 0 ? result.outputs : null)
    setNotes(result.notes ?? [])
    setCredits(result.ok ? (result.credits ?? []) : null)
    if (result.cancelled) setCancelled(true)
    else if (!result.ok) {
      setError(result.error ?? 'The export failed.')
      setDetails(result.details ?? null)
    }
  }, [])

  const cancel = useCallback(() => void window.api.cancelExport(), [])
  const clearDone = useCallback(() => {
    setDone(null)
    setCancelled(false)
    setNotes([])
    setCredits(null)
  }, [])

  return { running, progress, remaining, done, error, details, cancelled, notes, credits, start, cancel, clearDone }
}
