import { describe, it, expect } from 'vitest'
import {
  addClip,
  addSource,
  addTrack,
  allClips,
  closeUpClip,
  closeUpStart,
  createTimeline,
  findClip,
  linkedIds,
  removeClips,
  removeClipsRefusal,
  rippleTrim,
  setClipOut,
  timelineDuration,
  v1Clips,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'
import { spanEnd, type Span } from '../../src/shared/tracks'

/**
 * Several clips selected at once, taken away together: Delete leaves gaps,
 * Shift+Delete closes up the stretch they covered, and closing up is refused
 * when they do not cover one stretch or when it would push a clip out of step.
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
 * `cut()` with p2's picture cut 30 frames off each end and its sound left
 * whole: the picture runs from 330 to 390, the sound from 300 to 420, both
 * still in step with their recording. Its sound comes in before its picture
 * and runs on after it, the J-cut and the L-cut every talking-head edit is
 * full of, and both have to count in the stretch the group covers.
 */
function jAndLCut(): Timeline {
  const t = cut()
  const v1 = t.videoTracks[0]!
  const shorter = v1.clips.map((c) => (c.id === 'p2' ? { ...c, timelineStart: 330, sourceIn: c.sourceIn + 30, sourceOut: c.sourceOut - 30 } : c))
  return { ...t, videoTracks: [{ ...v1, clips: shorter }, ...t.videoTracks.slice(1)] }
}

/**
 * A title on V2 lying inside a stretch of V1: A (0 to 100), B (100 to 200)
 * and C (200 to 500) on V1, with T from 120 to 180 over B. Nothing is linked.
 */
function titleOver(): Timeline {
  let t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [media('a', 10, { hasAudio: false }), media('t', 10, { hasAudio: false })]
  }
  t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
  t = rippleTrim(t, 'A', 'end', 100)
  t = addSource(t, { mediaId: 'a', clipId: 'B', at: 100, onTrack: 'v1' })
  t = rippleTrim(t, 'B', 'end', 100)
  t = addSource(t, { mediaId: 'a', clipId: 'C', at: 200, onTrack: 'v1' })
  t = addTrack(t, 'video', 'v2')
  t = addSource(t, { mediaId: 't', clipId: 'T', at: 120, onTrack: 'v2' })
  return setClipOut(t, 'T', 60)
}

/**
 * V1: A (0 to 300) and X (300 to 400), then B (400 to 700), an OBS recording
 * whose microphone stream B.2 is on A2. A voice over runs from 150 to 390 on
 * that same track, across the start of X. Taking A and X out closing up would
 * push B.2 along past the voice over, out of step with B's picture.
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

/** Every track by its label, V1 up and A1 down, and each clip on it as its id, start and end. */
function shape(t: Timeline): Record<string, [string, number, number][]> {
  const out: Record<string, [string, number, number][]> = {}
  const each = (c: Span): [string, number, number] => [c.id, c.timelineStart, spanEnd(c)]
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

describe('removeClips, leaving gaps', () => {
  it('takes several clips and their linked clips away in one go', () => {
    const t = removeClips(cut(), ['p2', 'p3'])
    expect(shape(t).V1).toEqual([['p1', 0, 300]])
    expect(shape(t).A1).toEqual([['p1.1', 0, 300]])
    // The music is untouched, and the gap is left: the sequence is as long as it was.
    expect(shape(t).A2).toEqual([['music', 0, 600]])
    expect(timelineDuration(t)).toBe(600)
  })

  it('leaves the sounds behind when the clips go on their own', () => {
    const t = removeClips(cut(), ['p2', 'p3'], { alone: true })
    expect(shape(t).V1).toEqual([['p1', 0, 300]])
    expect(shape(t).A1).toEqual([
      ['p1.1', 0, 300],
      ['p2.1', 300, 420],
      ['p3.1', 420, 540]
    ])
  })

  it('does nothing for clips that are not there, and nothing at all for none', () => {
    const t = cut()
    expect(removeClips(t, ['gone'])).toEqual(t)
    expect(removeClips(t, [])).toBe(t)
  })

  it('takes a clip named twice, or named beside its own sound, away once', () => {
    const t = removeClips(cut(), ['p2', 'p2', 'p2.1'])
    expect(shape(t).V1).toEqual([
      ['p1', 0, 300],
      ['p3', 420, 540]
    ])
    expect(shape(t).A1).toEqual([
      ['p1.1', 0, 300],
      ['p3.1', 420, 540]
    ])
  })
})

describe('removeClips, closing up', () => {
  it('takes the stretch they covered out of the sequence', () => {
    const t = removeClips(cut(), ['p2', 'p3'], { closeUp: true })
    expect(shape(t).V1).toEqual([['p1', 0, 300]])
    expect(shape(t).A1).toEqual([['p1.1', 0, 300]])
    // Music laid under the whole cut stays where it is, as it does for one clip.
    expect(shape(t).A2).toEqual([['music', 0, 600]])
    expectGroupsInStep(t)
  })

  it('closes up from the first of them, so what came after moves up by the whole stretch', () => {
    // p1 and p2 out: p3 comes to 0 with its sound.
    const t = removeClips(cut(), ['p1', 'p2'], { closeUp: true })
    expect(shape(t).V1).toEqual([['p3', 0, 120]])
    expect(shape(t).A1).toEqual([['p3.1', 0, 120]])
    expectGroupsInStep(t)
    expect(removeClipsRefusal(cut(), ['p1', 'p2'])).toBeNull()
  })

  it('refuses when the clips do not cover one stretch, and changes nothing', () => {
    const t = cut()
    expect(removeClipsRefusal(t, ['p1', 'p3'])).toEqual({ why: 'apart' })
    expect(removeClips(t, ['p1', 'p3'], { closeUp: true })).toBe(t)
  })

  it('takes in a sound that comes in before its picture, and one that runs on after it', () => {
    const t = jAndLCut()
    expect(shape(t).V1).toEqual([
      ['p1', 0, 300],
      ['p2', 330, 390],
      ['p3', 420, 540]
    ])
    expect(shape(t).A1![1]).toEqual(['p2.1', 300, 420])
    expect(removeClipsRefusal(t, ['p2', 'p3'])).toBeNull()

    const done = removeClips(t, ['p2', 'p3'], { closeUp: true })
    expect(shape(done).V1).toEqual([['p1', 0, 300]])
    expect(shape(done).A1).toEqual([['p1.1', 0, 300]])
    expectGroupsInStep(done)
  })

  it('slides a clip that was inside the stretch to its start, as taking the clips out one at a time does', () => {
    // A title on V2 over B, with A and B taken out closing up. It is not
    // pushed out of step with anything, so nothing refuses it: it lands where
    // the stretch began, over the start of C, exactly as Shift+Delete on A
    // and then on B leaves it.
    const t = titleOver()
    expect(removeClipsRefusal(t, ['A', 'B'])).toBeNull()
    const done = removeClips(t, ['A', 'B'], { closeUp: true })
    expect(shape(done).V1).toEqual([['C', 0, 300]])
    expect(shape(done).V2).toEqual([['T', 0, 60]])
    const oneAtATime = closeUpClip(closeUpClip(t, 'B'), 'A')
    expect(shape(done)).toEqual(shape(oneAtATime))
  })

  it('refuses when closing up would push a clip out of step, and says which', () => {
    const t = voiceOverBesideMic()
    expect(removeClipsRefusal(t, ['A', 'X'])).toEqual({ why: 'blocked', clips: [expect.objectContaining({ id: 'B.2' })] })
    expect(removeClips(t, ['A', 'X'], { closeUp: true })).toBe(t)
    // Delete still takes them away, leaving a gap, since that closes nothing up.
    const gapped = removeClips(t, ['A', 'X'])
    expect(v1Clips(gapped).map((c) => c.id)).toEqual(['B'])
    expectGroupsInStep(gapped)
  })
})

describe('where the join lands after a close-up', () => {
  it('is where the first of the clips taken out began, in any order they were picked', () => {
    expect(closeUpStart(cut(), ['p3', 'p2'])).toBe(300)
    expect(closeUpStart(cut(), ['p2'])).toBe(300)
    expect(closeUpStart(cut(), ['p1'])).toBe(0)
  })

  it('is nowhere when none of them is there', () => {
    expect(closeUpStart(cut(), ['gone'])).toBeNull()
  })
})
