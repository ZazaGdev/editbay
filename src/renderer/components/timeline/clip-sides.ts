/**
 * Which ends of a clip meet another: where a sound takes a fade handle, and
 * which edges of a grouped piece are cuts inside its group.
 */

import type { Clip, SoundClip } from '../../../shared/project'
import { spanEnd, type Span } from '../../../shared/tracks'

/** Whether two clips of a track meet at `at`: one ends there and another starts. */
export function touching(clips: readonly Span[], at: number): boolean {
  return clips.some((c) => spanEnd(c) === at) && clips.some((c) => c.timelineStart === at)
}

/**
 * Which ends of a sound clip take a fade handle: those with nothing against
 * them. Where it meets another sound, the cut's own button makes a crossfade.
 */
export function fadeableSides(clips: readonly Span[], c: Span): 'both' | 'in' | 'out' | 'none' {
  const start = !touching(clips, c.timelineStart)
  const end = !touching(clips, spanEnd(c))
  return start && end ? 'both' : start ? 'in' : end ? 'out' : 'none'
}

/** Which of a piece's edges are cuts inside its group, one object per answer so a clip is not drawn again for nothing. */
const INNER = {
  start: { start: true, end: false },
  end: { start: false, end: true },
  both: { start: true, end: true }
} as const
export function innerOf(clips: readonly (Clip | SoundClip)[], c: Clip | SoundClip): { start: boolean; end: boolean } | undefined {
  if (c.group === undefined) return undefined
  const start = clips.some((x) => x !== c && x.group === c.group && spanEnd(x) === c.timelineStart)
  const end = clips.some((x) => x !== c && x.group === c.group && x.timelineStart === spanEnd(c))
  return start && end ? INNER.both : start ? INNER.start : end ? INNER.end : undefined
}
