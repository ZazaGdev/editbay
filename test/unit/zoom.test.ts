import { describe, it, expect } from 'vitest'
import { cropAtKeys, easeOf, easeThrough, moves } from '../../src/shared/crop-geometry'
import type { Ease, Rect, ZoomKey } from '../../src/shared/project'

/**
 * Plan 60: a clip's main picture zoomed by keyframes on its recording's
 * frames. Pure, so what the preview draws and what the export writes are
 * worked out from the same answers.
 */

const from: Rect = { x: 0, y: 0, w: 1920, h: 1080 }
/** Ten per cent in, centred: the punch-in. */
const to: Rect = { x: 96, y: 54, w: 1728, h: 972 }

describe('the crop at a frame', () => {
  it('stays on the clip crop when there are no keyframes', () => {
    expect(cropAtKeys(from, undefined, 0)).toEqual(from)
    expect(cropAtKeys(from, [], 500)).toEqual(from)
  })

  it('shows the first keyframe before it and the last after it', () => {
    const keys: ZoomKey[] = [
      { at: 100, crop: to },
      { at: 130, crop: from }
    ]
    expect(cropAtKeys({ x: 1, y: 1, w: 2, h: 2 }, keys, 0)).toEqual(to)
    expect(cropAtKeys({ x: 1, y: 1, w: 2, h: 2 }, keys, 99)).toEqual(to)
    expect(cropAtKeys({ x: 1, y: 1, w: 2, h: 2 }, keys, 130)).toEqual(from)
    expect(cropAtKeys({ x: 1, y: 1, w: 2, h: 2 }, keys, 5000)).toEqual(from)
  })

  it('jumps on the next keyframe frame after a keyframe that holds', () => {
    const keys: ZoomKey[] = [
      { at: 0, crop: from, ease: 'hold' },
      { at: 30, crop: to }
    ]
    expect(cropAtKeys(from, keys, 29)).toEqual(from)
    expect(cropAtKeys(from, keys, 30)).toEqual(to)
    expect(cropAtKeys(from, keys, 31)).toEqual(to)
  })

  it('moves between two keyframes by the ease of the first, and half way there half way through for the symmetrical ones', () => {
    for (const ease of ['smooth', 'linear', undefined] as const) {
      const keys: ZoomKey[] = [{ at: 10, crop: from, ...(ease ? { ease } : {}) }, { at: 30, crop: to }]
      const half = cropAtKeys(from, keys, 20)
      expect(half.w).toBeCloseTo((from.w + to.w) / 2, 4)
      expect(half.x).toBeCloseTo((from.x + to.x) / 2, 4)
    }
    // Starts slowly: a quarter of the way at half the time; ends slowly: three quarters.
    const slow = cropAtKeys(from, [{ at: 10, crop: from, ease: 'in' }, { at: 30, crop: to }], 20)
    expect(slow.w).toBeCloseTo(from.w + (to.w - from.w) * 0.25, 4)
    const late = cropAtKeys(from, [{ at: 10, crop: from, ease: 'out' }, { at: 30, crop: to }], 20)
    expect(late.w).toBeCloseTo(from.w + (to.w - from.w) * 0.75, 4)
  })

  it('goes in and back out through three keyframes, each stretch by its own ease', () => {
    const keys: ZoomKey[] = [
      { at: 0, crop: from, ease: 'linear' },
      { at: 10, crop: to, ease: 'hold' },
      { at: 20, crop: from }
    ]
    expect(cropAtKeys(from, keys, 5).w).toBeCloseTo((from.w + to.w) / 2, 6)
    expect(cropAtKeys(from, keys, 10)).toEqual(to)
    expect(cropAtKeys(from, keys, 19)).toEqual(to)
    expect(cropAtKeys(from, keys, 20)).toEqual(from)
  })

  it('never rounds to whole pixels, which is what makes a slow zoom judder', () => {
    // Two per cent over eight seconds at 30 fps: less than a pixel a frame.
    const tiny: Rect = { x: 19, y: 11, w: 1882, h: 1058 }
    const keys: ZoomKey[] = [{ at: 0, crop: from }, { at: 240, crop: tiny }]
    const a = cropAtKeys(from, keys, 100)
    const b = cropAtKeys(from, keys, 101)
    expect(a.w).not.toBe(b.w)
    expect(Math.abs(a.w - b.w)).toBeLessThan(1)
  })
})

describe('the eases', () => {
  it('start at nothing and end at all of it', () => {
    for (const ease of ['smooth', 'linear', 'in', 'out'] as Ease[]) {
      expect(easeOf(ease, 0)).toBe(0)
      expect(easeOf(ease, 1)).toBe(1)
    }
    expect(easeOf('hold', 0)).toBe(0)
    expect(easeOf('hold', 0.99)).toBe(0)
    expect(easeOf('hold', 1)).toBe(1)
  })

  it('are the curves they are named for', () => {
    expect(easeOf(undefined, 0.3)).toBe(easeThrough(0.3))
    expect(easeOf('smooth', 0.3)).toBe(easeThrough(0.3))
    expect(easeOf('linear', 0.3)).toBeCloseTo(0.3, 9)
    expect(easeOf('in', 0.3)).toBeCloseTo(0.09, 9)
    expect(easeOf('out', 0.3)).toBeCloseTo(0.51, 9)
  })

  it('smooth starts and stops gently rather than at a constant speed', () => {
    expect(easeThrough(0.5)).toBeCloseTo(0.5, 6)
    expect(easeThrough(0.1)).toBeLessThan(0.1)
    expect(easeThrough(0.9)).toBeGreaterThan(0.9)
    expect(easeThrough(-1)).toBe(0)
    expect(easeThrough(2)).toBe(1)
  })
})

describe('whether a clip moves at all', () => {
  it('says no for no keyframes, one, or several that frame the same thing', () => {
    expect(moves(undefined)).toBe(false)
    expect(moves([{ at: 0, crop: to }])).toBe(false)
    expect(moves([{ at: 0, crop: from }, { at: 30, crop: from }])).toBe(false)
    expect(moves([{ at: 0, crop: from }, { at: 30, crop: { ...from, w: from.w - 0.5 } }])).toBe(false)
  })

  it('says yes once two keyframes frame different things', () => {
    expect(moves([{ at: 0, crop: from }, { at: 30, crop: to }])).toBe(true)
    expect(moves([{ at: 0, crop: from }, { at: 1, crop: from }, { at: 2, crop: { ...from, x: 4 } }])).toBe(true)
  })
})

/**
 * The crop a clip showed before keyframes, from its own crop and its one
 * move, on a frame counted from the clip's start: the arithmetic every
 * project up to schema 9 was drawn and exported with, kept here to hold the
 * converted keyframes to it.
 */
function oldCropAt(start: Rect, zoom: { crop: Rect; at: number; length: number }, frame: number): Rect {
  if (frame < zoom.at) return start
  if (zoom.length <= 0 || frame >= zoom.at + zoom.length) return zoom.crop
  const t = easeThrough((frame - zoom.at) / zoom.length)
  return {
    x: start.x + (zoom.crop.x - start.x) * t,
    y: start.y + (zoom.crop.y - start.y) * t,
    w: start.w + (zoom.crop.w - start.w) * t,
    h: start.h + (zoom.crop.h - start.h) * t
  }
}

describe('a move from before keyframes, converted', () => {
  // The same conversion the file does on open, for a clip whose recording starts at `sourceIn`.
  const converted = (sourceIn: number, zoom: { crop: Rect; at: number; length: number }): { crop: Rect; keys: ZoomKey[] } =>
    zoom.length > 0
      ? { crop: from, keys: [{ at: sourceIn + zoom.at, crop: from }, { at: sourceIn + zoom.at + zoom.length, crop: zoom.crop }] }
      : zoom.at > 0
        ? { crop: from, keys: [{ at: sourceIn, crop: from, ease: 'hold' }, { at: sourceIn + zoom.at, crop: zoom.crop }] }
        : { crop: zoom.crop, keys: [] }

  const cases = [
    { at: 0, length: 0 },
    { at: 1, length: 0 },
    { at: 45, length: 0 },
    { at: 0, length: 30 },
    { at: 12, length: 1 },
    { at: 20, length: 7 },
    { at: 60, length: 90 }
  ]
  for (const sourceIn of [0, 37, 900]) {
    for (const c of cases) {
      it(`shows the same crop on every frame for a ${c.length > 0 ? 'move' : 'cut'} at ${c.at} over ${c.length}, from ${sourceIn}`, () => {
        const zoom = { crop: to, ...c }
        const now = converted(sourceIn, zoom)
        // Before the clip too, where a transition reaches back into its
        // recording, except for a cut on its first frame, which becomes the
        // clip's own crop: the frames a transition borrows then show it too.
        const first = c.at === 0 && c.length === 0 ? 0 : -5
        for (let frame = first; frame < 200; frame++) {
          expect(cropAtKeys(now.crop, now.keys, sourceIn + frame)).toEqual(oldCropAt(from, zoom, frame))
        }
      })
    }
  }
})
