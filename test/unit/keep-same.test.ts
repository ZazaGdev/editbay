import { describe, it, expect } from 'vitest'
import { keepSame } from '../../src/shared/keep-same'

describe('keeping what an edit did not change (audit 2026-10-01)', () => {
  const was = { name: 'p', tracks: [{ id: 'a', clips: [{ id: 'c1', at: 0 }, { id: 'c2', at: 10 }] }, { id: 'b', clips: [] as { id: string; at: number }[] }] }

  it('gives back the very same objects for the parts that are equal', () => {
    const now = structuredClone(was)
    now.tracks[0]!.clips[1]!.at = 20
    const kept = keepSame(was, now)
    expect(kept).not.toBe(was)
    expect(kept.tracks[0]!.clips[0]).toBe(was.tracks[0]!.clips[0])
    expect(kept.tracks[0]!.clips[1]).toEqual({ id: 'c2', at: 20 })
    expect(kept.tracks[1]).toBe(was.tracks[1])
    expect(kept).toEqual(now)
  })

  it('matches by id, so a clip put in first leaves the others as they were', () => {
    const now = structuredClone(was)
    now.tracks[0]!.clips.unshift({ id: 'c0', at: -5 })
    const kept = keepSame(was, now)
    expect(kept.tracks[0]!.clips[1]).toBe(was.tracks[0]!.clips[0])
    expect(kept.tracks[0]!.clips[2]).toBe(was.tracks[0]!.clips[1])
  })

  it('is the old document when nothing changed, and sees a field taken away', () => {
    expect(keepSame(was, structuredClone(was))).toBe(was)
    const { name: _gone, ...rest } = structuredClone(was)
    expect(keepSame(was as unknown, rest as unknown)).toEqual(rest)
  })
})
