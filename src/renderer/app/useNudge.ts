/**
 * The nudge keys: the edited picture's crop moved in the Source view, or its
 * place in the Output view.
 */

import { useCallback, useRef } from 'react'
import { MAIN_PICTURE, targetAspect, type Rect } from '../../shared/project'
import { moveCrop } from '../../shared/crop-geometry'
import { nudgePlace, type Place } from '../../shared/layout'
import { cropEdit, onEnd, shownCrop } from '../../shared/zoom-edit'
import { editedAt } from '../../shared/playback'
import type { AppLocals, EditClip, Selecting } from './app-state'

export function useNudge({
  timeline,
  framing,
  playhead,
  selected,
  picture,
  zoomEnd,
  zoomPicked,
  view,
  proj,
  editClip,
  frameSelected
}: Pick<AppLocals, 'timeline' | 'playhead' | 'selected' | 'picture' | 'zoomEnd' | 'zoomPicked' | 'view' | 'proj'> &
  Pick<Selecting, 'framing' | 'frameSelected'> &
  Pick<EditClip, 'editClip'>) {
  /**
   * The last nudge: which picture, when, the undo step it made, and where it
   * put the picture. Nudges less than a second apart on the same picture are
   * one undo step, and each goes on from where the last put it, even before
   * the document has come back from main.
   */
  const lastNudge = useRef<{ key: string; at: number; step: number; to: Rect | Place } | null>(null)

  /** Move the edited picture's crop, in the Source view, or its place, in the Output view. */
  const nudge = useCallback(
    (dx: number, dy: number): void => {
      if (!timeline || !framing) return
      // The first press brings the playhead into the selected clip, so the
      // next ones move its picture rather than another clip's.
      if (frameSelected()) return
      const at = editedAt(framing, playhead, selected)
      if (!at) return
      const layer = at.clip.layers.find((l) => l.id === picture)
      const pic = layer ? layer.id : MAIN_PICTURE
      // A Simple zoom's End is nudged apart from its Start, so a nudge of Start never carries on onto End.
      const end = onEnd(at.clip, pic, zoomEnd)
      // The picture's crop at the playhead, or a Simple zoom's chosen end: a nudge moves that.
      const now = { crop: shownCrop(at.clip, playhead, pic, zoomEnd), place: (layer ?? at.clip.transform).place }
      // The playhead too: a nudge after it has moved is on another keyframe of a
      // zoom, and carried on, replaced the last one rather than adding one (audit 2026-10-01).
      const key = `${at.clip.id}:${pic}:${end ? 'end' : 'start'}:${view}:${playhead}`
      const last = lastNudge.current
      const continuing = last !== null && last.key === key && Date.now() - last.at < 1000 && proj.step() === last.step
      let to: Rect | Place
      // Against an edge it cannot go further, and makes no edit: an undo step
      // that did nothing would push aside the one before it.
      if (view === 'source') {
        const from = continuing ? (last.to as Rect) : now.crop
        to = moveCrop(from, dx, dy, { w: at.media.width, h: at.media.height })
        if (to.x === from.x && to.y === from.y) return
        editClip(cropEdit(at.clip, playhead, to, pic, zoomEnd, zoomPicked), continuing)
      } else {
        // Places need a frame; Handoff has none.
        if (targetAspect(timeline) === null) return
        const { width: W, height: H } = timeline.output
        const from = continuing ? (last.to as Place) : now.place
        to = nudgePlace(from, dx, dy, W, H)
        if (Math.abs((to.x - from.x) * W) < 0.5 && Math.abs((to.y - from.y) * H) < 0.5) return
        editClip({ kind: 'setPlace', clipId: at.clip.id, picture: pic, place: to, reshapeCrop: false }, continuing)
      }
      lastNudge.current = { key, at: Date.now(), step: proj.step(), to }
    },
    [timeline, framing, playhead, selected, picture, zoomEnd, zoomPicked, view, proj, editClip, frameSelected]
  )

  return { nudge }
}
