/** What the command search offers. */

import type { Command } from '../../shared/commands'
import { ACTIONS, keyLabel, type ActionId } from '../../shared/keymap'
import type { NamedLayout } from '../../shared/layout'
import { PRESETS } from '../../shared/presets'
import { SAFE_ZONE_CHOICES } from '../../shared/safe-zones'
import { allClips, cropOf, findVideoClip, targetAspect, v1Clips } from '../../shared/project'
import { showToast } from '../state/toasts'
import type { AppState } from './app-state'
import { recentCommands } from './palette-recent'

/**
 * Everything the command search offers: every action with its key, and
 * what has no key: exporting every sequence, each shape, each layout,
 * importing, adding or duplicating a sequence, saving automatically, and
 * the safe zones of each app.
 */
export function paletteCommands(app: AppState): Command[] {
  const { timeline, selected, proj, gap, range, selectedTransition, copiedFraming, copiedCrop, selectedClips, marks, keys, run, project, setExportAll,
    setExportOpen, chooseShape, editClip, importPaths, addSequence, canLink, duplicateSequence, transitionOnEveryCut, changeTransitionOnEveryCut,
    saveAutomatically, changeSaveAutomatically, windowSettings, setWindowSettings, recordSettings, changeRecordSettings, setView } = app
  const picture = timeline && selected ? findVideoClip(timeline, selected) : null
  const framed = timeline ? targetAspect(timeline) !== null : false
  const tall = timeline ? timeline.output.height > timeline.output.width && framed : false
  // What the action needs before it can do anything.
  const can: Partial<Record<ActionId, boolean>> = {
    undo: proj.canUndo,
    redo: proj.canRedo,
    deleteClip: selected !== null || gap !== null || range !== null || selectedTransition !== null,
    closeUp: selected !== null || gap !== null || range !== null || selectedTransition !== null,
    removeSilences: timeline !== null && v1Clips(timeline).length > 0,
    copyFraming: picture !== null,
    fitTimeline: timeline !== null && allClips(timeline).length > 0,
    pasteFraming: picture !== null && copiedFraming.current !== null,
    copyCrop: timeline !== null && selected !== null && cropOf(timeline, selected) !== null,
    pasteCrop: timeline !== null && copiedCrop !== null && selectedClips.some((id) => cropOf(timeline, id) !== null),
    clearMarks: range !== null || marks.in !== null || marks.out !== null,
    splitAll: timeline !== null
  }
  const actions: Command[] = ACTIONS.filter((a) => a.id !== 'commandPalette').map((a) => ({
    id: a.id,
    label: a.label,
    ...(a.id === 'showSettings' ? { keywords: ['preferences', 'options'] } : {}),
    key: keyLabel(keys.keymap, a.id),
    group: a.group,
    enabled: can[a.id] ?? true,
    run: () => run(a.id)
  }))
  const layouts: [NamedLayout, string][] = [
    ['single', 'Single'],
    ['split', 'Split'],
    ['pip', 'Picture in picture']
  ]
  return [
    ...actions,
    {
      id: 'exportAll',
      label: 'Export all sequences',
      keywords: ['every', 'video'],
      group: 'Project',
      enabled: (project?.sequences.length ?? 0) > 1,
      run: () => {
        setExportAll(true)
        setExportOpen(true)
      }
    },
    ...PRESETS.map((p) => ({
      id: `shape:${p.id}`,
      label: `Change the shape to ${p.name}`,
      keywords: ['sequence', p.id],
      group: 'View',
      enabled: timeline !== null && timeline.presetId !== p.id,
      run: () => chooseShape(p.id)
    })),
    ...layouts.map(([kind, name]) => ({
      id: `layout:${kind}`,
      label: `Lay out the clip as ${name}`,
      keywords: ['layout', 'pictures'],
      group: 'Editing',
      enabled: picture !== null && framed,
      run: () => selected && editClip({ kind: 'applyLayout', clipId: selected, layout: kind })
    })),
    {
      id: 'importFiles',
      label: 'Import files',
      keywords: ['add', 'recordings', 'sources'],
      group: 'Project',
      run: () => void window.api.pickFiles().then(importPaths)
    },
    {
      id: 'addSequence',
      label: 'Add a sequence',
      keywords: ['new', 'tab'],
      group: 'Project',
      run: () => timeline && addSequence(timeline.presetId)
    },
    {
      id: 'link',
      label: 'Link the selected clips',
      keywords: ['join', 'group', 'sound', 'picture', 'relink'],
      group: 'Editing',
      enabled: selected !== null && canLink(selected),
      run: () => editClip({ kind: 'link', clipIds: selectedClips })
    },
    { id: 'duplicateSequence', label: 'Duplicate this sequence', keywords: ['copy', 'tab'], group: 'Project', run: duplicateSequence },
    {
      id: 'transitionOnEveryCut',
      label: 'Put a transition on every cut',
      keywords: ['automatic', 'dissolve', 'crossfade', 'setting'],
      group: 'Editing',
      on: transitionOnEveryCut,
      run: () => {
        const on = !transitionOnEveryCut
        changeTransitionOnEveryCut(on)
        showToast({
          kind: 'transitionOnEveryCut',
          text: on
            ? 'Every cut made from now on gets a transition, except a plain split, where the footage carries straight on. The cuts already there are left alone.'
            : 'Cuts are plain cuts again.'
        })
      }
    },
    {
      id: 'saveAutomatically',
      label: 'Save automatically',
      keywords: ['autosave', 'setting'],
      group: 'Project',
      on: saveAutomatically,
      run: () => {
        changeSaveAutomatically(!saveAutomatically)
        showToast({
          kind: 'saveAutomatically',
          text: saveAutomatically ? 'No longer saving automatically.' : 'Saving automatically from now on.'
        })
      }
    },
    ...(['cards', 'list', 'grid'] as const).map((v) => ({
      id: `binView:${v}`,
      label: v === 'cards' ? 'Show the sources as cards' : v === 'list' ? 'Show the sources as a list' : 'Show the sources as a grid',
      keywords: ['bin', 'source', 'view', 'icons'],
      group: 'View',
      enabled: windowSettings.binView !== v,
      run: () => setWindowSettings({ binView: v })
    })),
    {
      id: 'overview',
      label: 'Show the ALL strip',
      keywords: ['overview', 'whole', 'edit', 'timeline', 'setting'],
      group: 'View',
      on: windowSettings.overview,
      run: () => setWindowSettings({ overview: !windowSettings.overview })
    },
    {
      id: 'placeSnap',
      label: 'Snap pictures on the Output view',
      keywords: ['snap', 'place', 'align', 'lines', 'corner', 'picture in picture', 'setting'],
      group: 'View',
      on: windowSettings.placeSnap,
      run: () => setWindowSettings({ placeSnap: !windowSettings.placeSnap })
    },
    {
      id: 'clipKeys',

      label: 'Show zoom keyframes on clips',
      keywords: ['diamonds', 'keyframes', 'zoom', 'timeline', 'setting'],
      group: 'View',
      on: windowSettings.clipKeys,
      run: () => setWindowSettings({ clipKeys: !windowSettings.clipKeys })
    },
    {
      id: 'snapping',
      label: 'Snap on the timeline',
      keywords: ['snap', 'magnet', 'align', 'timeline', 'setting'],
      group: 'View',
      on: windowSettings.snapping,
      run: () => setWindowSettings({ snapping: !windowSettings.snapping })
    },
    {
      id: 'skim',
      label: 'Show the frame under the pointer',
      keywords: ['skim', 'hover', 'timeline', 'setting'],
      group: 'View',
      on: windowSettings.skim,
      run: () => setWindowSettings({ skim: !windowSettings.skim })
    },
    {
      id: 'sideBySide',
      label: 'Show Source and Output side by side',
      keywords: ['monitor', 'views', 'vertical', 'setting'],
      group: 'View',
      on: windowSettings.sideBySide,
      run: () => setWindowSettings({ sideBySide: !windowSettings.sideBySide })
    },
    {
      id: 'muteWhileRecording',
      label: 'Mute the sequence while recording',
      keywords: ['voice', 'over', 'headphones', 'setting'],
      group: 'Playback',
      on: recordSettings.muteWhileRecording,
      run: () => changeRecordSettings({ muteWhileRecording: !recordSettings.muteWhileRecording })
    },
    ...SAFE_ZONE_CHOICES.map((c) => ({
      id: `safeZone:${c.id}`,
      label: c.id === 'none' ? 'Hide the safe zones' : `Show the safe zones for ${c.id === 'all' ? 'all three apps' : c.name}`,
      keywords: ['guides', 'safe', 'vertical'],
      group: 'View',
      // They are drawn over the Output view of a vertical frame only.
      enabled: c.id === 'none' || tall,
      run: () => {
        if (c.id === 'none') return setWindowSettings({ safeZone: 'none' })
        // Turned on with just this, as the Guides menu does while the guides are off.
        setWindowSettings(windowSettings.guides ? { safeZone: c.id } : { guides: true, safeZone: c.id, thirds: false })
        setView('program')
      }
    })),
    ...recentCommands(app)
  ]
}
