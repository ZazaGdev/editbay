/**
 * The sequences of the project: which is on screen, switching between them
 * keeping your place in each, and adding, duplicating and removing one.
 */

import { useCallback, useLayoutEffect } from 'react'
import { defaultTimelineWorkspace, type TimelineWorkspace } from '../../shared/workspace'
import { findClip, newId } from '../../shared/project'
import { showToast } from '../state/toasts'
import { rememberShape } from './useLayouts'
import type { AppLocals } from './app-state'

export function useSequences({
  project,
  proj,
  sequenceId,
  setSequenceId,
  here,
  places,
  setPlaces,
  enterPlace,
  timeline,
  undo,
  showStepped
}: Pick<AppLocals, 'project' | 'proj' | 'sequenceId' | 'setSequenceId' | 'here' | 'places' | 'setPlaces' | 'enterPlace' | 'timeline' | 'undo' | 'showStepped'>) {
  /**
   * Put a sequence on screen, keeping where you were in the one you leave.
   * `startAt` is where a sequence you have not been in yet begins.
   */
  const switchSequence = useCallback(
    (id: string, startAt?: TimelineWorkspace) => {
      if (id === sequenceId) return
      setPlaces((prev) => ({ ...prev, [sequenceId]: here }))
      setSequenceId(id)
      enterPlace(places[id] ?? startAt ?? defaultTimelineWorkspace())
    },
    [sequenceId, here, places, enterPlace]
  )

  showStepped.current = (changed: string[]) => {
    if (changed.length === 0 || changed.includes(sequenceId)) return
    const other = proj.project?.sequences.find((s) => s.id === changed[0])
    if (!other) return
    switchSequence(other.id)
    showToast({ kind: 'stepped', text: `That changed ${other.name}, so it is shown now.` })
  }

  // An undo can take away the sequence on screen. Move to the first one,
  // before anything else reads the place of the one that has gone.
  useLayoutEffect(() => {
    if (project && !project.sequences.some((s) => s.id === sequenceId)) {
      const first = project.sequences[0]
      if (first) {
        setSequenceId(first.id)
        enterPlace(places[first.id] ?? defaultTimelineWorkspace())
      }
    }
  }, [project, sequenceId, places, enterPlace])

  const addSequence = useCallback(
    (presetId: string) => {
      const id = newId()
      rememberShape(presetId)
      // Switch once it exists, so the screen never shows a sequence main does not have.
      void proj.edit({ kind: 'addSequence', id, presetId }).then((p) => {
        if (p.sequences.some((s) => s.id === id)) switchSequence(id)
      })
    },
    [proj, switchSequence]
  )

  const duplicateSequence = useCallback(() => {
    const id = newId()
    const from = here
    // A clip is found by its kind of track, the track, and its place in it.
    const found = timeline && from.selectedClipId ? findClip(timeline, from.selectedClipId) : null
    const place = found ? { kind: found.kind, track: found.index, at: found.track.clips.findIndex((c) => c.id === found.clip.id) } : null
    void proj.edit({ kind: 'duplicateSequence', sequenceId, id }).then((p) => {
      const copy = p.sequences.find((s) => s.id === id)
      if (!copy) return
      // The copy starts where you were in the original, on the same clip,
      // which in the copy has a new id.
      const tracks = place?.kind === 'audio' ? copy.audioTracks : copy.videoTracks
      const selectedClipId = place ? (tracks[place.track]?.clips[place.at]?.id ?? null) : null
      switchSequence(id, { ...from, selectedClipId })
    })
  }, [proj, sequenceId, here, timeline, switchSequence])

  const removeSequence = useCallback(
    (id: string) => {
      if (!project || project.sequences.length <= 1) return
      if (id === sequenceId) {
        const i = project.sequences.findIndex((s) => s.id === id)
        const neighbour = project.sequences[i + 1] ?? project.sequences[i - 1]
        if (neighbour) switchSequence(neighbour.id)
      }
      const name = project.sequences.find((s) => s.id === id)?.name ?? 'the sequence'
      const done = proj.edit({ kind: 'removeSequence', sequenceId: id })
      const at = proj.step()
      void done.then(() => proj.step() === at && showToast({ kind: 'removeSequence', text: `Removed ${name}.`, undo }))
    },
    [proj, project, sequenceId, switchSequence, undo]
  )

  return { switchSequence, addSequence, duplicateSequence, removeSequence }
}
