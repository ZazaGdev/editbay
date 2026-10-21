import { describe, it, expect } from 'vitest'
import type { Clip, SoundClip } from '../../../src/shared/project'
import { spanEnd } from '../../../src/shared/tracks'
import { trackSides } from '../../../src/renderer/components/timeline/clip-sides'

/**
 * A track's clip sides worked out once for the track (audit 2026-10-19, fix
 * first 4): the same answers as asking each clip with a search of the whole
 * track, without that search, which made every frame of playback cost tens
 * of milliseconds on an hour cut into a thousand pieces.
 */

type Piece = Clip | SoundClip

function piece(id: string, timelineStart: number, length: number, group?: string): Piece {
  return { id, mediaId: 'm', track: 0, sourceIn: 0, sourceOut: length, timelineStart, gain: 1, muted: false, ...(group ? { group } : {}) } as SoundClip
}

/** The answers as the timeline used to ask them, clip by clip. */
function searched(clips: Piece[], c: Piece): { fadeable: string; inner: string } {
  const meets = (at: number): boolean => clips.some((x) => spanEnd(x) === at) && clips.some((x) => x.timelineStart === at)
  const s = !meets(c.timelineStart)
  const e = !meets(spanEnd(c))
  const fadeable = s && e ? 'both' : s ? 'in' : e ? 'out' : 'none'
  if (c.group === undefined) return { fadeable, inner: 'none' }
  const is = clips.some((x) => x !== c && x.group === c.group && spanEnd(x) === c.timelineStart)
  const ie = clips.some((x) => x !== c && x.group === c.group && x.timelineStart === spanEnd(c))
  return { fadeable, inner: is && ie ? 'both' : is ? 'start' : ie ? 'end' : 'none' }
}

const named = (v: { start: boolean; end: boolean } | undefined): string => (!v ? 'none' : v.start && v.end ? 'both' : v.start ? 'start' : 'end')

describe('the sides of a track’s clips', () => {
  it('say the same as searching the track for each clip, gaps, groups and all', () => {
    // A seeded run of pieces, some touching, some apart, in two groups and none.
    let seed = 7
    const next = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    const clips: Piece[] = []
    let at = 0
    for (let i = 0; i < 300; i++) {
      at += next(3) === 0 ? next(20) : 0
      const length = 1 + next(40)
      clips.push(piece(`p${i}`, at, length, ['g1', 'g2', undefined][next(3)]))
      at += length
    }
    const sides = trackSides(clips)
    for (const c of clips) expect({ fadeable: sides.fadeable(c), inner: named(sides.inner(c)) }, c.id).toEqual(searched(clips, c))
  })

  it('are quick on 2000 grouped pieces, as every frame of playback asks them', () => {
    const clips = Array.from({ length: 2000 }, (_, i) => piece(`p${i}`, i * 30, 30, 'g'))
    const start = performance.now()
    // A fresh track each time, as after an edit, and every clip asked both questions.
    const copy = [...clips]
    const sides = trackSides(copy)
    for (const c of copy) {
      sides.fadeable(c)
      sides.inner(c)
    }
    // Searching the track for each clip took over a hundred milliseconds here.
    expect(performance.now() - start).toBeLessThan(40)
  })

  it('are worked out once for a track that has not changed', () => {
    const clips = [piece('a', 0, 10), piece('b', 10, 10)]
    expect(trackSides(clips)).toBe(trackSides(clips))
  })
})
