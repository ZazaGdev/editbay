/**
 * What is kept with the app's settings rather than with a project: saving
 * automatically, the microphone, the next transition, and the layouts and
 * shape styles saved under a name. Read once as the window opens.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SavedLayout } from '../../shared/saved-layouts'
import type { SavedShape } from '../../shared/shape'
import type { RecordSettings } from '../components/Transport'
import { exportPrefsOf } from '../components/SettingsDialog'
import type { AppLocals, ExportSettings } from './app-state'

export function useAppSettings({ setExportPrefs, lastTextStyle }: Pick<ExportSettings, 'setExportPrefs'> & Pick<AppLocals, 'lastTextStyle'>) {
  /**
   * What the next transition will be: whatever you last left one at, kept with
   * the app's settings so it follows you between projects.
   */
  const [transitionDefaults, setTransitionDefaults] = useState({ seconds: 1, picture: 'dissolve', sound: 'even' })
  /** Whether every cut made from now on gets a transition without being asked. */
  const [transitionOnEveryCut, setTransitionOnEveryCut] = useState(false)
  const [saveAutomatically, setSaveAutomatically] = useState(true)
  /** Which microphone a voice over is recorded from, and whether the sequence is heard meanwhile. */
  const [recordSettings, setRecordSettings] = useState<RecordSettings>({ microphoneId: null, muteWhileRecording: false })
  /** Framings saved under a name, yours rather than the project's: kept with the app's settings. */
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>([])
  const savedLayoutsNow = useRef<SavedLayout[]>([])
  savedLayoutsNow.current = savedLayouts
  /** The layouts changed and kept: shown at once, then as the settings file has them. */
  const storeLayouts = useCallback((next: SavedLayout[]): void => {
    savedLayoutsNow.current = next
    setSavedLayouts(next)
    void window.api.setAppSettings({ savedLayouts: next }).then((s) => {
      savedLayoutsNow.current = s.savedLayouts
      setSavedLayouts(s.savedLayouts)
    })
  }, [])
  /** Shape styles saved under a name, yours rather than the project's: kept with the app's settings. */
  const [savedShapes, setSavedShapes] = useState<SavedShape[]>([])
  const savedShapesNow = useRef<SavedShape[]>([])
  savedShapesNow.current = savedShapes
  const storeShapes = useCallback((next: SavedShape[]): void => {
    savedShapesNow.current = next
    setSavedShapes(next)
    void window.api.setAppSettings({ savedShapes: next }).then((s) => {
      savedShapesNow.current = s.savedShapes
      setSavedShapes(s.savedShapes)
    })
  }, [])

  useEffect(() => {
    void window.api.appSettings().then((s) => {
      setSaveAutomatically(s.saveAutomatically)
      setRecordSettings({ microphoneId: s.microphoneId, muteWhileRecording: s.muteWhileRecording })
      setTransitionDefaults({ seconds: s.transitionSeconds, picture: s.transitionPictureKind, sound: s.transitionSoundKind })
      setTransitionOnEveryCut(s.transitionOnEveryCut)
      setExportPrefs(exportPrefsOf(s))
      setSavedLayouts(s.savedLayouts)
      setSavedShapes(s.savedShapes)
      lastTextStyle.current = s.textStyle
    })
  }, [])

  const changeRecordSettings = useCallback((change: Partial<RecordSettings>) => {
    setRecordSettings((prev) => ({ ...prev, ...change }))
    void window.api
      .setAppSettings(change)
      .then((s) => setRecordSettings({ microphoneId: s.microphoneId, muteWhileRecording: s.muteWhileRecording }))
  }, [])

  /** Remember what a transition was left at, for the next one added. */
  const rememberTransition = useCallback((change: { seconds?: number; picture?: string; sound?: string }) => {
    setTransitionDefaults((was) => ({ ...was, ...change }))
    void window.api.setAppSettings({
      ...(change.seconds === undefined ? {} : { transitionSeconds: change.seconds }),
      ...(change.picture === undefined ? {} : { transitionPictureKind: change.picture }),
      ...(change.sound === undefined ? {} : { transitionSoundKind: change.sound })
    })
  }, [])

  const changeTransitionOnEveryCut = useCallback((on: boolean) => {
    setTransitionOnEveryCut(on)
    void window.api.setAppSettings({ transitionOnEveryCut: on }).then((s) => setTransitionOnEveryCut(s.transitionOnEveryCut))
  }, [])

  const changeSaveAutomatically = useCallback((on: boolean) => {
    setSaveAutomatically(on)
    void window.api.setAppSettings({ saveAutomatically: on }).then((s) => setSaveAutomatically(s.saveAutomatically))
  }, [])

  return {
    transitionDefaults,
    rememberTransition,
    transitionOnEveryCut,
    changeTransitionOnEveryCut,
    saveAutomatically,
    changeSaveAutomatically,
    recordSettings,
    changeRecordSettings,
    savedLayouts,
    savedLayoutsNow,
    storeLayouts,
    savedShapes,
    savedShapesNow,
    storeShapes
  }
}
