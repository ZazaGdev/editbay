import { describe, it, expect } from 'vitest'
import {
  addSource,
  closeUpClip,
  closeUpClipBlockers,
  createTimeline,
  removeClips,
  rippleTrim,
  rippleTrimBlockers,
  trimToFrame,
  trimToFrameBlockers,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'

/**
 * Closing up around a J-cut, where a shot's sound starts under the shot before
 * it (audit 2026-10-10, fix first 2). A linked group moved by its earliest
 * clip, which in a J-cut is the sound, so taking time out before it left black
 * on V1; and the stretch taken out ran from a sound's edge, not its picture's,
 * so a title over the other shot moved.
 */

function media(id: string): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec: 20,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

type Shot = { id: string; at: number; length: number; soundFrom?: number; soundTo?: number }

/**
 * Shots on V1, back to back, each with its sound on A1 linked to it. A sound
 * runs from `soundFrom` to `soundTo` on the timeline, its picture's own
 * stretch unless they say otherwise; a title `T` sits on V2 when `title` says
 * where.
 */
function sequence(shots: Shot[], title?: number): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1920, height: 1080 }), media: [...shots.map((s) => media(s.id)), media('t')] }
  t = addSource(t, { mediaId: shots[0]!.id, clipId: 'X', at: 0, onTrack: 'v1' })
  const v = t.videoTracks[0]!.clips[0]!
  const s = t.audioTracks[0]!.clips[0]!
  const { link: _, ...unlinked } = v
  const pictures = shots.map((x) => ({ ...v, id: x.id, mediaId: x.id, link: `L${x.id}`, timelineStart: x.at, sourceIn: 300 + x.at, sourceOut: 300 + x.at + x.length }))
  const sounds = shots.map((x) => {
    const from = x.soundFrom ?? x.at
    const to = x.soundTo ?? x.at + x.length
    return { ...s, id: `s${x.id}`, mediaId: x.id, link: `L${x.id}`, timelineStart: from, sourceIn: 300 + from, sourceOut: 300 + to }
  })
  return {
    ...t,
    videoTracks: [
      { ...t.videoTracks[0]!, clips: pictures },
      ...(title === undefined ? [] : [{ id: 'v2', clips: [{ ...unlinked, id: 'T', mediaId: 't', timelineStart: title, sourceIn: 0, sourceOut: 8 }] }])
    ],
    audioTracks: [{ ...t.audioTracks[0]!, clips: sounds }]
  }
}

/** A, B and C, 100 frames each, with C's sound leading in 15 frames under B. */
const abc = (title?: number): Timeline =>
  sequence(
    [
      { id: 'A', at: 0, length: 100 },
      { id: 'B', at: 100, length: 100, soundTo: 185 },
      { id: 'C', at: 200, length: 100, soundFrom: 185 }
    ],
    title
  )

const at = (t: Timeline, id: string): [number, number] | undefined => {
  const c = [...t.videoTracks.flatMap((r) => r.clips), ...t.audioTracks.flatMap((r) => r.clips)].find((x) => x.id === id)
  return c ? [c.timelineStart, c.timelineStart + c.sourceOut - c.sourceIn] : undefined
}

/** The first frame before V1's last clip that has no picture, or null. */
function blackOnV1(t: Timeline): number | null {
  let end = 0
  for (const c of [...t.videoTracks[0]!.clips].sort((a, b) => a.timelineStart - b.timelineStart)) {
    if (c.timelineStart > end) return end
    end = c.timelineStart + c.sourceOut - c.sourceIn
  }
  return null
}

/** Each picture and its sound still play the same source frame at the same time. */
function inStep(t: Timeline): boolean {
  const offset = new Map<string, number>()
  for (const c of [...t.videoTracks.flatMap((r) => r.clips), ...t.audioTracks.flatMap((r) => r.clips)]) {
    if (c.link === undefined) continue
    const o = c.timelineStart - c.sourceIn
    if (offset.has(c.link) && offset.get(c.link) !== o) return false
    offset.set(c.link, o)
  }
  return true
}

describe('closing up before a J-cut', () => {
  it('refuses Shift+Delete on the shot before, which would leave black or run its sound over the shot before that', () => {
    const t = abc()
    // C closed up to 100 would bring its lead-in to 85, over A's sound: refused, with C's sound named.
    expect(closeUpClipBlockers(t, 'B').map((c) => c.id)).toEqual(['sC'])
    expect(closeUpClip(t, 'B')).toBe(t)
    expect(removeClips(t, ['B'], { closeUp: true })).toBe(t)
  })

  it('closes up a shot before a J-cut when the shot before it leaves room for the lead-in', () => {
    // A's sound ends at 80, so C's lead-in fits in after it.
    const t = sequence([
      { id: 'A', at: 0, length: 100, soundTo: 80 },
      { id: 'B', at: 100, length: 100, soundTo: 185 },
      { id: 'C', at: 200, length: 100, soundFrom: 185 }
    ])
    const out = closeUpClip(t, 'B')
    expect(at(out, 'C')).toEqual([100, 200])
    expect(at(out, 'sC')).toEqual([85, 200])
    expect(blackOnV1(out)).toBeNull()
    expect(inStep(out)).toBe(true)
  })

  it('O on the shot before brings the next picture up to the cut, leaving no black', () => {
    for (const frame of [150, 190]) {
      const t = abc()
      expect(trimToFrameBlockers(t, 'B', 'end', frame)).toEqual([])
      const out = trimToFrame(t, 'B', 'end', frame)
      expect(at(out, 'B')).toEqual([100, frame])
      expect(at(out, 'C')).toEqual([frame, frame + 100])
      expect(blackOnV1(out)).toBeNull()
      expect(inStep(out)).toBe(true)
    }
  })
})

describe('a title over the shot a J-cut leads in under', () => {
  // B 0 to 100, C 100 to 200 with its sound from 85; the title sits at 90, over B and over C's lead-in.
  const bc = (): Timeline =>
    sequence(
      [
        { id: 'B', at: 0, length: 100, soundTo: 85 },
        { id: 'C', at: 100, length: 100, soundFrom: 85 }
      ],
      90
    )

  it('stays put when the shot after is taken out', () => {
    const out = closeUpClip(bc(), 'C')
    expect(at(out, 'T')).toEqual([90, 98])
    expect(at(out, 'B')).toEqual([0, 100])
  })

  it('stays put when the tail of the shot under it is ripple dragged shorter, after the title', () => {
    // B plays source 300 to 400: its tail dragged to 395 ends it at frame 95.
    expect(rippleTrimBlockers(bc(), 'B', 'end', 395)).toEqual([])
    const out = rippleTrim(bc(), 'B', 'end', 395)
    expect(at(out, 'T')).toEqual([90, 98])
    expect(at(out, 'C')).toEqual([95, 195])
    expect(blackOnV1(out)).toBeNull()
    expect(inStep(out)).toBe(true)
  })

  it('stays put when the tail of the shot under it is ripple dragged longer, and the next shot moves on whole', () => {
    const out = rippleTrim(bc(), 'B', 'end', 405)
    expect(at(out, 'T')).toEqual([90, 98])
    expect(at(out, 'B')).toEqual([0, 105])
    expect(at(out, 'C')).toEqual([105, 205])
    expect(at(out, 'sC')).toEqual([90, 205])
    expect(blackOnV1(out)).toBeNull()
    expect(inStep(out)).toBe(true)
  })
})
