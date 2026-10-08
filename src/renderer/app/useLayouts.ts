/**
 * Framings and saved layouts: a framing given to the selected clips, kept
 * under a name, picked with a shape from the shape list, and the actions of
 * the Saved layouts row.
 */

import { useMemo, useRef } from 'react'
import {
  MAX_SAVED_LAYOUTS,
  cleanLayoutName,
  layoutNamed,
  layoutShape,
  removeLayout,
  renameLayout,
  restoreLayout,
  saveLayout,
  updateLayout,
  type SavedLayout
} from '../../shared/saved-layouts'
import type { SavedLayoutActions } from '../components/SavedLayouts'
import { findVideoClip, framingOf, framingRefusal, isStill, pictureAt, sequenceOf, shapeName, type Framing } from '../../shared/project'
import { PRESETS } from '../../shared/presets'
import { showToast } from '../state/toasts'
import type { AppLocals, AppSettings, EditClip, Selecting } from './app-state'

export function rememberShape(presetId: string): void {
  if (PRESETS.some((p) => p.id === presetId && p.width !== null)) void window.api.setAppSettings({ lastShape: presetId })
}

export function useLayouts({
  project,
  proj,
  timeline,
  selected,
  playhead,
  sequenceId,
  phase,
  undo,
  selectedClips,
  editClip,
  savedLayouts,
  savedLayoutsNow,
  storeLayouts
}: Pick<AppLocals, 'project' | 'proj' | 'timeline' | 'selected' | 'playhead' | 'sequenceId' | 'phase' | 'undo'> &
  Pick<Selecting, 'selectedClips'> &
  Pick<EditClip, 'editClip'> &
  Pick<AppSettings, 'savedLayouts' | 'savedLayoutsNow' | 'storeLayouts'>) {
  /**
   * A framing given to every selected picture clip, as one edit, the way Paste
   * framing gives it: refused with the reason when any of them cannot take it.
   */
  function applyFraming(framing: Framing, none: string): boolean {
    const onto = timeline ? selectedClips.filter((id) => findVideoClip(timeline, id)) : []
    if (onto.length === 0) {
      showToast({ kind: 'framing', text: none })
      return false
    }
    const refused = timeline ? onto.map((id) => framingRefusal(timeline, id, framing)).find((r) => r !== null) : null
    if (refused) {
      showToast({ kind: 'refused', text: refused })
      return false
    }
    // One edit for all of them: a continuing run would be replayed from
    // the document before it began, so each paste would undo the last.
    editClip(onto.length === 1 ? { kind: 'setFraming', clipId: onto[0]!, framing } : { kind: 'setFramingOn', clipIds: onto, framing })
    return true
  }

  /** The selected clip's framing, to save, or null with a word to say why not. */
  const framingToSave = (): Framing | null => {
    const framing = timeline && selected ? framingOf(timeline, selected) : null
    if (!framing) showToast({ kind: 'layout', text: 'Select a picture clip to save its framing.' })
    return framing
  }

  /** A framing kept under a name: a new layout, or the one of that name updated. */
  function saveFramingAs(name: string, framing: Framing): void {
    const had = layoutNamed(savedLayoutsNow.current, name)
    if (!had && savedLayoutsNow.current.length >= MAX_SAVED_LAYOUTS) {
      showToast({ kind: 'refused', text: `You can keep ${MAX_SAVED_LAYOUTS} layouts. Delete one to save another.` })
      return
    }
    storeLayouts(saveLayout(savedLayoutsNow.current, name, framing))
    showToast({ kind: 'layout', text: had ? `Updated the layout "${had.name}".` : `Saved the layout "${cleanLayoutName(name)}". Click it to give any clip this framing.` })
  }

  /** The saved layouts that carry a shape, offered in the shape list. */
  const shapeSetups = useMemo(
    () =>
      savedLayouts.flatMap((l) => {
        const presetId = layoutShape(l)
        return presetId === null ? [] : [{ id: l.id, name: l.name, presetId }]
      }),
    [savedLayouts]
  )

  /**
   * A shape chosen: the sequence takes it, and a new project will start on it.
   * Not Handoff, which writes a file per clip for another tool: a project is
   * started for that on purpose, never by a leftover choice.
   */
  function chooseShape(presetId: string): void {
    editClip({ kind: 'setShape', presetId })
    rememberShape(presetId)
  }

  /**
   * A saved layout picked from the shape list: the sequence takes its shape,
   * and every recording clip in it its framing, as one undo step. Pictures,
   * texts and black screens keep theirs, and a clip that cannot take it is
   * left as it was and counted.
   */
  function pickSetup(id: string): void {
    const layout = savedLayoutsNow.current.find((l) => l.id === id)
    const presetId = layout ? layoutShape(layout) : null
    if (!project || !timeline || !layout || presetId === null || phase.current !== null) return
    const recordings = timeline.videoTracks
      .flatMap((r) => r.clips)
      .filter((c) => {
        const m = timeline.media.find((x) => x.id === c.mediaId)
        return m !== undefined && !isStill(m)
      })
      .map((c) => c.id)
    const onto = recordings.filter((clipId) => framingRefusal(timeline, clipId, layout.framing) === null)
    const skipped = recordings.length - onto.length
    const at = proj.step()
    const done = proj.edit({ kind: 'applySetup', sequenceId: sequenceOf(project, sequenceId).id, presetId, clipIds: onto, framing: layout.framing })
    rememberShape(presetId)
    const clips = onto.length === 1 ? '1 clip' : `${onto.length} clips`
    const text =
      `Set up as "${layout.name}": ${shapeName(presetId)}` +
      (onto.length > 0 ? `, with its framing on ${clips}.` : '.') +
      (skipped > 0 ? ` ${skipped === 1 ? '1 clip keeps' : `${skipped} clips keep`} its own framing: a side by side layout needs a recording with two views.` : '')
    void done.then(() => proj.step() !== at && showToast({ kind: 'layout', text, undo }))
  }

  /** Save current as... in the shape list: the selected clip's framing, or the one under the playhead. */
  function saveSetup(name: string): void {
    const pick = (id: string | undefined | null): Framing | null => {
      const found = timeline && id ? findVideoClip(timeline, id) : null
      const m = found && timeline ? timeline.media.find((x) => x.id === found.clip.mediaId) : undefined
      return timeline && found && m && !isStill(m) ? framingOf(timeline, found.clip.id) : null
    }
    const framing = pick(selected) ?? pick(timeline ? pictureAt(timeline, playhead)?.id : null)
    if (!framing) {
      showToast({ kind: 'layout', text: 'Select a recording clip to save its framing with this shape.' })
      return
    }
    saveFramingAs(name, framing)
  }

  /** What the Saved layouts row does, read fresh on each use so the Inspector's handlers never change. */
  const layoutAction = useRef({
    apply: (_l: SavedLayout): void => {},
    save: (_name: string): void => {},
    update: (_l: SavedLayout): void => {},
    rename: (_l: SavedLayout, _name: string): void => {},
    remove: (_l: SavedLayout): void => {}
  })
  layoutAction.current = {
    apply: (l) => {
      applyFraming(l.framing, `Select a picture clip to give it "${l.name}".`)
    },
    save: (name) => {
      const framing = framingToSave()
      if (framing) saveFramingAs(name, framing)
    },
    update: (l) => {
      const framing = framingToSave()
      if (!framing) return
      storeLayouts(updateLayout(savedLayoutsNow.current, l.id, framing))
      showToast({ kind: 'layout', text: `Updated the layout "${l.name}" with this clip's framing.` })
    },
    rename: (l, name) => storeLayouts(renameLayout(savedLayoutsNow.current, l.id, name)),
    remove: (l) => {
      const at = savedLayoutsNow.current.findIndex((x) => x.id === l.id)
      storeLayouts(removeLayout(savedLayoutsNow.current, l.id))
      showToast({
        kind: 'layout',
        text: `Deleted the layout "${l.name}".`,
        action: { label: 'Undo', run: () => storeLayouts(restoreLayout(savedLayoutsNow.current, l, at)) }
      })
    }
  }

  const layoutActions = useMemo<SavedLayoutActions>(
    () => ({
      onApply: (l) => layoutAction.current.apply(l),
      onSave: (name) => layoutAction.current.save(name),
      onUpdate: (l) => layoutAction.current.update(l),
      onRename: (l, name) => layoutAction.current.rename(l, name),
      onDelete: (l) => layoutAction.current.remove(l)
    }),
    []
  )

  return { applyFraming, shapeSetups, chooseShape, pickSetup, saveSetup, layoutAction, layoutActions }
}
