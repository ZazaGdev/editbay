import { describe, it, expect } from 'vitest'
import {
  addClip,
  addSource,
  addTrack,
  createTimeline,
  findClip,
  linkedIds,
  moveClipTo,
  openUpStretch,
  prepareDrop,
  rearrangeClip,
  rippleTrim,
  setClipIn,
  setClipOut,
  v1Clips,
  type ProjectMedia,
  type Timeline,
  trimToFrame,
  trimToFrameBlockers
} from '../../src/shared/project'
import { spanEnd } from '../../src/shared/tracks'

/**
 * Plan 12 step 3: drags that close up and open up. Ctrl on an edge trims and
 * moves everything after it; Ctrl on a clip takes it out and puts it in; a
 * drop with Ctrl opens up for what is dropped; the lane past the last track
 * makes a new one.
 */

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
 * V1: a (0 to 300), b (300 to 420) and c (420 to 480), each with its sound
 * linked on A1, and a song on A2 from 0 running under all of them.
 */
function cut(): Timeline {
  let t = createTimeline(30, { width: 1080, height: 1920 })
  t = { ...t, media: [media('a', 10), media('b', 4), media('c', 2), media('song', 20, { hasVideo: false, width: 0, height: 0 })] }
  t = addClip(t, 'a', 'A')
  t = addClip(t, 'b', 'B')
  t = addClip(t, 'c', 'C')
  t = addTrack(t, 'audio', 'a2')
  return addSource(t, { mediaId: 'song', clipId: 'S', at: 0, onTrack: 'a2' })
}

/**
 * V1: P (p, 0 to 300) and Q (q, 300 to 600), each with its sound on A1. With
 * `cut` 'l', P's sound runs on 30 frames under Q, an L-cut; with 'j', Q's
 * sound leads in 30 frames under P, a J-cut, Q showing its recording from 30.
 */
function split(cut: 'l' | 'j'): Timeline {
  let t = createTimeline(30, { width: 1080, height: 1920 })
  t = { ...t, media: [media('p', 20), media('q', 20), media('c', 2)] }
  t = addSource(t, { mediaId: 'p', clipId: 'P', at: 0, onTrack: 'v1', streams: [0] })
  t = setClipOut(t, 'P', 300)
  if (cut === 'l') {
    t = addSource(t, { mediaId: 'q', clipId: 'Q', at: 300, onTrack: 'v1', streams: [0] })
    t = setClipOut(t, 'Q', 300)
    t = setClipIn(t, 'Q.1', 30, true)
    return setClipOut(t, 'P.1', 330, true)
  }
  t = addSource(t, { mediaId: 'q', clipId: 'Q', at: 300, onTrack: 'v1', streams: [0] })
  t = setClipIn(t, 'Q', 30)
  t = setClipOut(t, 'Q', 330)
  t = moveClipTo(t, 'Q', 'v1', 300)
  t = setClipOut(t, 'P.1', 270, true)
  return setClipIn(t, 'Q.1', 0, true)
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

/** Whether each group's clips are still in step: the same frame of their recordings at the same moment. */
function expectInStep(t: Timeline, a: string, b: string): void {
  const x = findClip(t, a)!.clip
  const y = findClip(t, b)!.clip
  expect(x.timelineStart - x.sourceIn, `${a} against ${b}`).toBe(y.timelineStart - y.sourceIn)
}

/** Where every clip is, by id: its start and its length. */
function spans(t: Timeline): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {}
  for (const track of [...t.videoTracks, ...t.audioTracks]) {
    for (const c of track.clips) out[c.id] = [c.timelineStart, c.sourceOut - c.sourceIn]
  }
  return out
}

describe('opening up a stretch', () => {
  it('moves everything from that frame later, and cuts what runs across it where something goes in, with its linked clips', () => {
    const t = openUpStretch(cut(), 350, 30, new Set(), new Set(['v1']))
    const s = spans(t)
    // a is before 350 and stays. c starts after and moves 30 later.
    expect(s.A).toEqual([0, 300])
    expect(s.C).toEqual([450, 60])
    expect(s['C.1']).toEqual([450, 60])
    // b runs across 350: cut there, its second piece moved on with its sound's.
    expect(s.B).toEqual([300, 50])
    const second = v1Clips(t).find((c) => c.timelineStart === 380)!
    expect(second.sourceOut - second.sourceIn).toBe(70)
    expect(second.sourceIn).toBe(50)
    const secondSound = t.audioTracks[0]!.clips.find((c) => c.timelineStart === 380)!
    expect(secondSound.link).toBe(second.link)
    expect(second.link).not.toBe(findClip(t, 'B')!.clip.link)
    // The song running under all of it stays whole, as it does when the sequence closes up.
    expect(spans(t).S).toEqual([0, 600])
  })

  it('cuts nothing that runs across it when nothing is to go in, as when a trim opens up', () => {
    const t = openUpStretch(cut(), 350, 30)
    expect(spans(t).B).toEqual([300, 120])
    expect(spans(t).C).toEqual([450, 60])
    expect(spans(t).S).toEqual([0, 600])
  })

  it('leaves the clips named alone, and does nothing for no frames', () => {
    const t = cut()
    expect(openUpStretch(t, 350, 0)).toBe(t)
    const s = spans(openUpStretch(t, 0, 30, new Set(['S'])))
    expect(s.S).toEqual([0, 600])
    expect(s.A).toEqual([30, 300])
  })
})

describe('a trim that closes up or opens up, on any track', () => {
  it('pulls everything after in by what the end loses, the clip\'s sound trimmed with it, the song under it left', () => {
    const t = rippleTrim(cut(), 'A', 'end', 240)
    const s = spans(t)
    expect(s.A).toEqual([0, 240])
    expect(s['A.1']).toEqual([0, 240])
    expect(s.B).toEqual([240, 120])
    expect(s['B.1']).toEqual([240, 120])
    expect(s.C).toEqual([360, 60])
    expect(s.S).toEqual([0, 600])
  })

  it('pushes everything after out by what the end gains, as far as the recording goes', () => {
    const t = rippleTrim(rippleTrim(cut(), 'B', 'end', 60), 'B', 'end', 500)
    // b is 120 frames long at most.
    expect(spans(t).B).toEqual([300, 120])
    expect(spans(t).C).toEqual([420, 60])
    const longer = rippleTrim(rippleTrim(cut(), 'B', 'end', 60), 'B', 'end', 90)
    expect(spans(longer).B).toEqual([300, 90])
    expect(spans(longer).C).toEqual([390, 60])
  })

  it('keeps the start on a head trim, what it shows moving, and everything after it moving with it', () => {
    const shorter = rippleTrim(cut(), 'B', 'start', 20)
    expect(spans(shorter).B).toEqual([300, 100])
    expect(findClip(shorter, 'B')!.clip.sourceIn).toBe(20)
    expect(spans(shorter).C).toEqual([400, 60])
    // Back out again: the head as far as the recording's start opens up the sequence again.
    const back = rippleTrim(shorter, 'B', 'start', 0)
    expect(spans(back)).toEqual(spans(cut()))
  })

  it('lengthens the head of a J-cut from its picture, leaving a clip sitting in its lead-in where it is (audit 2026-10-01)', () => {
    // Q's sound leads in from 280 under the end of P; P is cut at 290, and a short clip X sits from 290 to 300 on V1.
    let t = split('j')
    t = setClipIn(t, 'Q.1', 10, true)
    t = setClipOut(t, 'P', 290)
    t = addSource({ ...t, media: [...t.media] }, { mediaId: 'c', clipId: 'X', at: 290, onTrack: 'v1', streams: [] })
    t = setClipOut(t, 'X', 10)
    expect(spans(t).X).toEqual([290, 10])
    expect(spans(t)['Q.1']![0]).toBe(280)
    // Q's head ten frames earlier: it shows ten more frames of its recording.
    const longer = rippleTrim(t, 'Q', 'start', findClip(t, 'Q')!.clip.sourceIn - 10)
    expect(spans(longer).X).toEqual([290, 10])
    expectTracksWhole(longer)
    expectInStep(longer, 'Q', 'Q.1')
  })

  it('trims a song on A2 with Ctrl as a plain trim: nothing of it is on V1, so nothing else moves', () => {
    let t = cut()
    t = addSource(t, { mediaId: 'song', clipId: 'T', at: 480, onTrack: 'a2' })
    // The song on A2 from 0 is cut at 480 by the second, which covers it from there.
    expect(spans(t).T).toEqual([480, 600])
    const trimmed = rippleTrim(t, 'S', 'end', 240)
    expect(trimmed).toEqual(setClipOut(t, 'S', 240))
    expect(spans(trimmed).S).toEqual([0, 240])
    expect(spans(trimmed).T).toEqual([480, 600])
    expect(spans(trimmed).B).toEqual([300, 120])
    expect(spans(trimmed).C).toEqual([420, 60])
  })

  it('does nothing when the edge does not move, or would leave nothing', () => {
    const t = cut()
    expect(rippleTrim(t, 'B', 'end', 120)).toBe(t)
    expect(spans(rippleTrim(t, 'B', 'end', 0)).B).toEqual([300, 1])
    expect(rippleTrim(t, 'missing', 'end', 10)).toBe(t)
  })
})

describe('taking a clip out and putting it in', () => {
  it('puts V1\'s last clip first, with its sound, and leaves no gap anywhere on V1', () => {
    const t = rearrangeClip(cut(), 'C', 'v1', 0)
    expect(v1Clips(t).map((c) => [c.id, c.timelineStart])).toEqual([
      ['C', 0],
      ['A', 60],
      ['B', 360]
    ])
    expect(spans(t)['C.1']).toEqual([0, 60])
    expect(spans(t)['A.1']).toEqual([60, 300])
  })

  it('puts a clip in later, where it was let go on the sequence as it was', () => {
    // a let go at 480, the end of c, lands at the end once it is taken out.
    const t = rearrangeClip(cut(), 'A', 'v1', 480)
    expect(v1Clips(t).map((c) => [c.id, c.timelineStart])).toEqual([
      ['B', 0],
      ['C', 120],
      ['A', 180]
    ])
    expect(Math.max(...v1Clips(t).map(spanEnd))).toBe(480)
  })

  it('takes the whole group, and onto another video track with the sound staying on its tracks', () => {
    let t = addTrack(cut(), 'video', 'v2')
    t = rearrangeClip(t, 'B', 'v2', 0)
    expect(t.videoTracks[1]!.clips.map((c) => [c.id, c.timelineStart])).toEqual([['B', 0]])
    expect(spans(t)['B.1']).toEqual([0, 120])
    expect(t.audioTracks[0]!.clips.find((c) => c.id === 'B.1')).toBeDefined()
    expect(linkedIds(t, 'B')).toEqual(expect.arrayContaining(['B', 'B.1']))
  })

  it('refuses a track of the other kind', () => {
    const t = cut()
    expect(rearrangeClip(t, 'B', 'a2', 0)).toBe(t)
  })
})

describe('a drop that puts in, and new tracks from the lane', () => {
  it('opens up for a dropped recording with Ctrl, rather than covering', () => {
    const t = prepareDrop(cut(), { mediaId: 'c', clipId: 'D', at: 300, onTrack: 'v1' }, { insert: true })
    const placed = addSource(t, { mediaId: 'c', clipId: 'D', at: 300, onTrack: 'v1' })
    expect(v1Clips(placed).map((c) => [c.id, c.timelineStart])).toEqual([
      ['A', 0],
      ['D', 300],
      ['B', 360],
      ['C', 480]
    ])
  })

  it('makes the track a drop on the lane names, of the kind it says', () => {
    const t = prepareDrop(cut(), { mediaId: 'c', clipId: 'D', at: 0, onTrack: 'v-new' }, { newTrack: 'video' })
    expect(t.videoTracks.map((r) => r.id)).toEqual(['v1', 'v-new'])
    const placed = addSource(t, { mediaId: 'c', clipId: 'D', at: 0, onTrack: 'v-new' })
    expect(placed.videoTracks[1]!.clips.map((c) => c.id)).toEqual(['D'])
  })

  it('moves a clip onto a new track made for it, and only when asked', () => {
    const t = cut()
    const moved = moveClipTo(t, 'C', 'v-new', 100, { newTrack: true })
    expect(moved.videoTracks.map((r) => r.id)).toEqual(['v1', 'v-new'])
    expect(moved.videoTracks[1]!.clips.map((c) => [c.id, c.timelineStart])).toEqual([['C', 100]])
    expect(moveClipTo(t, 'C', 'v-new', 100)).toBe(t)
  })
})

describe('fixes from the review of step 3', () => {
  it('ripples an L-cut from the group\'s edge, overlapping nothing and keeping the next clip\'s sound on its picture', () => {
    const t = split('l')
    const out = rippleTrim(t, 'P.1', 'end', 350)
    expect(spans(out).P).toEqual([0, 320])
    expect(spans(out).Q).toEqual([320, 300])
    expect(spans(out)['Q.1']).toEqual([350, 270])
    expectInStep(out, 'Q', 'Q.1')
    expectTracksWhole(out)
    const back = rippleTrim(t, 'P.1', 'end', 310)
    expect(spans(back).Q).toEqual([280, 300])
    expect(spans(back)['Q.1']).toEqual([310, 270])
    expectInStep(back, 'Q', 'Q.1')
    expectTracksWhole(back)
    // And from the picture's head, the J-cut's sound leading in.
    const j = split('j')
    for (const frame of [10, 60]) {
      const r = rippleTrim(j, 'Q', 'start', frame)
      expectInStep(r, 'Q', 'Q.1')
      expectTracksWhole(r)
    }
  })

  it('cuts a J-cut\'s sound across the point of an insert, so it moves on with its picture', () => {
    const t = split('j')
    const drop = { mediaId: 'c', clipId: 'D', at: 285, onTrack: 'v1', streams: [0] }
    const r = addSource(prepareDrop(t, drop, { insert: true }), drop)
    expectTracksWhole(r)
    const q = findClip(r, 'Q')!.clip
    const under = r.audioTracks[0]!.clips.find((c) => c.mediaId === 'q' && c.timelineStart <= q.timelineStart && spanEnd(c) > q.timelineStart)!
    expect(under.timelineStart - under.sourceIn).toBe(q.timelineStart - q.sourceIn)
    expect(linkedIds(r, 'Q')).toContain(under.id)
    // Its first piece stays before the insert, linked to nothing that moved.
    const first = r.audioTracks[0]!.clips.find((c) => c.mediaId === 'q' && spanEnd(c) === 285)!
    expect(linkedIds(r, first.id)).not.toContain('Q')
  })

  it('drops a picture with Ctrl on V2 as a plain drop, over V1 as it was, the song whole', () => {
    let t = addTrack(cut(), 'video', 'v2')
    t = { ...t, media: [...t.media, media('k', 2, { hasAudio: false })] }
    const drop = { mediaId: 'k', clipId: 'K', at: 350, onTrack: 'v2', streams: [] }
    expect(prepareDrop(t, drop, { insert: true })).toBe(t)
    const r = addSource(prepareDrop(t, drop, { insert: true }), drop)
    expectTracksWhole(r)
    expect(spans(r).K).toEqual([350, 60])
    expect(spans(r).B).toEqual([300, 120])
    expect(v1Clips(r).map((c) => c.timelineStart)).toEqual([0, 300, 420])
    expect(spans(r).S).toEqual([0, 600])
  })

  it('changes nothing when a clip is let go where it began', () => {
    let t = addTrack(cut(), 'audio', 'a3')
    t = addSource(t, { mediaId: 'song', clipId: 'F', at: 350, onTrack: 'a3' })
    expect(rearrangeClip(t, 'B', 'v1', 300)).toBe(t)
    expect(rearrangeClip(t, 'B', 'v1', 350)).toBe(t)
  })

  it('makes a new track only when something goes on it', () => {
    const t = cut()
    // The song dropped on the lane for a new video track: its sound goes on an audio track, and no video track is made.
    const drop = { mediaId: 'song', clipId: 'T', at: 0, onTrack: 'v-new' }
    const r = addSource(prepareDrop(t, drop, { newTrack: 'video' }), drop)
    expect(r.videoTracks.map((x) => x.id)).toEqual(['v1'])
    expect(findClip(r, 'T')).toBeDefined()
  })
})

describe('Ctrl closes up and opens up from V1 only', () => {
  /** cut(), with a picture K on V2 from 250 to 290, over the end of a and the start of b. */
  function overlaid(): Timeline {
    let t = addTrack(cut(), 'video', 'v2')
    t = { ...t, media: [...t.media, media('k', 4, { hasAudio: false })] }
    t = addSource(t, { mediaId: 'k', clipId: 'K', at: 250, onTrack: 'v2', streams: [] })
    return setClipOut(t, 'K', 40)
  }

  it('makes an overlay longer or shorter as a plain trim: it covers more of V1 or shows it again, and V1 stays', () => {
    const t = overlaid()
    const longer = rippleTrim(t, 'K', 'end', 70)
    expect(spans(longer).K).toEqual([250, 70])
    expect(longer).toEqual(setClipOut(t, 'K', 70))
    const shorter = rippleTrim(t, 'K', 'start', 20)
    expect(spans(shorter).K).toEqual([270, 20])
    for (const r of [longer, shorter]) {
      expect(v1Clips(r).map((c) => [c.id, c.timelineStart, c.sourceOut - c.sourceIn])).toEqual([
        ['A', 0, 300],
        ['B', 300, 120],
        ['C', 420, 60]
      ])
      expect(spans(r).S).toEqual([0, 600])
    }
  })

  it('still closes up from a V1 clip\'s own sound, which is linked to V1', () => {
    const t = cut()
    const sound = linkedIds(t, 'A').find((id) => id !== 'A')!
    const r = rippleTrim(t, sound, 'end', 240)
    expect(spans(r).A).toEqual([0, 240])
    expect(spans(r).B).toEqual([240, 120])
  })

  it('moves a clip along V2 with Ctrl as a plain move, but takes one onto V1 out and in', () => {
    const t = overlaid()
    expect(moveClipTo(t, 'K', 'v2', 100, { insert: true })).toEqual(moveClipTo(t, 'K', 'v2', 100))
    // Put in on V1 at b's start: b and c move on by its length.
    const onto = moveClipTo(t, 'K', 'v1', 300, { insert: true })
    expect(v1Clips(onto).map((c) => [c.id, c.timelineStart])).toEqual([
      ['A', 0],
      ['K', 300],
      ['B', 340],
      ['C', 460]
    ])
    expectTracksWhole(onto)
  })
})

describe('I and O on a clip whose sound is shorter than the cut (audit 2026-10-01)', () => {
  it('refuses, naming the sound, rather than holding it at one frame out of step', () => {
    // A's sound ends at 100, though its picture runs to 300.
    const t = setClipOut(cut(), 'A.1', 100, true)
    expect(trimToFrameBlockers(t, 'A', 'start', 150).map((c) => c.id)).toContain('A.1')
    expect(trimToFrame(t, 'A', 'start', 150)).toBe(t)
    // Where the sound is long enough, it trims as before.
    expect(trimToFrame(t, 'A', 'start', 50)).not.toBe(t)
  })
})

describe('an edge drag on V1 over a J-cut or an L-cut (plan 82 review)', () => {
  for (const kind of ['j', 'l'] as const) {
    for (const edge of ['start', 'end'] as const) {
      for (const by of [-12, 12]) {
        it(`keeps every clip whole and each group in step, ${kind.toUpperCase()}-cut, ${edge}, ${by > 0 ? 'longer' : 'shorter'} by ${Math.abs(by)}`, () => {
          const t = split(kind)
          const q = findClip(t, 'Q')!.clip
          // Longer is the head earlier or the tail later.
          const frame = edge === 'start' ? q.sourceIn - by : q.sourceOut + by
          const after = rippleTrim(t, 'Q', edge, frame)
          expectTracksWhole(after)
          expectInStep(after, 'P', 'P.1')
          expectInStep(after, 'Q', 'Q.1')
        })
      }
    }
  }
})
