/**
 * The bar along the top of the window, wired to the App: the project's name,
 * the file and edit buttons, and the export and captions under way.
 */

import type { JSX } from 'react'
import { TopBar } from '../components/TopBar'
import { withKey } from '../../shared/keymap'
import type { AppState } from './app-state'

export function AppTopBar({
  app,
  versionsAsked,
  exportLabel
}: {
  app: AppState
  versionsAsked: number
  exportLabel: string | null
}): JSX.Element {
  const { status, keys, proj, saveAutomatically, changeSaveAutomatically, ffmpeg, save, undo, speech } = app
  const { setShortcutsOpen, setTutorialsOpen, setSettingsOpen, setPaletteOpen, setExportOpen, setCaptionsOpen } = app
  return (
    <TopBar
      name={status?.name ?? ''}
      changed={status?.changed ?? false}
      keymap={keys.keymap}
      canUndo={proj.canUndo}
      canRedo={proj.canRedo}
      saveAutomatically={saveAutomatically}
      exportLabel={exportLabel}
      ffmpeg={ffmpeg.ok ? ffmpeg.message : `unusable: ${ffmpeg.message}`}
      onNew={proj.newProject}
      onOpen={() => proj.open()}
      onOpenRecent={(path) => proj.open(path)}
      versionsAsked={versionsAsked}
      onSave={() => save(false)}
      onSaveAs={() => save(true)}
      onRename={(name) => void window.api.renameProject(name)}
      onSaveAutomatically={changeSaveAutomatically}
      onUndo={undo}
      onRedo={proj.redo}
      onShortcuts={() => setShortcutsOpen(true)}
      onTutorials={() => setTutorialsOpen(true)}
      onSettings={() => setSettingsOpen(true)}
      onSearch={() => setPaletteOpen(true)}
      onExport={() => setExportOpen(true)}
      exportTitle={withKey('Export the sequence as a video', keys.keymap, 'export')}
      onCaptions={() => setCaptionsOpen(true)}
      captionsLabel={
        speech.downloading
          ? `Speech model ${Math.round(speech.downloadFraction * 100)}%`
          : speech.transcribing
            ? `Captions ${Math.round(speech.transcribeFraction * 100)}%`
            : null
      }
      captionsTitle={withKey('Make captions from the speech', keys.keymap, 'makeCaptions')}
    />
  )
}
