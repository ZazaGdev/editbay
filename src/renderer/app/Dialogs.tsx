/**
 * The windows opened over the editor from the top bar and the keys: Make
 * captions, the tutorials, Settings and the shortcuts.
 */

import type { JSX } from 'react'
import { findClip, marksOf, sequenceOf } from '../../shared/project'
import { mergeStretches } from '../../shared/captions'
import { spanEnd } from '../../shared/tracks'
import { CaptionsDialog } from '../components/CaptionsDialog'
import { TutorialsDialog } from '../components/TutorialsDialog'
import { SettingsDialog } from '../components/SettingsDialog'
import { ShortcutsDialog } from '../components/ShortcutsDialog'
import type { AppState } from './app-state'

export function Dialogs({ app }: { app: AppState }): JSX.Element {
  const { captionsOpen, timeline, project, speech, captionsError, listenForCaptions, sequenceId, setCaptionsOpen, setCaptionsScope, selectedClips,
    captionsScope, tutorialsOpen, setTutorialsOpen, settingsOpen, saveAutomatically, changeSaveAutomatically, windowSettings, setWindowSettings,
    exportPrefs, changeExportPrefs, setSettingsOpen, setShortcutsOpen, transitionOnEveryCut, changeTransitionOnEveryCut, transitionDefaults,
    rememberTransition, recordSettings, changeRecordSettings, shortcutsOpen, keys, savedShapes, storeShapes, select, selectCaption, stateNow, setView, seek } = app
  return (
    <>
      {captionsOpen && timeline && project && (
        <CaptionsDialog
          timeline={timeline}
          speech={speech}
          error={captionsError}
          onListen={(listenTo, stretches) => void listenForCaptions(sequenceOf(project, sequenceId).id, listenTo, stretches)}
          onClose={() => {
            setCaptionsOpen(false)
            setCaptionsScope(undefined)
          }}
          selection={mergeStretches(
            selectedClips.flatMap((id) => {
              const found = findClip(timeline, id)
              return found ? [{ from: found.clip.timelineStart, to: spanEnd(found.clip) }] : []
            })
          )}
          marked={(() => {
            const m = marksOf(timeline)
            return m.in !== null && m.out !== null && m.out > m.in ? { from: m.in, to: m.out } : null
          })()}
          scope={captionsScope}
        />
      )}

      {tutorialsOpen !== false && (
        <TutorialsDialog
          key={String(tutorialsOpen)}
          at={typeof tutorialsOpen === 'string' ? tutorialsOpen : undefined}
          pick={{ playhead: () => stateNow.current.playhead, selectClip: (id) => select(id),
            selectCaption,
            toOutput: (frame) => {
              setView('program')
              if (frame !== undefined) seek(frame)
            }
          }}
          onClose={() => setTutorialsOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          saveAutomatically={saveAutomatically}
          onSaveAutomatically={changeSaveAutomatically}
          overview={windowSettings.overview}
          skim={windowSettings.skim}
          lighterCopies={windowSettings.lighterCopies}
          snapping={windowSettings.snapping}
          sideBySide={windowSettings.sideBySide}
          safeZone={windowSettings.safeZone}
          silence={windowSettings.silence}
          onWindow={setWindowSettings}
          exportPrefs={exportPrefs}
          onExportPrefs={changeExportPrefs}
          guides={windowSettings.guides}
          thirds={windowSettings.thirds}
          binView={windowSettings.binView}
          onShortcuts={() => {
            setSettingsOpen(false)
            setShortcutsOpen(true)
          }}
          transitionOnEveryCut={transitionOnEveryCut}
          onTransitionOnEveryCut={changeTransitionOnEveryCut}
          transition={transitionDefaults}
          onTransition={rememberTransition}
          record={recordSettings}
          onRecord={changeRecordSettings}
          savedShapes={savedShapes}
          theme={windowSettings.theme}
          onSavedShapes={storeShapes}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {shortcutsOpen && (
        <ShortcutsDialog
          overrides={keys.overrides}
          keymap={keys.keymap}
          onChange={keys.update}
          onClose={() => setShortcutsOpen(false)}
        />
      )}
    </>
  )
}
