import { refuse, seconds } from './edit-list-fields'
import { secondsToFrames } from './time'
import { spanEnd, spanLength } from './tracks'
import { addTransition, setTransition } from './transition-edits'
import { v1End, type Timeline } from './project'

/**
 * The dip to black at the end of the cut (task 139): `endDipToBlackSec` on
 * the list. Every clip that ends where the cut ends, the picture, its sound,
 * the corner and any layer still showing, gets a transition on its out edge,
 * ending on its last frame, as one added by hand in the app and then dragged
 * to end at the cut would be: the pictures dip to black, the sounds fade to
 * silence, and each can still be lengthened or taken off in the app.
 */

export const END_DIP_FIELD = 'endDipToBlackSec'

/** The length asked for, refused when it is no length at all. */
export function readEndDip(raw: unknown): number {
  const sec = seconds(raw, END_DIP_FIELD)
  if (!(sec > 0)) refuse(END_DIP_FIELD, 'must be more than 0 seconds')
  return sec
}

export function dipToBlackAtEnd(t: Timeline, sec: number, fps: number): Timeline {
  const end = v1End(t)
  const want = secondsToFrames(sec, fps)
  const lastOnV1 = (t.videoTracks[0]?.clips ?? []).find((c) => spanEnd(c) === end)
  if (!lastOnV1) refuse(END_DIP_FIELD, 'the cut is empty, so there is nothing to dip to black')
  if (spanLength(lastOnV1) < want) {
    refuse(END_DIP_FIELD, `is longer than the last piece of the cut, which is ${(spanLength(lastOnV1) / fps).toFixed(2)} s`)
  }
  const ending = [...t.videoTracks.flatMap((r) => r.clips), ...t.audioTracks.flatMap((r) => r.clips)].filter((c) => spanEnd(c) === end)
  let out = t
  for (const c of ending) {
    // A layer or a sound shorter than the dip fades over the whole of itself.
    const length = Math.min(want, spanLength(c))
    out = addTransition(out, c.id, 'out', { kind: 'toBlack', length, alone: true })
    out = setTransition(out, c.id, 'out', { length, before: length, alone: true })
  }
  return out
}
