import { describe, it, expect } from 'vitest'
import { addSource, addTrack, createTimeline, moveClipTo, setClipIn, setClipOut, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { cutPoints, nextCut, previousCut } from '../../src/shared/cuts'

/**
 * Plan 16 step 3: the cuts Up and Down jump between, every clip's start and
 * end on every track, with the sequence's start and end.
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
 * V1: a (0 to 120) and b (150 to 270), each with its sound on A1, a gap
 * between; an overlay o on V2 from 60 to 90; b's sound leading in from 140,
 * a J-cut.
 */
function cut(): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a', 4), media('b', 10), media('o', 1, { hasAudio: false })] }
  t = addSource(t, { mediaId: 'a', clipId: 'A', at: 0, onTrack: 'v1' })
  t = addSource(t, { mediaId: 'b', clipId: 'B', at: 150, onTrack: 'v1' })
  t = setClipIn(t, 'B', 10)
  t = setClipOut(t, 'B', 130)
  t = moveClipTo(t, 'B', 'v1', 150)
  t = setClipIn(t, 'B.1', 0, true)
  t = addTrack(t, 'video', 'v2')
  return addSource(t, { mediaId: 'o', clipId: 'O', at: 60, onTrack: 'v2' })
}

describe('the cuts', () => {
  it('are every clip edge on every track, and the start and end, each once, in order', () => {
    expect(cutPoints(cut())).toEqual([0, 60, 90, 120, 140, 150, 270])
  })

  it('are the start alone for an empty sequence', () => {
    expect(cutPoints(createTimeline(30, { width: 1080, height: 1920 }))).toEqual([0])
  })
})

describe('jumping between cuts', () => {
  it('goes to the next cut after the frame, and the one before it', () => {
    const t = cut()
    expect(nextCut(t, 70)).toBe(90)
    expect(previousCut(t, 70)).toBe(60)
  })

  it('goes on from a cut to the next one, not to itself', () => {
    const t = cut()
    expect(nextCut(t, 120)).toBe(140)
    expect(previousCut(t, 120)).toBe(90)
  })

  it('stays at the start going back from it, and at the end going on from it', () => {
    const t = cut()
    expect(previousCut(t, 0)).toBe(0)
    expect(nextCut(t, 270)).toBe(270)
    expect(nextCut(t, 265)).toBe(270)
  })
})
