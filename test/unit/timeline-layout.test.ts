import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TRACK_SIZE,
  DRAW_STEP_PX,
  drawnSpan,
  rulerFrames,
  rulerSeconds,
  shownPart,
  TRACK_SIZES,
  handleWidthFor,
  isTrackSize,
  nextTrackSize,
  trackHeights,
  MIN_CLIP_WIDTH,
  ZOOM_LEVELS,
  ZOOM_STEPS,
  pxPerFrameAt
} from '../../src/shared/timeline-layout'

describe('handleWidthFor', () => {
  it('uses full size handles, 12 pixels, on a comfortable clip', () => {
    expect(handleWidthFor(200)).toBe(12)
    expect(handleWidthFor(34)).toBe(12)
    expect(handleWidthFor(26)).toBe(8)
  })

  it('shrinks the handles rather than covering a narrow clip', () => {
    expect(handleWidthFor(18)).toBe(4)
    expect(handleWidthFor(20)).toBe(5)
  })

  it('always leaves a clickable body, so a one frame clip can still be selected', () => {
    for (const width of [MIN_CLIP_WIDTH, 18, 20, 24, 30, 100]) {
      expect(width - 2 * handleWidthFor(width)).toBeGreaterThanOrEqual(8)
    }
  })

  it('never returns a handle too small to grab', () => {
    expect(handleWidthFor(0)).toBe(2)
    expect(handleWidthFor(10)).toBe(2)
  })
})

describe('pxPerFrameAt', () => {
  it('is each step as before at a whole zoom', () => {
    ZOOM_STEPS.forEach((px, i) => expect(pxPerFrameAt(i)).toBeCloseTo(px, 12))
  })

  it('goes between two steps geometrically for a zoom between them', () => {
    // Halfway from 0.4 to 0.8 is the square root of their product.
    expect(pxPerFrameAt(5.5)).toBeCloseTo(Math.sqrt(0.4 * 0.8), 12)
    expect(pxPerFrameAt(5.25)).toBeGreaterThan(0.4)
    expect(pxPerFrameAt(5.25)).toBeLessThan(pxPerFrameAt(5.5))
  })

  it('never goes past the first or the last step', () => {
    expect(pxPerFrameAt(-3)).toBe(ZOOM_STEPS[0])
    expect(pxPerFrameAt(ZOOM_LEVELS + 4)).toBe(ZOOM_STEPS[ZOOM_LEVELS - 1])
  })
})

describe('how tall the tracks are', () => {
  it('is three sizes, each taller than the one before', () => {
    expect(TRACK_SIZES.map((s) => s.id)).toEqual(['small', 'medium', 'large'])
    for (let i = 1; i < TRACK_SIZES.length; i++) {
      expect(TRACK_SIZES[i]!.video).toBeGreaterThan(TRACK_SIZES[i - 1]!.video)
      expect(TRACK_SIZES[i]!.audio).toBeGreaterThan(TRACK_SIZES[i - 1]!.audio)
    }
  })

  it('starts where the timeline has always been, so nothing moves until you ask', () => {
    expect(DEFAULT_TRACK_SIZE).toBe('small')
    // What the timeline was before there was a choice. Taller costs preview.
    expect(trackHeights(DEFAULT_TRACK_SIZE)).toEqual({ video: 46, audio: 44 })
  })

  it('falls back to the default for a size that is not one', () => {
    expect(trackHeights('enormous' as never)).toEqual(trackHeights(DEFAULT_TRACK_SIZE))
    expect(isTrackSize('enormous')).toBe(false)
    expect(isTrackSize('large')).toBe(true)
  })

  it('steps round through all three and back', () => {
    expect(nextTrackSize('small')).toBe('medium')
    expect(nextTrackSize('medium')).toBe('large')
    expect(nextTrackSize('large')).toBe('small')
  })
})

/**
 * Plan 49: the timeline draws only what is near the part in view. These are
 * the rules for what that is.
 */
describe('what the timeline draws', () => {
  it('draws the part in view and a screen either side, in whole steps', () => {
    const span = drawnSpan(5000, 1500)
    expect(span.from).toBeLessThanOrEqual(5000 - 1500)
    expect(span.to).toBeGreaterThanOrEqual(5000 + 1500 * 2)
    expect(span.from % DRAW_STEP_PX).toBe(0)
    expect(span.to % DRAW_STEP_PX).toBe(0)
    // Never before the start.
    expect(drawnSpan(0, 1500).from).toBe(0)
  })

  it('does not change for a scroll of a few pixels', () => {
    expect(drawnSpan(5000, 1500)).toEqual(drawnSpan(5010, 1500))
  })

  it('draws something before the view has been measured', () => {
    const span = drawnSpan(0, 0)
    expect(span.to).toBeGreaterThan(0)
  })

  it('gives a clip wholly in view all of itself, and one out of it nothing', () => {
    const span = { from: 1000, to: 4000 }
    expect(shownPart(1500, 800, span)).toEqual({ from: 0, to: 800 })
    expect(shownPart(5000, 800, span)).toEqual({ from: 0, to: 0 })
    expect(shownPart(0, 500, span)).toEqual({ from: 0, to: 0 })
    // Across an edge: only the part inside.
    expect(shownPart(500, 1000, span)).toEqual({ from: 500, to: 1000 })
    expect(shownPart(3500, 1000, span)).toEqual({ from: 0, to: 500 })
  })

  it('labels the ruler near the view only, on the same seconds as before', () => {
    // An hour at 30 fps, zoomed in to 6 pixels a frame: a label every second.
    const fps = 30
    const px = 6
    const duration = 3600 * fps
    const every = rulerSeconds(duration, fps, px, { from: 0, to: Infinity })
    expect(every.length).toBe(3601)
    const near = rulerSeconds(duration, fps, px, { from: 180 * 1000, to: 180 * 1000 + 3000 })
    expect(near.length).toBeLessThan(30)
    // Every one it draws is one the whole ruler has, and none in the span is missed.
    for (const s of near) expect(every).toContain(s)
    const inSpan = every.filter((s) => s * fps * px >= 180_000 && s * fps * px < 183_000)
    for (const s of inSpan) expect(near).toContain(s)
  })
})

describe('the deepest zoom levels', () => {
  it('keeps every level there was, adding only closer ones after the last', () => {
    expect(ZOOM_STEPS.slice(0, 10)).toEqual([0.01, 0.02, 0.05, 0.1, 0.2, 0.4, 0.8, 1.5, 3, 6])
    expect(ZOOM_STEPS[ZOOM_LEVELS - 1]).toBe(48)
    expect(pxPerFrameAt(ZOOM_LEVELS - 1)).toBe(48)
  })
})

describe('rulerFrames', () => {
  it('labels whole seconds while a second is too narrow for more', () => {
    expect(rulerFrames(300, 30, 6, { from: 0, to: Infinity })).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300])
  })

  it('labels every few frames once zoomed in, stepping by a number that divides the second', () => {
    // 48 pixels a frame: 3 frames is the first step of 120 pixels or more that divides 30.
    expect(rulerFrames(12, 30, 48, { from: 0, to: Infinity })).toEqual([0, 3, 6, 9, 12])
    // 12 pixels a frame: every 10 frames.
    expect(rulerFrames(60, 30, 12, { from: 0, to: Infinity })).toEqual([0, 10, 20, 30, 40, 50, 60])
    // 25 frames a second has only 1 and 5 below it: 5 frames at 24 pixels.
    expect(rulerFrames(25, 25, 24, { from: 0, to: Infinity })).toEqual([0, 5, 10, 15, 20, 25])
  })

  it('keeps to what is near the part in view', () => {
    const near = rulerFrames(30 * 600, 30, 48, { from: 48 * 3000, to: 48 * 3000 + 1000 })
    expect(near[0]).toBeGreaterThanOrEqual(2990)
    expect(near.length).toBeLessThan(12)
  })
})
