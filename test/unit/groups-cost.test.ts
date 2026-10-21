import { describe, it, expect } from 'vitest'
import { addSource, createTimeline, splitClip, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { settleGroups } from '../../src/shared/groups'
import { applyClipEdit } from '../../src/main/project/session'

/**
 * Every edit settles the groups (audit 2026-10-19, fix first 5): with an
 * hour's cut in one group that cost 60 to 80 ms an edit, and a trim drag
 * sends one per pointer movement. A group the edit did not touch is left as
 * it is, and a touched one is compared without writing out every piece.
 */

function media(id: string, durationSec: number): ProjectMedia {
  return { id, originalPath: `C:\\v\\${id}.mp4`, playablePath: `C:\\v\\${id}.mp4`, conformed: false, conformReasons: [], durationSec, width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true, peaksPath: '', filmstripPath: '' }
}

/** An hour's recording cut into `n` pieces, picture and sound, all in one group. */
function groupedHour(n: number): Timeline {
  const base = createTimeline(30, { width: 1920, height: 1080 })
  let t = addSource({ ...base, media: [media('rec', 3600)] }, { mediaId: 'rec', clipId: 'c0' })
  const step = Math.floor(108000 / n)
  for (let i = 1; i < n; i++) t = splitClip(t, i * step)
  return {
    ...t,
    videoTracks: t.videoTracks.map((r) => ({ ...r, clips: r.clips.map((c) => ({ ...c, group: 'g' })) })),
    audioTracks: t.audioTracks.map((r) => ({ ...r, clips: r.clips.map((c) => ({ ...c, group: 'g' })) }))
  }
}

/** The fastest of a few runs, in milliseconds. */
function fastest(fn: () => unknown): number {
  let best = Infinity
  for (let i = 0; i < 5; i++) {
    const a = performance.now()
    fn()
    best = Math.min(best, performance.now() - a)
  }
  return best
}

describe('settling groups after an edit', () => {
  const t = settleGroups(groupedHour(1000))
  const sound = t.audioTracks[0]!.clips[500]!
  const picture = t.videoTracks[0]!.clips[500]!

  it('leaves a group the edit did not touch as it is, the very same pieces', () => {
    const next = applyClipEdit(t, { kind: 'setClipAudio', clipId: sound.id, gain: 0.5, muted: false })
    expect(next.audioTracks[0]!.clips[500]!.gain).toBe(0.5)
    expect(next.videoTracks[0]!.clips.every((c, i) => c === t.videoTracks[0]!.clips[i])).toBe(true)
  })

  it('costs a few milliseconds on an hour cut into a thousand grouped pieces, not tens', () => {
    // Before, each of these took 60 to 80 ms here.
    expect(fastest(() => applyClipEdit(t, { kind: 'setClipAudio', clipId: sound.id, gain: 0.5, muted: false }))).toBeLessThan(20)
    expect(fastest(() => applyClipEdit(t, { kind: 'moveClip', clipId: picture.id, trackId: t.videoTracks[0]!.id, start: picture.timelineStart + 1 }))).toBeLessThan(30)
  })

  it('still frames a touched group again, and keeps a piece that comes out the same as the same piece', () => {
    // Taking a piece out of the middle leaves two runs: the longer keeps the group.
    const cut = { ...t, videoTracks: [{ ...t.videoTracks[0]!, clips: t.videoTracks[0]!.clips.filter((_, i) => i !== 900) }] }
    const settled = settleGroups(cut, t)
    const v1 = settled.videoTracks[0]!.clips
    expect(v1.slice(0, 900).every((c) => c.group === 'g')).toBe(true)
    expect(v1.slice(900).every((c) => c.group === undefined)).toBe(true)
    expect(v1[10]).toBe(t.videoTracks[0]!.clips[10])
  })
})
