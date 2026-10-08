import { describe, it, expect } from 'vitest'
import {
  addClip,
  allClips,
  closeUpClip,
  createTimeline,
  joinClips,
  joinNeighbour,
  joinRefusal,
  removedBetween,
  splitClip,
  v1Clips,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'

/**
 * Plan 59: two pieces of a split joined back into one clip, the linked sound
 * with its picture, and a join across a stretch that was taken out refused.
 */

function media(id: string, durationSec: number): ProjectMedia {
  return {
    id,
    originalPath: `C:\v\${id}.mp4`,
    playablePath: `C:\v\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** One 10 second recording on V1 with its sound on A1, cut at 100. */
function splitOnce(): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a', 10), media('b', 10)] }
  t = addClip(t, 'a', 'p')
  return splitClip(t, 100, 'p')
}

const pictures = (t: Timeline): { start: number; in: number; out: number }[] =>
  v1Clips(t).map((c) => ({ start: c.timelineStart, in: c.sourceIn, out: c.sourceOut }))
const sounds = (t: Timeline): { start: number; in: number; out: number }[] =>
  t.audioTracks[0]!.clips.map((c) => ({ start: c.timelineStart, in: c.sourceIn, out: c.sourceOut }))

describe('joining split clips', () => {
  it('makes the two pieces of a split one clip again, its sound with it', () => {
    const t = splitOnce()
    const [first, second] = v1Clips(t)
    expect(joinNeighbour(t, first!.id, 'next')).toBe(second!.id)
    expect(joinNeighbour(t, second!.id, 'previous')).toBe(first!.id)
    expect(joinRefusal(t, first!.id, second!.id)).toBeNull()
    const joined = joinClips(t, [first!.id, second!.id])
    expect(pictures(joined)).toEqual([{ start: 0, in: 0, out: 300 }])
    expect(sounds(joined)).toEqual([{ start: 0, in: 0, out: 300 }])
    // Still one group: the picture and its sound are linked.
    const [pic] = v1Clips(joined)
    expect(joined.audioTracks[0]!.clips[0]!.link).toBe(pic!.link)
    expect(pic!.id).toBe(first!.id)
  })

  it('joins a row of pieces all at once', () => {
    let t = splitOnce()
    t = splitClip(t, 200, v1Clips(t)[1]!.id)
    expect(v1Clips(t)).toHaveLength(3)
    const joined = joinClips(t, v1Clips(t).map((c) => c.id))
    expect(pictures(joined)).toEqual([{ start: 0, in: 0, out: 300 }])
    expect(allClips(joined)).toHaveLength(2)
  })

  it('keeps the first piece’s transition in and the second’s out, and drops the one on the cut', () => {
    const t = splitOnce()
    const [a, b] = v1Clips(t)
    const fade = { kind: 'dissolve', length: 10 } as never
    const withTransitions: Timeline = {
      ...t,
      videoTracks: [
        {
          ...t.videoTracks[0]!,
          clips: [
            { ...a!, transitionIn: fade },
            { ...b!, transitionIn: fade, transitionOut: fade }
          ]
        },
        ...t.videoTracks.slice(1)
      ]
    }
    const [joined] = v1Clips(joinClips(withTransitions, [a!.id, b!.id]))
    expect(joined!.transitionIn).toBe(fade)
    expect(joined!.transitionOut).toBe(fade)
  })

  it('refuses a join across a stretch that was taken out, which would play it again', () => {
    let t = splitOnce()
    t = splitClip(t, 200, v1Clips(t)[1]!.id)
    t = closeUpClip(t, v1Clips(t)[1]!.id)
    const [a, b] = v1Clips(t)
    expect(b!.timelineStart).toBe(100)
    expect(joinRefusal(t, a!.id, b!.id)).toMatch(/taken out/)
    expect(joinClips(t, [a!.id, b!.id])).toBe(t)
  })

  it('refuses two recordings, and clips that are not side by side', () => {
    let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a', 10), media('b', 10)] }
    t = addClip(addClip(t, 'a', 'p'), 'b', 'q')
    expect(joinRefusal(t, 'p', 'q')).toMatch(/different recordings/)
    expect(joinRefusal(t, 'q', 'p')).toMatch(/next to each other/)
  })

  it('joins a sound cut somewhere else as well, since it carries straight on at its own cut', () => {
    const t = splitOnce()
    const [a, b] = v1Clips(t)
    const [s1, s2] = t.audioTracks[0]!.clips
    // An L-cut: the sound's cut 10 frames after the picture's.
    const lcut: Timeline = {
      ...t,
      audioTracks: [
        { ...t.audioTracks[0]!, clips: [{ ...s1!, sourceOut: 110 }, { ...s2!, sourceIn: 110, timelineStart: 110 }] },
        ...t.audioTracks.slice(1)
      ]
    }
    const joined = joinClips(lcut, [a!.id, b!.id])
    expect(pictures(joined)).toEqual([{ start: 0, in: 0, out: 300 }])
    expect(sounds(joined)).toEqual([{ start: 0, in: 0, out: 300 }])
  })

  it('refuses when a linked sound does not carry straight on, unless the picture goes alone', () => {
    const t = splitOnce()
    const [a, b] = v1Clips(t)
    const [s1, s2] = t.audioTracks[0]!.clips
    // Some of the sound's second piece trimmed off its head: it no longer carries on.
    const broken: Timeline = {
      ...t,
      audioTracks: [
        { ...t.audioTracks[0]!, clips: [s1!, { ...s2!, sourceIn: 120, timelineStart: 120 }] },
        ...t.audioTracks.slice(1)
      ]
    }
    expect(joinRefusal(broken, a!.id, b!.id)).toMatch(/out of step/)
    expect(joinClips(broken, [a!.id, b!.id])).toBe(broken)
    expect(joinRefusal(broken, a!.id, b!.id, true)).toBeNull()
    const alone = joinClips(broken, [a!.id, b!.id], true)
    expect(pictures(alone)).toEqual([{ start: 0, in: 0, out: 300 }])
    expect(alone.audioTracks[0]!.clips).toHaveLength(2)
  })
})

describe('joining, bringing back what was cut (bugs and notes 2, note 29)', () => {
  /** One recording cut at 100 and 200, the middle taken out and closed up, and a second recording after. */
  function removedMiddle(): Timeline {
    let t = splitOnce()
    t = splitClip(t, 200, v1Clips(t)[1]!.id)
    t = closeUpClip(t, v1Clips(t)[1]!.id)
    return addClip(t, 'b', 'q')
  }

  it('says how much was taken out between two pieces, and nothing for pieces that carry on', () => {
    const t = removedMiddle()
    const [a, b, q] = v1Clips(t)
    expect(removedBetween(t, a!.id, b!.id)).toBe(100)
    expect(removedBetween(t, b!.id, q!.id)).toBe(0)
    expect(removedBetween(splitOnce(), v1Clips(splitOnce())[0]!.id, v1Clips(splitOnce())[1]!.id)).toBe(0)
    expect(joinRefusal(t, a!.id, b!.id, false, true)).toBeNull()
  })

  it('puts the stretch back, its sound with it, and moves everything after it later by as much', () => {
    const t = removedMiddle()
    const [a, b] = v1Clips(t)
    const joined = joinClips(t, [a!.id, b!.id], false, true)
    expect(pictures(joined)).toEqual([
      { start: 0, in: 0, out: 300 },
      { start: 300, in: 0, out: 300 }
    ])
    expect(sounds(joined)).toEqual([
      { start: 0, in: 0, out: 300 },
      { start: 300, in: 0, out: 300 }
    ])
    expect(v1Clips(joined)[0]!.id).toBe(a!.id)
  })

  it('still refuses a second piece that plays earlier footage than the first ends on', () => {
    let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a', 10)] }
    t = addClip(t, 'a', 'p')
    t = splitClip(t, 100, 'p')
    const [a, b] = v1Clips(t)
    // The second piece moved to play the recording's start again.
    const back: Timeline = {
      ...t,
      videoTracks: [{ ...t.videoTracks[0]!, clips: [a!, { ...b!, sourceIn: 50, sourceOut: 250 }] }, ...t.videoTracks.slice(1)]
    }
    expect(joinRefusal(back, a!.id, b!.id, true, true)).toMatch(/earlier footage/)
  })

  it('moves only its own track for pieces over V1, leaving the video under them', () => {
    const t = removedMiddle()
    // The pieces lifted onto V2, alone, over the second recording on V1.
    const [a, b, q] = v1Clips(t)
    const lifted: Timeline = {
      ...t,
      videoTracks: [
        { ...t.videoTracks[0]!, clips: [{ ...q!, timelineStart: 0 }] },
        { id: 'v2', clips: [a!, b!].map(({ link: _link, ...c }) => c) }
      ],
      audioTracks: [{ ...t.audioTracks[0]!, clips: [] }]
    }
    const joined = joinClips(lifted, [a!.id, b!.id], true, true)
    expect(joined.videoTracks[1]!.clips.map((c) => [c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([[0, 0, 300]])
    expect(joined.videoTracks[0]!.clips[0]!.timelineStart).toBe(0)
  })
})
