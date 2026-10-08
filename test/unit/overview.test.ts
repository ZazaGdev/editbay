import { describe, it, expect } from 'vitest'
import { addClip, addSource, addTrack, createTimeline, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { fitZoom, hasAnything, overviewBlocks, overviewFrames, scrollToCentre, scrollToShow, viewportFrames } from '../../src/shared/overview'
import { ZOOM_LEVELS, ZOOM_STEPS, pxPerFrameAt } from '../../src/shared/timeline-layout'

/**
 * Plan 20, step 1: the strip that shows the whole edit, and the zoom that puts
 * it all on screen. Pure, so what the strip draws and where Fit lands are
 * tested without a browser.
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

/** Two takes on V1 with their sound on A1, and music under all of it on A2. */
function cut(): Timeline {
  let t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [media('talk', 10), media('song', 20, SOUND)]
  }
  t = addClip(t, 'talk', 'p1')
  t = addClip(t, 'talk', 'p2')
  return addSource(t, { mediaId: 'song', clipId: 'music', at: 0 })
}

describe('the blocks the strip draws', () => {
  it('has one for every clip on every track, in frames', () => {
    const t = cut()
    const blocks = overviewBlocks(t)
    // Two pictures, their two sounds, and the music.
    expect(blocks.length).toBe(5)
    expect(blocks.filter((b) => b.kind === 'video').length).toBe(2)
    expect(blocks.filter((b) => b.kind === 'audio').length).toBe(3)
    for (const b of blocks) expect(b.to).toBeGreaterThan(b.from)
  })

  it('says which track of its kind each came off, so a block can take its colour', () => {
    const t = cut()
    const audio = overviewBlocks(t).filter((b) => b.kind === 'audio')
    expect(new Set(audio.map((b) => b.trackIndex))).toEqual(new Set([0, 1]))
  })

  it('is in the same order every time, so the strip does not flicker', () => {
    const t = cut()
    expect(overviewBlocks(t)).toEqual(overviewBlocks(t))
    const starts = overviewBlocks(t).map((b) => b.from)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('has nothing to draw for an empty sequence, and says so', () => {
    const t = createTimeline(30, { width: 1080, height: 1920 })
    expect(overviewBlocks(t)).toEqual([])
    expect(hasAnything(t)).toBe(false)
    expect(hasAnything(cut())).toBe(true)
  })

  it('draws at least a second, so an empty strip never divides by zero', () => {
    const t = createTimeline(30, { width: 1080, height: 1920 })
    expect(overviewFrames(t)).toBe(30)
    expect(overviewFrames(cut())).toBeGreaterThan(30)
  })
})

describe('the zoom that fits the whole edit', () => {
  it('puts the frames asked for into the width asked for', () => {
    const frames = 3000
    const width = 900
    expect(pxPerFrameAt(fitZoom(frames, width)) * frames).toBeCloseTo(width, 0)
  })

  it('stays inside the steps there are', () => {
    // Far too long for the widest step, and far too short for the narrowest.
    expect(fitZoom(10_000_000, 900)).toBe(0)
    expect(fitZoom(1, 900)).toBe(ZOOM_LEVELS - 1)
    expect(fitZoom(3000, 900)).toBeGreaterThanOrEqual(0)
    expect(fitZoom(3000, 900)).toBeLessThanOrEqual(ZOOM_LEVELS - 1)
  })

  it('lands on a step exactly when the width asks for one', () => {
    // 100 frames at the step's own pixels a frame is exactly that step.
    ZOOM_STEPS.forEach((step, i) => {
      expect(fitZoom(100, 100 * step)).toBeCloseTo(i, 4)
    })
  })

  it('answers something usable for nonsense rather than throwing', () => {
    expect(fitZoom(0, 900)).toBe(ZOOM_LEVELS - 1)
    expect(fitZoom(100, 0)).toBe(ZOOM_LEVELS - 1)
    expect(fitZoom(Number.NaN, 900)).toBe(ZOOM_LEVELS - 1)
  })
})

describe('the box on the strip', () => {
  it('covers what the scroller is showing', () => {
    const zoom = 5
    const px = pxPerFrameAt(zoom)
    const seen = viewportFrames(100 * px, 300 * px, zoom, 1000)
    expect(seen.from).toBeCloseTo(100, 4)
    expect(seen.to).toBeCloseTo(400, 4)
  })

  it('never runs off either end of the strip', () => {
    const zoom = 5
    const px = pxPerFrameAt(zoom)
    expect(viewportFrames(-500, 300 * px, zoom, 1000).from).toBe(0)
    const past = viewportFrames(900 * px, 900 * px, zoom, 1000)
    expect(past.to).toBe(1000)
    expect(past.from).toBeLessThanOrEqual(past.to)
  })

  it('scrolls to put a frame in the middle, held inside what there is to scroll', () => {
    const zoom = 5
    const px = pxPerFrameAt(zoom)
    const width = 300 * px
    expect(scrollToCentre(500, width, zoom, 1000)).toBeCloseTo(350 * px, 4)
    // The first frames and the last: as near the middle as the ends allow.
    expect(scrollToCentre(0, width, zoom, 1000)).toBe(0)
    expect(scrollToCentre(1000, width, zoom, 1000)).toBeCloseTo(700 * px, 4)
  })

  it('does not scroll at all when the whole edit already fits', () => {
    const zoom = 5
    const px = pxPerFrameAt(zoom)
    expect(scrollToCentre(400, 2000 * px, zoom, 1000)).toBe(0)
  })

  it('scrolls to put a frame at the left edge, which is what a drag on the box needs', () => {
    const zoom = 5
    const px = pxPerFrameAt(zoom)
    const width = 300 * px
    expect(scrollToShow(200, width, zoom, 1000)).toBeCloseTo(200 * px, 4)
    // Never before the start, and never past the last screenful.
    expect(scrollToShow(-50, width, zoom, 1000)).toBe(0)
    expect(scrollToShow(990, width, zoom, 1000)).toBeCloseTo(700 * px, 4)
    expect(scrollToShow(400, 2000 * px, zoom, 1000)).toBe(0)
  })

  it('moves the same distance for the same frame, which is what makes a drag track the pointer', () => {
    const zoom = 5
    const px = pxPerFrameAt(zoom)
    const width = 300 * px
    const a = scrollToShow(100, width, zoom, 1000)
    const b = scrollToShow(150, width, zoom, 1000)
    expect(b - a).toBeCloseTo(50 * px, 4)
  })
})

describe('what a track adds to the strip', () => {
  it('counts a clip on a new track too', () => {
    let t = cut()
    const before = overviewBlocks(t).length
    t = addTrack(t, 'video', 'v2')
    t = addSource(t, { mediaId: 'talk', clipId: 'title', at: 0, onTrack: 'v2' })
    const after = overviewBlocks(t)
    expect(after.length).toBeGreaterThan(before)
    expect(after.some((b) => b.kind === 'video' && b.trackIndex === 1)).toBe(true)
  })
})
