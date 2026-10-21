import { describe, it, expect } from 'vitest'
import {
  addSource,
  addTrack,
  allClips,
  createTimeline,
  findClip,
  linkedIds,
  moveClipTo,
  setClipAudio,
  setClipIn,
  setClipOut,
  timelineDuration,
  v1Clips,
  v1End,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'
import { spanEnd } from '../../src/shared/tracks'
import { peaksKey } from '../../src/shared/sound'
import type { PeaksData } from '../../src/shared/types'
import {
  DEFAULT_SILENCE_SETTINGS,
  defaultListenTracks,
  findPauses,
  removableStretches,
  removeStretches,
  type SilenceSettings
} from '../../src/shared/silences'

/**
 * Plan 16 step 1: finding the pauses in the talking head's sound, and taking
 * them out of the sequence, closing up, with linked clips kept in step.
 */

const PPS = 100
const LOUD = 12000

function media(id: string, durationSec: number, overrides: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: '',
    ...overrides
  }
}

/**
 * A waveform `durationSec` long, loud everywhere but in the quiet stretches
 * given in seconds, which are at `level` (silence unless said).
 */
function wave(durationSec: number, quiet: [number, number, number?][]): PeaksData {
  const buckets = Math.round(durationSec * PPS)
  const peaks = new Int16Array(buckets * 2)
  for (let b = 0; b < buckets; b++) {
    const sec = b / PPS
    const q = quiet.find(([from, to]) => sec >= from && sec < to)
    const level = q ? (q[2] ?? 0) : LOUD
    peaks[b * 2] = -level
    peaks[b * 2 + 1] = level
  }
  return { peaksPerSecond: PPS, durationSec, peaks }
}

const S: SilenceSettings = { levelDb: -40, shortestSec: 0.5, leaveSec: 0.2 }

/** A vertical sequence at 30 fps with these sources in it. */
function sequence(...m: ProjectMedia[]): Timeline {
  return { ...createTimeline(30, { width: 1080, height: 1920 }), media: m }
}

/** One recording `a` on V1 from 0, its one stream linked on A1. */
function one(durationSec = 10): Timeline {
  return addSource(sequence(media('a', durationSec)), { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
}

/** Where every clip is, by id: its start, and its stretch of the recording. */
function spans(t: Timeline): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {}
  for (const track of [...t.videoTracks, ...t.audioTracks]) {
    for (const c of track.clips) out[c.id] = [c.timelineStart, c.sourceIn, c.sourceOut]
  }
  return out
}

/** Every track in order, no two clips on one overlapping, none under a frame long. */
function expectTracksWhole(t: Timeline): void {
  for (const track of [...t.videoTracks, ...t.audioTracks]) {
    track.clips.forEach((c, i) => {
      expect(c.sourceOut - c.sourceIn, `${c.id} on ${track.id}`).toBeGreaterThanOrEqual(1)
      const next = track.clips[i + 1]
      if (next) expect(next.timelineStart, `${next.id} after ${c.id} on ${track.id}`).toBeGreaterThanOrEqual(spanEnd(c))
    })
  }
}

/** Every clip linked to another shows the same frame of their recording at the same moment. */
function expectGroupsInStep(t: Timeline): void {
  for (const c of allClips(t)) {
    for (const id of linkedIds(t, c.id)) {
      const o = findClip(t, id)!.clip
      if (o.mediaId === c.mediaId) expect(o.timelineStart - o.sourceIn, `${id} against ${c.id}`).toBe(c.timelineStart - c.sourceIn)
    }
  }
}

describe('the tracks listened to by default', () => {
  it('are those holding heard sound linked to a picture on V1, not music or a muted stream', () => {
    let t = sequence(media('a', 10, { audioTracks: 2 }), media('song', 20, { hasVideo: false, width: 0, height: 0 }))
    t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
    t = addTrack(t, 'audio', 'music')
    t = addSource(t, { mediaId: 'song', clipId: 'S', at: 0, onTrack: 'music' })
    // A's first stream on A1, heard; its second on A2, muted; the song on its own track.
    expect(defaultListenTracks(t)).toEqual([t.audioTracks[0]!.id])
  })
})

describe('finding pauses', () => {
  it('finds a quiet run long enough, and leaves half the length to leave either side of it', () => {
    const peaks = new Map([[peaksKey('a', 0), wave(10, [[2, 3]])]])
    const found = findPauses(one(), peaks, new Set(['a1']), S)
    // Quiet from frame 60 to 90; 6 frames left of it, 3 after the speech before, 3 before the speech after.
    expect(found.pauses).toEqual([{ from: 63, to: 87 }])
    expect(found.waiting).toBe(false)
  })

  it('leaves the extra frame of an odd length to leave before the speech after', () => {
    const peaks = new Map([[peaksKey('a', 0), wave(10, [[2, 3]])]])
    const found = findPauses(one(), peaks, new Set(['a1']), { ...S, leaveSec: 7 / 30 })
    expect(found.pauses).toEqual([{ from: 63, to: 86 }])
  })

  it('takes a whole pause out when nothing is to be left', () => {
    const peaks = new Map([[peaksKey('a', 0), wave(10, [[2, 3]])]])
    expect(findPauses(one(), peaks, new Set(['a1']), { ...S, leaveSec: 0 }).pauses).toEqual([{ from: 60, to: 90 }])
  })

  it('counts a quiet run exactly the shortest pause long', () => {
    // 2.0 to 2.5 s is 15 frames, the shortest pause at 30 fps.
    const peaks = new Map([[peaksKey('a', 0), wave(10, [[2, 2.5]])]])
    expect(findPauses(one(), peaks, new Set(['a1']), S).pauses).toEqual([{ from: 63, to: 72 }])
  })

  it('does not count a quiet run shorter than the shortest pause', () => {
    const peaks = new Map([[peaksKey('a', 0), wave(10, [[2, 2.4]])]])
    expect(findPauses(one(), peaks, new Set(['a1']), S).pauses).toEqual([])
  })

  it('takes nothing out of a pause no longer than the length to leave', () => {
    const peaks = new Map([[peaksKey('a', 0), wave(10, [[2, 2.5]])]])
    expect(findPauses(one(), peaks, new Set(['a1']), { ...S, leaveSec: 0.5 }).pauses).toEqual([])
  })

  it('counts a level just under the one set as quiet, and one just over as sound', () => {
    // -40 dB of full scale is 327.7.
    const under = new Map([[peaksKey('a', 0), wave(10, [[2, 3, 320]])]])
    const over = new Map([[peaksKey('a', 0), wave(10, [[2, 3, 335]])]])
    expect(findPauses(one(), under, new Set(['a1']), S).pauses).toHaveLength(1)
    expect(findPauses(one(), over, new Set(['a1']), S).pauses).toHaveLength(0)
  })

  it("counts the clip's gain", () => {
    const peaks = new Map([[peaksKey('a', 0), wave(10, [[2, 3, 200]])]])
    const t = one()
    expect(findPauses(t, peaks, new Set(['a1']), S).pauses).toHaveLength(1)
    const louder = setClipAudio(t, 'A.1', { gain: 2, muted: false })
    expect(findPauses(louder, peaks, new Set(['a1']), S).pauses).toHaveLength(0)
  })

  it('listens to a muted clip on a track that is ticked, and not to a track that is not', () => {
    let t = sequence(media('a', 10, { audioTracks: 2 }))
    t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
    const a2 = t.audioTracks[1]!.id
    // The mix on the first stream is loud throughout; the microphone alone, muted, has a pause.
    const peaks = new Map([
      [peaksKey('a', 0), wave(10, [])],
      [peaksKey('a', 1), wave(10, [[4, 5]])]
    ])
    expect(findPauses(t, peaks, new Set([a2]), S).pauses).toEqual([{ from: 123, to: 147 }])
    expect(findPauses(t, peaks, new Set(['a1']), S).pauses).toEqual([])
    // Both ticked: quiet only where both are.
    expect(findPauses(t, peaks, new Set(['a1', a2]), S).pauses).toEqual([])
  })

  it('never finds a pause where no ticked track has sound, or in a gap on V1', () => {
    let t = sequence(media('mute', 4, { hasAudio: false }), media('b', 4))
    // A picture with no sound of its own, then a gap, then b, quiet at its start and at its end.
    t = addSource(t, { mediaId: 'mute', clipId: 'M', at: 0, onTrack: 'v1' })
    t = addSource(t, { mediaId: 'b', clipId: 'B', at: 180, onTrack: 'v1' })
    const peaks = new Map([[peaksKey('b', 0), wave(4, [[0, 0.5], [3, 4]])]])
    // b's quiet start does not run back into the gap, or the picture with no sound before it.
    expect(findPauses(t, peaks, new Set(['a1']), S).pauses).toEqual([
      { from: 183, to: 192 },
      { from: 273, to: 297 }
    ])
  })

  it('breaks a quiet run where V1 has a gap, even when a track listened to is quiet all through it', () => {
    let t = sequence(media('a', 4), media('b', 4), media('vo', 10, { hasVideo: false, width: 0, height: 0 }))
    t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
    t = addSource(t, { mediaId: 'b', clipId: 'B', at: 180, onTrack: 'v1' })
    t = addTrack(t, 'audio', 'vo')
    t = addSource(t, { mediaId: 'vo', clipId: 'VO', at: 0, onTrack: 'vo' })
    // The voice over is quiet from 105 to 195: over A's last 15 frames, the gap, and B's first 15.
    const peaks = new Map([[peaksKey('vo', 0), wave(10, [[3.5, 6.5]])]])
    expect(findPauses(t, peaks, new Set(['vo']), S).pauses).toEqual([
      { from: 108, to: 117 },
      { from: 183, to: 192 }
    ])
  })

  it('never finds a pause past the end of V1', () => {
    let t = sequence(media('a', 4), media('song', 20, { hasVideo: false, width: 0, height: 0 }))
    t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
    t = addTrack(t, 'audio', 'music')
    t = addSource(t, { mediaId: 'song', clipId: 'S', at: 0, onTrack: 'music' })
    // The song is loud under the picture and silent after it.
    const peaks = new Map([
      [peaksKey('a', 0), wave(4, [])],
      [peaksKey('song', 0), wave(20, [[4, 20]])]
    ])
    expect(findPauses(t, peaks, new Set(['music']), S).pauses).toEqual([])
  })

  it('says it is waiting, and finds nothing there, while a waveform has not loaded', () => {
    const found = findPauses(one(), new Map(), new Set(['a1']), S)
    expect(found).toEqual({ pauses: [], waiting: true })
  })

  it('finds one pause across a cut between two clips on V1', () => {
    let t = sequence(media('a', 4), media('b', 4))
    t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
    t = addSource(t, { mediaId: 'b', clipId: 'B', at: 120, onTrack: 'v1' })
    const peaks = new Map([
      [peaksKey('a', 0), wave(4, [[3.6, 4]])],
      [peaksKey('b', 0), wave(4, [[0, 0.4]])]
    ])
    expect(findPauses(t, peaks, new Set(['a1']), S).pauses).toEqual([{ from: 111, to: 129 }])
  })

  it('reads the part of the recording a trimmed clip shows', () => {
    let t = one()
    t = setClipIn(t, 'A', 30)
    t = moveClipTo(t, 'A', 'v1', 0)
    const peaks = new Map([[peaksKey('a', 0), wave(10, [[2, 3]])]])
    // The recording's 60 to 90 is now the sequence's 30 to 60.
    expect(findPauses(t, peaks, new Set(['a1']), S).pauses).toEqual([{ from: 33, to: 57 }])
  })

  it('has the defaults the plan gives', () => {
    expect(DEFAULT_SILENCE_SETTINGS).toEqual({ levelDb: -40, shortestSec: 0.5, leaveSec: 0.2 })
  })
})

describe('taking stretches out', () => {
  it('takes a stretch out of the middle of a clip and its sound, closing up, the two sides apart', () => {
    const t = removeStretches(one(), [{ from: 60, to: 90 }])
    expect(timelineDuration(t)).toBe(270)
    const pictures = v1Clips(t)
    expect(pictures.map((c) => [c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      [0, 0, 60],
      [60, 90, 300]
    ])
    const sounds = t.audioTracks[0]!.clips
    expect(sounds.map((c) => [c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      [0, 0, 60],
      [60, 90, 300]
    ])
    // Each side is a group of its own, as a split makes them.
    expect(linkedIds(t, pictures[0]!.id).sort()).toEqual([pictures[0]!.id, sounds[0]!.id].sort())
    expect(linkedIds(t, pictures[1]!.id).sort()).toEqual([pictures[1]!.id, sounds[1]!.id].sort())
    // The first side keeps its ids.
    expect(pictures[0]!.id).toBe('A')
    expect(sounds[0]!.id).toBe('A.1')
    expectTracksWhole(t)
    expectGroupsInStep(t)
  })

  it('cuts a voice on a track listened to with the pictures, linked to them or not, so it stays in step', () => {
    // Audit 2026-10-19: a voice from a separate recorder on its own track,
    // listened to, was left whole while the pictures were cut, and ran later
    // than them by every pause taken out.
    let t = sequence(media('a', 10), media('vo', 10, { hasVideo: false, width: 0, height: 0 }))
    t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
    t = setClipAudio(t, 'A.1', { gain: 1, muted: true })
    t = addTrack(t, 'audio', 'vo')
    t = addSource(t, { mediaId: 'vo', clipId: 'VO', at: 0, onTrack: 'vo' })
    expect(removableStretches(t, [{ from: 60, to: 90 }], ['vo'])).toEqual([{ from: 60, to: 90 }])
    t = removeStretches(t, [{ from: 60, to: 90 }], ['vo'])
    const voice = t.audioTracks.find((r) => r.id === 'vo')!.clips
    expect(voice.map((c) => [c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      [0, 0, 60],
      [60, 90, 300]
    ])
    // The voice says at each frame what was said over the picture there before.
    expect(v1Clips(t).map((c) => [c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      [0, 0, 60],
      [60, 90, 300]
    ])
    expectTracksWhole(t)
  })

  it('takes a stretch across a cut out of both clips', () => {
    let t = sequence(media('a', 4), media('b', 4))
    t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
    t = addSource(t, { mediaId: 'b', clipId: 'B', at: 120, onTrack: 'v1' })
    t = removeStretches(t, [{ from: 100, to: 140 }])
    const s = spans(t)
    expect(s.A).toEqual([0, 0, 100])
    expect(s['A.1']).toEqual([0, 0, 100])
    // B lost its first 20 frames and starts where A now ends; it keeps its ids, having no piece before.
    expect(s.B).toEqual([100, 20, 120])
    expect(s['B.1']).toEqual([100, 20, 120])
    expect(linkedIds(t, 'B').sort()).toEqual(['B', 'B.1'])
    expect(timelineDuration(t)).toBe(200)
    expectTracksWhole(t)
    expectGroupsInStep(t)
  })

  it("keeps an L-cut in step: the picture's sound running on under the next clip is cut with it", () => {
    let t = sequence(media('p', 20), media('q', 20))
    t = addSource(t, { mediaId: 'p', clipId: 'P', at: 0, onTrack: 'v1', streams: [0] })
    t = setClipOut(t, 'P', 300)
    t = addSource(t, { mediaId: 'q', clipId: 'Q', at: 300, onTrack: 'v1', streams: [0] })
    t = setClipOut(t, 'Q', 300)
    t = setClipIn(t, 'Q.1', 30, true)
    t = setClipOut(t, 'P.1', 330, true)
    // P's sound runs to 330 under Q. Take out 280 to 300, the end of P's picture.
    t = removeStretches(t, [{ from: 280, to: 300 }])
    const s = spans(t)
    expect(s.P).toEqual([0, 0, 280])
    // P's sound: the part before the stretch keeps its id; the part after it, under Q, still plays under Q.
    expect(s['P.1']).toEqual([0, 0, 280])
    const tail = t.audioTracks[0]!.clips.find((c) => c.mediaId === 'p' && c.id !== 'P.1')!
    expect([tail.timelineStart, tail.sourceIn, tail.sourceOut]).toEqual([280, 300, 330])
    expect(s.Q).toEqual([280, 0, 300])
    expectTracksWhole(t)
    expectGroupsInStep(t)
  })

  it("keeps a J-cut in step: the next picture's sound leading in is cut with its picture", () => {
    let t = sequence(media('p', 20), media('q', 20))
    t = addSource(t, { mediaId: 'p', clipId: 'P', at: 0, onTrack: 'v1', streams: [0] })
    t = setClipOut(t, 'P', 300)
    t = addSource(t, { mediaId: 'q', clipId: 'Q', at: 300, onTrack: 'v1', streams: [0] })
    t = setClipIn(t, 'Q', 30)
    t = setClipOut(t, 'Q', 330)
    t = moveClipTo(t, 'Q', 'v1', 300)
    t = setClipOut(t, 'P.1', 270, true)
    t = setClipIn(t, 'Q.1', 0, true)
    // Q's sound leads in from 270 under P. Take out 260 to 290.
    t = removeStretches(t, [{ from: 260, to: 290 }])
    const s = spans(t)
    expect(s.P).toEqual([0, 0, 260])
    expect(s['P.1']).toEqual([0, 0, 260])
    // Q's sound lost its first 20 frames and still leads in, 10 frames before its picture.
    expect(s['Q.1']).toEqual([260, 20, 330])
    expect(s.Q).toEqual([270, 30, 330])
    expectTracksWhole(t)
    expectGroupsInStep(t)
  })

  it('moves an overlay after the stretch earlier, and leaves one across it and music under it whole', () => {
    let t = sequence(media('a', 20), media('o', 2), media('o2', 2), media('song', 30, { hasVideo: false, width: 0, height: 0 }))
    t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
    t = addTrack(t, 'video', 'v2')
    t = addSource(t, { mediaId: 'o', clipId: 'O', at: 90, onTrack: 'v2', streams: [] })
    t = addSource(t, { mediaId: 'o2', clipId: 'O2', at: 300, onTrack: 'v2', streams: [] })
    t = addTrack(t, 'audio', 'music')
    t = addSource(t, { mediaId: 'song', clipId: 'S', at: 0, onTrack: 'music' })
    t = removeStretches(t, [{ from: 100, to: 130 }])
    const s = spans(t)
    // O runs across the stretch and stays whole where it is; O2 after it moves 30 earlier.
    expect(s.O).toEqual([90, 0, 60])
    expect(s.O2).toEqual([270, 0, 60])
    expect(s.S).toEqual([0, 0, 900])
    expectTracksWhole(t)
  })

  it('applies several stretches from the last to the first, so each is where it was found', () => {
    const t = removeStretches(one(), [
      { from: 60, to: 90 },
      { from: 150, to: 180 }
    ])
    expect(v1Clips(t).map((c) => [c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      [0, 0, 60],
      [60, 90, 150],
      [120, 180, 300]
    ])
    expect(timelineDuration(t)).toBe(240)
    expectTracksWhole(t)
    expectGroupsInStep(t)
  })

  it('drops stretches that overlap, are empty, or lie outside the pictures on V1', () => {
    let t = sequence(media('a', 4), media('b', 4))
    t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
    t = addSource(t, { mediaId: 'b', clipId: 'B', at: 180, onTrack: 'v1' })
    const before = t
    t = removeStretches(t, [
      { from: 50, to: 50 },
      { from: 110, to: 190 },
      { from: 300, to: 330 },
      { from: 20, to: 40 },
      { from: 30, to: 60 }
    ])
    // Only 20 to 40 is taken out: 30 to 60 overlaps it, 110 to 190 crosses the gap, 300 on is past V1.
    expect(spans(t).A).toEqual([0, 0, 20])
    expect(timelineDuration(t)).toBe(timelineDuration(before) - 20)
    expectTracksWhole(t)
    expectGroupsInStep(t)
  })

  it('does nothing for no stretches', () => {
    const t = one()
    expect(removeStretches(t, [])).toBe(t)
  })

  /**
   * V1: A (a phone recording, one stream, 0 to 300), then B (an OBS
   * recording, two streams, 300 to 600). A1 holds A's sound and B's first
   * stream; B's microphone stream is on a second track, where a voice over
   * recorded over A lies from 150 to 290.
   */
  function voiceOverBesideMic(): Timeline {
    let t = sequence(media('a', 10), media('b', 10, { audioTracks: 2 }), media('vo', 140 / 30, { hasVideo: false, width: 0, height: 0 }))
    t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
    t = addSource(t, { mediaId: 'b', clipId: 'B', at: 300, onTrack: 'v1' })
    const mic = findClip(t, 'B.2')!
    return addSource(t, { mediaId: 'vo', clipId: 'VO', at: 150, onTrack: mic.kind === 'audio' ? mic.track.id : '' })
  }

  it('leaves out a stretch whose closing up would push a clip after it along its track, out of step with its picture', () => {
    const t = voiceOverBesideMic()
    expect(findClip(t, 'VO')!.kind === 'audio' && findClip(t, 'B.2')!.kind === 'audio').toBe(true)
    // Taking 200 to 260 out would bring B.2 up against the voice over, which stays whole across it.
    const stretch = { from: 200, to: 260 }
    expect(removableStretches(t, [stretch])).toEqual([])
    const out = removeStretches(t, [stretch])
    expectGroupsInStep(out)
    expectTracksWhole(out)
    expect(spans(out)['B.2']).toEqual(spans(t)['B.2'])
    expect(timelineDuration(out)).toBe(v1End(out))
  })

  it('takes out the stretches that close up cleanly and leaves only the ones that would not', () => {
    const t = voiceOverBesideMic()
    // 400 to 430 is inside B, after the voice over, and comes out; 200 to 260 cannot.
    const stretches = [
      { from: 200, to: 260 },
      { from: 400, to: 430 }
    ]
    expect(removableStretches(t, stretches)).toEqual([{ from: 400, to: 430 }])
    const out = removeStretches(t, stretches)
    expect(timelineDuration(out)).toBe(570)
    expect(timelineDuration(out)).toBe(v1End(out))
    expectGroupsInStep(out)
    expectTracksWhole(out)
  })
})
