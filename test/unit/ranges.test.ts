import { describe, it, expect } from 'vitest'
import {
  addClip,
  addSource,
  allClips,
  createTimeline,
  findClip,
  liftRange,
  linkedIds,
  removeRange,
  rippleTrim,
  splitEverything,
  timelineDuration,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'
import { spanEnd, type Span } from '../../src/shared/tracks'

/**
 * A marked range, and cutting every track at once: Shift+S, then Delete over
 * a range to lift it and Shift+Delete to take it out closing up.
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

const SOUND = { hasVideo: false, width: 0, height: 0 }

/**
 * Three clips on V1, each with its sound on A1: p1 (0 to 300), p2 (300 to 420)
 * and p3 (420 to 540). Music under all of it on A2, from 0 to 600.
 */
function cut(): Timeline {
  let t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [media('a', 10), media('b', 4), media('song', 20, SOUND)]
  }
  t = addClip(t, 'a', 'p1')
  t = addClip(t, 'b', 'p2')
  t = addClip(t, 'b', 'p3')
  return addSource(t, { mediaId: 'song', clipId: 'music', at: 0 })
}

/**
 * V1: A (0 to 300), X (300 to 400) and B (400 to 700), an OBS recording whose
 * microphone stream B.2 is on A2. A voice over runs from 150 to 390 on that
 * track, across the start of X, which is what makes closing up over X refuse.
 */
function voiceOverBesideMic(): Timeline {
  let t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [media('a', 10), media('x', 10), media('b', 10, { audioTracks: 2 }), media('vo', 240 / 30, SOUND)]
  }
  t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
  t = addSource(t, { mediaId: 'x', clipId: 'X', at: 300, onTrack: 'v1' })
  t = rippleTrim(t, 'X', 'end', 100)
  t = addSource(t, { mediaId: 'b', clipId: 'B', at: 400, onTrack: 'v1' })
  const mic = findClip(t, 'B.2')!
  return addSource(t, { mediaId: 'vo', clipId: 'VO', at: 150, onTrack: mic.kind === 'audio' ? mic.track.id : '' })
}

/**
 * A J-cut: shot B's sound comes in before its picture. V1 holds A (0 to 400)
 * and B's picture (500 to 1000); A1 holds A's sound (0 to 400) and B's sound
 * from 400, a hundred frames before its picture. B's picture and sound are one
 * group, so a cut anywhere in that lead-in cuts the sound and not the picture.
 */
function jCut(): Timeline {
  let t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [media('a', 20), media('b', 20)]
  }
  t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
  t = rippleTrim(t, 'A', 'end', 400)
  t = addSource(t, { mediaId: 'b', clipId: 'B', at: 400, onTrack: 'v1' })
  // B's picture trimmed off its head by 100, leaving its sound where it was:
  // the two are still in step with their recording.
  const v1 = t.videoTracks[0]!
  return {
    ...t,
    videoTracks: [
      { ...v1, clips: v1.clips.map((c) => (c.id === 'B' ? { ...c, timelineStart: 500, sourceIn: c.sourceIn + 100 } : c)) },
      ...t.videoTracks.slice(1)
    ]
  }
}

/** The clips of the group a clip belongs to, by id, in track order. */
function groupOf(t: Timeline, clipId: string): string[] {
  return linkedIds(t, clipId).slice().sort()
}

/** Every track by its label, V1 up and A1 down, and each clip on it as its start and end. */
function shape(t: Timeline): Record<string, [number, number][]> {
  const out: Record<string, [number, number][]> = {}
  const each = (c: Span): [number, number] => [c.timelineStart, spanEnd(c)]
  t.videoTracks.forEach((r, i) => (out[`V${i + 1}`] = r.clips.map(each)))
  t.audioTracks.forEach((r, i) => (out[`A${i + 1}`] = r.clips.map(each)))
  return out
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

describe('splitEverything', () => {
  it('cuts every clip running across the frame, on every track', () => {
    const t = splitEverything(cut(), 200)
    expect(shape(t).V1).toEqual([
      [0, 200],
      [200, 300],
      [300, 420],
      [420, 540]
    ])
    expect(shape(t).A1).toEqual([
      [0, 200],
      [200, 300],
      [300, 420],
      [420, 540]
    ])
    expect(shape(t).A2).toEqual([
      [0, 200],
      [200, 600]
    ])
    expectGroupsInStep(t)
  })

  it('links the second pieces of a group to each other, and leaves the first pieces linked', () => {
    const t = splitEverything(cut(), 200)
    const [first, second] = t.videoTracks[0]!.clips
    expect(linkedIds(t, first!.id).length).toBe(2)
    expect(linkedIds(t, second!.id).length).toBe(2)
    expect(first!.link).not.toBe(second!.link)
    // The second picture and the second sound are one group.
    expect(linkedIds(t, second!.id)).toContain(t.audioTracks[0]!.clips[1]!.id)
  })

  it('leaves a clip whose edge is on the frame alone', () => {
    // 300 is where p1 ends and p2 begins: only the music runs across it.
    const t = splitEverything(cut(), 300)
    expect(shape(t).V1).toEqual([
      [0, 300],
      [300, 420],
      [420, 540]
    ])
    expect(shape(t).A2).toEqual([
      [0, 300],
      [300, 600]
    ])
  })

  it('keeps a picture with the body of its sound when the cut lands in a J-cut lead-in', () => {
    const t = jCut()
    // Only B's sound runs across 450: its picture starts at 500.
    const done = splitEverything(t, 450)
    const sounds = done.audioTracks[0]!.clips
    const lead = sounds.find((c) => c.timelineStart === 400)!
    const body = sounds.find((c) => c.timelineStart === 450)!
    // The picture goes with the sound under it, not with the sliver before the cut.
    expect(groupOf(done, 'B')).toEqual(groupOf(done, body.id))
    expect(groupOf(done, 'B')).not.toContain(lead.id)
    expect(body.link).toBeDefined()
    // The sliver is left on its own, which is what it now is.
    expect(groupOf(done, lead.id)).toEqual([lead.id])
    expectGroupsInStep(done)
  })

  it('leaves an L-cut group whole when the cut is past the picture but inside the sound', () => {
    // A's sound runs to 400 with its picture; cutting at 300 cuts both.
    const done = splitEverything(jCut(), 300)
    expect(groupOf(done, 'A').length).toBe(2)
    expectGroupsInStep(done)
  })

  it('does nothing at the start, past the end, or on an empty sequence', () => {
    const t = cut()
    expect(splitEverything(t, 0)).toBe(t)
    expect(splitEverything(t, 600)).toBe(t)
    expect(splitEverything(t, 1000)).toBe(t)
    const empty = createTimeline(30, { width: 1080, height: 1920 })
    expect(splitEverything(empty, 10)).toBe(empty)
  })
})

describe('liftRange', () => {
  it('takes the range out of every track, leaving a gap the same length', () => {
    const t = liftRange(cut(), 200, 400)
    expect(shape(t).V1).toEqual([
      [0, 200],
      [400, 420],
      [420, 540]
    ])
    expect(shape(t).A1).toEqual([
      [0, 200],
      [400, 420],
      [420, 540]
    ])
    expect(shape(t).A2).toEqual([
      [0, 200],
      [400, 600]
    ])
    // Nothing moved, so the sequence is as long as it was.
    expect(timelineDuration(t)).toBe(600)
    expectGroupsInStep(t)
  })

  it('cuts a clip that runs across one edge and keeps the part outside', () => {
    const t = liftRange(cut(), 500, 560)
    expect(shape(t).V1).toEqual([
      [0, 300],
      [300, 420],
      [420, 500]
    ])
    expect(shape(t).A2).toEqual([
      [0, 500],
      [560, 600]
    ])
  })

  it('does nothing for an empty or backwards range', () => {
    const t = cut()
    expect(liftRange(t, 200, 200)).toBe(t)
    expect(liftRange(t, 400, 200)).toBe(t)
  })
})

describe('removeRange', () => {
  it('takes the range out and moves everything after it up on every track', () => {
    const t = removeRange(cut(), 200, 400)
    expect(shape(t).V1).toEqual([
      [0, 200],
      [200, 220],
      [220, 340]
    ])
    expect(shape(t).A1).toEqual([
      [0, 200],
      [200, 220],
      [220, 340]
    ])
    // Music laid across the range is cut at both ends: what was under it stays, the rest moves up.
    expect(shape(t).A2).toEqual([
      [0, 200],
      [200, 400]
    ])
    expect(timelineDuration(t)).toBe(400)
    expectGroupsInStep(t)
  })

  it('is never refused, even where taking one clip out closing up would be', () => {
    const t = removeRange(voiceOverBesideMic(), 0, 400)
    expect(shape(t).V1).toEqual([[0, 300]])
    expect(shape(t).A1).toEqual([[0, 300]])
    expect(shape(t).A2).toEqual([[0, 300]])
    expect(timelineDuration(t)).toBe(300)
    expectGroupsInStep(t)
  })

  it('does nothing for an empty or backwards range', () => {
    const t = cut()
    expect(removeRange(t, 200, 200)).toBe(t)
    expect(removeRange(t, 400, 200)).toBe(t)
  })

  it('leaves the sequence as it was for a range past its end', () => {
    const t = cut()
    expect(shape(removeRange(t, 700, 900))).toEqual(shape(t))
    expect(shape(liftRange(t, 700, 900))).toEqual(shape(t))
    expect(timelineDuration(removeRange(t, 700, 900))).toBe(600)
  })

  it('takes a range out that lands in a J-cut lead-in without parting a group', () => {
    const done = removeRange(jCut(), 450, 480)
    expect(groupOf(done, 'B').length).toBe(2)
    expectGroupsInStep(done)
    // Everything after the range has moved up by its 30 frames.
    expect(shape(done).V1).toEqual([
      [0, 400],
      [470, 970]
    ])
  })
})
