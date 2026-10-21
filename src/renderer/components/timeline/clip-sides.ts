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

/** Which of a piece's edges are cuts inside its group, one object per answer so a clip is not drawn again for nothing. */
const INNER = {
  start: { start: true, end: false },
  end: { start: false, end: true },
  both: { start: true, end: true }
} as const

/** A track's clips' sides, each answered at once for one clip of it. */
export interface TrackSides {
  /**
   * Which ends of a sound clip take a fade handle: those with nothing against
   * them. Where it meets another sound, the cut's own button makes a crossfade.
   */
  fadeable: (c: Span) => 'both' | 'in' | 'out' | 'none'
  /** Which of a grouped piece's edges are cuts inside its group: another piece of it ends where it starts, or starts where it ends. */
  inner: (c: Clip | SoundClip) => { start: boolean; end: boolean } | undefined
}

/** Worked out once for each track's clips, which change only when the track does. */
const known = new WeakMap<readonly (Clip | SoundClip)[], TrackSides>()

/**
 * A track's sides, worked out once for the whole track. Asked of each clip in
 * turn, each search went through the whole track, which on an hour cut into a
 * thousand pieces cost tens of milliseconds on every frame the timeline was
 * drawn while playing (audit 2026-10-19).
 */
export function trackSides(clips: readonly (Clip | SoundClip)[]): TrackSides {
  const was = known.get(clips)
  if (was) return was
  const starts = new Set<number>()
  const ends = new Set<number>()
  // Per group, the frames its pieces start and end on.
  const groupStarts = new Map<string, Set<number>>()
  const groupEnds = new Map<string, Set<number>>()
  const note = (m: Map<string, Set<number>>, group: string, at: number): void => {
    m.set(group, (m.get(group) ?? new Set<number>()).add(at))
  }
  for (const c of clips) {
    starts.add(c.timelineStart)
    ends.add(spanEnd(c))
    if (c.group === undefined) continue
    note(groupStarts, c.group, c.timelineStart)
    note(groupEnds, c.group, spanEnd(c))
  }
  const meets = (at: number): boolean => starts.has(at) && ends.has(at)
  // A clip is never shorter than a frame, so what ends where it starts is always another piece.
  const has = (m: Map<string, Set<number>>, group: string, at: number): boolean => m.get(group)?.has(at) ?? false
  const sides: TrackSides = {
    fadeable: (c) => {
      const start = !meets(c.timelineStart)
      const end = !meets(spanEnd(c))
      return start && end ? 'both' : start ? 'in' : end ? 'out' : 'none'
    },
    inner: (c) => {
      if (c.group === undefined) return undefined
      const start = has(groupEnds, c.group, c.timelineStart)
      const end = has(groupStarts, c.group, spanEnd(c))
      return start && end ? INNER.both : start ? INNER.start : end ? INNER.end : undefined
    }
  }
  known.set(clips, sides)
  return sides
}
