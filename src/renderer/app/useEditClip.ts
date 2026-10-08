/**
 * Sending clip edits for the sequence on screen, a transition put on the cut
 * at the playhead, and what a removal leaves selected once it has landed.
 */

import { useCallback, useRef } from 'react'
import type { ClipEdit } from '../../shared/types'
import { findClip, sequenceOf, timelineOf, type Project } from '../../shared/project'
import { nearestSeam, type KindSet, type Transitioned } from '../../shared/transitions'
import { showToast } from '../state/toasts'
import { manyClipsChanged } from './edit-words'
import { framingEditedClip, lastFramingOf } from '../../shared/last-framing'
import type { AppLocals, AppSettings, Selecting } from './app-state'

export function useEditClip({
  project,
  proj,
  sequenceId,
  undo,
  phase,
  stateNow,
  selected,
  setSelectedTransition,
  setPlayhead,
  transitionOnEveryCut,
  transitionDefaults,
  onSelection,
  select,
  lastFraming
}: Pick<AppLocals, 'project' | 'proj' | 'sequenceId' | 'undo' | 'phase' | 'stateNow' | 'selected' | 'setSelectedTransition' | 'setPlayhead' | 'lastFraming'> &
  Pick<AppSettings, 'transitionOnEveryCut' | 'transitionDefaults'> &
  Pick<Selecting, 'onSelection' | 'select'>) {
  /**
   * The last framing written to the settings: at once for an edit made in one
   * go, and for a drag, which sends one a move, once its moves stop.
   */
  const framingWrite = useRef(0)
  const rememberFraming = useCallback(
    (p: Project, clipId: string, continuing: boolean): void => {
      const framing = lastFramingOf(timelineOf(p, sequenceId), clipId)
      if (!framing) return
      window.clearTimeout(framingWrite.current)
      const write = (): void => {
        void window.api.setAppSettings({ lastFraming: framing })
        lastFraming.current = null
      }
      lastFraming.current = framing
      if (continuing) framingWrite.current = window.setTimeout(write, 1000)
      else write()
    },
    [sequenceId, lastFraming]
  )

  /**
   * A clip edit, for the sequence on screen. `continuing` marks the later
   * movements of a drag, which share the undo step of its first.
   */
  const editClip = useCallback(
    (asked: ClipEdit, continuing = false): Promise<Project> | null => {
      if (!project || phase.current !== null) return null
      // A picture moved or cropped with several clips selected is moved or
      // cropped on all of them (bugs and notes 2, note 32).
      const e = onSelection(asked)
      // Every cut this edit makes gets a transition, where that is turned on.
      // Inside the edit, so it is one undo step rather than two.
      const auto =
        transitionOnEveryCut && project.fps > 0
          ? { autoTransition: { kind: transitionDefaults.picture, length: Math.max(1, Math.round(transitionDefaults.seconds * project.fps)) } }
          : {}
      const done = proj.edit({ ...e, sequenceId: sequenceOf(project, sequenceId).id, ...auto }, { continuing })
      // An edit that changes many clips at once says so, with an Undo, unless
      // something else has happened since, which the Undo would take back instead.
      const told = manyClipsChanged(e, timelineOf(project, sequenceId))
      const at = proj.step()
      if (told) void done.then(() => proj.step() === at && showToast({ kind: e.kind, text: told, undo }))
      // A recording framed: what a recording put on a new project is offered (plan 93).
      const framed = framingEditedClip(e)
      if (framed !== null) void done.then((p) => rememberFraming(p, framed, continuing))
      return done
    },
    [proj, project, sequenceId, undo, transitionOnEveryCut, transitionDefaults, onSelection, rememberFraming]
  )

  /**
   * Put the default transition on the cut nearest the playhead: on the track of
   * the clip selected when one of that sort is, and otherwise on the first
   * track of that sort. The picture key carries the linked sound with it; the
   * sound key takes the sound on its own.
   */
  const addTransitionAtPlayhead = useCallback(
    (kinds: KindSet) => {
      const t = stateNow.current.timeline
      if (!t) return
      const wanted = kinds === 'picture' ? 'video' : 'audio'
      const found = selected ? findClip(t, selected) : null
      const track = found && found.kind === wanted ? found.track : kinds === 'picture' ? t.videoTracks[0] : t.audioTracks[0]
      const seam = track ? nearestSeam(track.clips as Transitioned[], kinds, stateNow.current.playhead) : null
      if (!seam) {
        showToast({ kind: 'addTransition', text: 'There is no cut here to put a transition on.' })
        return
      }
      editClip({
        kind: 'addTransition',
        clipId: seam.clipId,
        side: seam.side,
        transitionKind: kinds === 'picture' ? transitionDefaults.picture : transitionDefaults.sound,
        length: Math.max(1, Math.round(transitionDefaults.seconds * t.fps)),
        ...(kinds === 'sound' ? { alone: true } : {})
      })
      setSelectedTransition({ clipId: seam.clipId, side: seam.side })
    },
    [editClip, selected, transitionDefaults]
  )

  /** A removal is on its way to main: the selection it acted on is not the one on screen any more. */
  const removing = useRef(false)

  /**
   * Take up what a removal left selected, once it has landed: the clip
   * `nextAfterRemoved` named, if it is still there, so Delete pressed again
   * takes the next one. The playhead and the view stay where they were. Looked
   * up in the sequence the edit made, since closing up has moved the clips.
   * With `join`, a close-up's join, the playhead goes there.
   */
  const selectAfterRemoved = useCallback(
    (done: Promise<Project> | null, clipId: string | null, alone: boolean, join: number | null = null): void => {
      if (!done) return
      removing.current = true
      const onSequence = sequenceId
      const at = proj.step()
      const settle = (): void => {
        removing.current = false
      }
      void done
        .then((p) => {
          settle()
          // An undo, another edit or a new document while this was in flight,
          // or another sequence on screen: what it left selected is not what
          // to select now.
          if (proj.step() !== at || stateNow.current.sequenceId !== onSequence) return
          const t = timelineOf(p, onSequence)
          const there = clipId !== null && findClip(t, clipId) !== null
          select(there ? clipId : null, there && alone)
          if (join !== null) setPlayhead(join)
        })
        .catch(settle)
    },
    [proj, select, sequenceId]
  )

  return { editClip, addTransitionAtPlayhead, removing, selectAfterRemoved }
}
