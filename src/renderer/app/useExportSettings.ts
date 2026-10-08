/**
 * How the project exports: its folder, mode, names and files, kept with the
 * workspace, and how you like exports to go, from Settings.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_FILENAME_PATTERN, type ExportMode } from '../../shared/workspace'
import { exportPrefsOf, type ExportPrefs } from '../components/SettingsDialog'
import type { AppLocals } from './app-state'

export function useExportSettings({ exportOpen }: Pick<AppLocals, 'exportOpen'>) {
  const [exportFolder, setExportFolder] = useState<string | null>(null)
  const [exportMode, setExportMode] = useState<ExportMode>('join')
  const [exportPattern, setExportPattern] = useState(DEFAULT_FILENAME_PATTERN)
  const [exportSubtitles, setExportSubtitles] = useState(false)
  const [exportTranscript, setExportTranscript] = useState(false)
  const [exportSharpen, setExportSharpen] = useState(false)
  const [exportFast, setExportFast] = useState(false)
  /** The name typed for each sequence's one video, by the sequence's id. */
  const [exportFileNames, setExportFileNames] = useState<Record<string, string>>({})
  /** How you like exports to go, from Settings: the start for a project that has never exported. */
  const [exportPrefs, setExportPrefs] = useState<ExportPrefs>({
    exportFolder: null,
    exportMode: 'join',
    exportPattern: DEFAULT_FILENAME_PATTERN,
    exportExisting: 'ask',
    showAfterExport: false
  })

  const changeExportPrefs = useCallback((change: Partial<ExportPrefs>) => {
    setExportPrefs((was) => ({ ...was, ...change }))
    void window.api.setAppSettings(change).then((s) => setExportPrefs(exportPrefsOf(s)))
  }, [])

  // A project that has never been exported starts from how you like exports
  // to go. One that has keeps what it used: its folder is set by its first
  // export, and its mode and names are its own from then on. Only as the
  // window opens, so a change made in it is never undone.
  const exportUntouched = exportFolder === null && exportMode === 'join' && exportPattern === DEFAULT_FILENAME_PATTERN
  const exportUntouchedNow = useRef(exportUntouched)
  exportUntouchedNow.current = exportUntouched
  const exportPrefsNow = useRef(exportPrefs)
  exportPrefsNow.current = exportPrefs
  useEffect(() => {
    if (!exportOpen || !exportUntouchedNow.current) return
    setExportMode(exportPrefsNow.current.exportMode)
    setExportPattern(exportPrefsNow.current.exportPattern)
  }, [exportOpen])

  return {
    exportFolder,
    setExportFolder,
    exportMode,
    setExportMode,
    exportPattern,
    setExportPattern,
    exportSubtitles,
    setExportSubtitles,
    exportTranscript,
    setExportTranscript,
    exportSharpen,
    setExportSharpen,
    exportFast,
    setExportFast,
    exportFileNames,
    setExportFileNames,
    exportPrefs,
    setExportPrefs,
    changeExportPrefs
  }
}
