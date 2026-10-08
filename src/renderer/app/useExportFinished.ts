/**
 * An export finishing: said in a notice when its dialog is closed, its file
 * shown when Settings asks for that, and its result let go once the sequence
 * changes after it.
 */

import { useCallback, useEffect, useRef } from 'react'
import { sequenceOf } from '../../shared/project'
import { showToast } from '../state/toasts'
import type { AppLocals, ExportSettings } from './app-state'

export function useExportFinished({
  project,
  sequenceId,
  exportRun,
  exportOpen,
  setExportOpen,
  exportPrefs
}: Pick<AppLocals, 'project' | 'sequenceId' | 'exportRun' | 'exportOpen' | 'setExportOpen'> & Pick<ExportSettings, 'exportPrefs'>): void {
  // What an export wrote stays until the sequence changes after it finished:
  // then it describes a cut that is no longer the one on screen. Edits made
  // while it ran do not count, or closing the dialog to carry on working would
  // lose the result. A failure is never cleared this way: it stays until the
  // next export, so it is always seen. A sequence that did not change is the
  // object it was; one that is a new object is compared as text, and only
  // while there is a result to keep, not on every edit (audit 2026-10-01).
  const sequenceNow = project ? sequenceOf(project, sequenceId) : null
  const { running: exportRunning, clearDone: clearExportDone } = exportRun
  const exportOpenNow = useRef(exportOpen)
  exportOpenNow.current = exportOpen
  const exportResult = useRef(exportRun)
  exportResult.current = exportRun
  const showAfterExportNow = useRef(false)
  showAfterExportNow.current = exportPrefs.showAfterExport
  const announceExport = useCallback(() => {
    const r = exportResult.current
    const text = r.done
      ? r.done.length === 1
        ? `Exported ${r.done[0]!.split(/[\\/]/).pop()}`
        : `Exported ${r.done.length} files`
      : r.cancelled
        ? 'Export cancelled'
        : 'The export failed'
    showToast({ kind: 'export', text, sticky: true, action: { label: 'Show', run: () => setExportOpen(true) } })
  }, [])
  const finishedWith = useRef<{ sequence: ReturnType<typeof sequenceOf> | null; text: string } | null>(null)
  const wasRunning = useRef(false)
  useEffect(() => {
    if (exportRunning) {
      wasRunning.current = true
      return
    }
    if (wasRunning.current) {
      wasRunning.current = false
      finishedWith.current = { sequence: sequenceNow, text: JSON.stringify(sequenceNow) }
      const first = exportResult.current.done?.[0]
      if (first && showAfterExportNow.current) void window.api.revealPath(first)
      // Finished while the dialog was closed: say so, and offer the way back to it.
      if (!exportOpenNow.current) announceExport()
      return
    }
    const finished = finishedWith.current
    if (finished === null || finished.sequence === sequenceNow) return
    if (finished.text === JSON.stringify(sequenceNow)) {
      finishedWith.current = { ...finished, sequence: sequenceNow }
      return
    }
    finishedWith.current = null
    clearExportDone()
  }, [sequenceNow, exportRunning, clearExportDone])
}
