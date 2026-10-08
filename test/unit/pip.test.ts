import { describe, it, expect } from 'vitest'
import {
  PIP_ROUNDED_PX,
  pipCorner,
  pipShape,
  placeAtCorner,
  resizedInPlace,
  snapToCorner,
  styleForShape
} from '../../src/shared/pip'
import {
  addSource,
  addTrack,
  applyLayout,
  cornerPlace,
  createTimeline,
  findVideoClip,
  pipOf,
  setPip,
  setPlace,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'

/** Plan 62: picture in picture read from a small picture's place and style, and written back to them. */

const W = 1080
const H = 1920
const px = (p: { x: number; y: number; w: number; h: number }): number[] => [p.x * W, p.y * H, p.w * W, p.h * H].map((n) => Math.round(n))

describe('a box in a corner', () => {
  it('sits the margin in from both edges of the corner chosen, at its share of the width and its own shape', () => {
    expect(px(placeAtCorner('tr', 0.3, 24, 16 / 9, false, W, H))).toEqual([732, 24, 324, 182])
    expect(px(placeAtCorner('bl', 0.3, 24, 16 / 9, false, W, H))).toEqual([24, 1714, 324, 182])
    // A circle is square.
    expect(px(placeAtCorner('br', 0.3, 0, 16 / 9, true, W, H))).toEqual([756, 1596, 324, 324])
  })

  it('keeps the size and the margin within their bounds', () => {
    expect(px(placeAtCorner('tl', 0.05, -10, 16 / 9, false, W, H))[2]).toBe(Math.round(0.15 * W))
    expect(px(placeAtCorner('tl', 0.9, 500, 16 / 9, false, W, H))).toEqual([80, 80, 648, 365])
  })

  it('is read back as that corner and margin, and anything else as custom', () => {
    for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
      expect(pipCorner(placeAtCorner(corner, 0.34, 40, 16 / 9, false, W, H), W, H)).toEqual({ corner, margin: 40 })
    }
    expect(pipCorner({ x: 0.3, y: 0.3, w: 0.3, h: 0.1 }, W, H).corner).toBe('custom')
    // In the corner's column but not its row: not a corner.
    expect(pipCorner({ x: 1 - 0.3 - 24 / W, y: 0.2, w: 0.3, h: 0.1 }, W, H).corner).toBe('custom')
  })
})

describe('resizing a box that is not in a corner', () => {
  it('keeps the side nearest its edge of the frame where it was', () => {
    const box = { x: 700 / W, y: 900 / H, w: 300 / W, h: 169 / H }
    const bigger = resizedInPlace(box, 0.4, 16 / 9, false, W, H)
    // On the right half: its right edge stays.
    expect(Math.round((bigger.x + bigger.w) * W)).toBe(1000)
    expect(Math.round(bigger.w * W)).toBe(432)
  })
})

describe('snapping a dragged box', () => {
  it('lands in the nearest corner within reach, and nowhere when none is', () => {
    const near = { x: 740 / W, y: 30 / H, w: 324 / W, h: 182 / H }
    expect(snapToCorner(near, 24, W, H, 70)).toBe('tr')
    const middle = { x: 378 / W, y: 869 / H, w: 324 / W, h: 182 / H }
    expect(snapToCorner(middle, 24, W, H, 70)).toBeNull()
  })
})

describe('the shape', () => {
  it('is read from the radius and the box', () => {
    const box = placeAtCorner('tr', 0.3, 24, 16 / 9, false, W, H)
    const round = placeAtCorner('tr', 0.3, 24, 16 / 9, true, W, H)
    expect(pipShape(undefined, box, W, H)).toBe('square')
    expect(pipShape({ radius: PIP_ROUNDED_PX }, box, W, H)).toBe('rounded')
    expect(pipShape({ radius: 162 }, round, W, H)).toBe('circle')
    // Rounded that far on a box that is not square is still rounded.
    expect(pipShape({ radius: 162 }, box, W, H)).toBe('rounded')
  })

  it('is written as a radius, keeping the border and the shadow', () => {
    expect(styleForShape({ border: 4, shadow: true }, 'rounded', 324, 182)).toEqual({ border: 4, shadow: true, radius: PIP_ROUNDED_PX })
    expect(styleForShape({ radius: 24, border: 4 }, 'circle', 324, 324)).toEqual({ border: 4, radius: 162 })
    expect(styleForShape({ radius: 24 }, 'square', 324, 182)).toBeNull()
  })
})

function media(id: string, w: number, h: number): ProjectMedia {
  return {
    id, originalPath: `C:/v/${id}.mkv`, playablePath: `C:/v/${id}.mkv`, conformed: false, conformReasons: [],
    durationSec: 10, width: w, height: h, fps: 30, codec: 'h264', hasAudio: true, peaksPath: '', filmstripPath: ''
  }
}

/** A two-view OBS canvas on V1, laid out as Picture in picture. */
function twoViews(): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: W, height: H }, 'vertical'), media: [media('obs', 3840, 1080)] }
  t = addSource(t, { mediaId: 'obs', clipId: 'c' })
  return applyLayout(t, 'c', 'pip')
}

/** A recording on V1 and another on V2 put in the corner. */
function overTrack(): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: W, height: H }, 'vertical'), media: [media('game', 1920, 1080), media('cam', 1920, 1080)] }
  t = addSource(t, { mediaId: 'game', clipId: 'g' })
  t = addTrack(t, 'video', 'v2')
  t = addSource(t, { mediaId: 'cam', clipId: 'k', at: 0, onTrack: 'v2' })
  const k = findVideoClip(t, 'k')!.clip
  return setPlace(t, 'k', 'main', cornerPlace(t.media[1]!, k.transform.crop, W, H), true)
}

describe('a clip’s picture in picture', () => {
  it('is the small view of a recording laid out as Picture in picture', () => {
    const t = twoViews()
    const pip = pipOf(t, 'c')!
    expect(pip.picture).toBe(findVideoClip(t, 'c')!.clip.layers[0]!.id)
    expect(pip.twoViews).toBe(true)
    expect(pipCorner(pip.place, W, H).corner).toBe('tr')
  })

  it('is the recording itself when it lies in a corner over another track, and nothing on V1 alone', () => {
    const t = overTrack()
    expect(pipOf(t, 'k')!.picture).toBe('main')
    expect(pipOf(t, 'g')).toBeNull()
  })

  it('moves to a corner, grows and keeps it, and takes a margin, as one edit each', () => {
    let t = setPip(twoViews(), 'c', { corner: 'bl', margin: 40 })
    let pip = pipOf(t, 'c')!
    expect(pipCorner(pip.place, W, H)).toEqual({ corner: 'bl', margin: 40 })
    t = setPip(t, 'c', { size: 0.5 })
    pip = pipOf(t, 'c')!
    expect(pip.place.w).toBeCloseTo(0.5, 3)
    expect(pipCorner(pip.place, W, H)).toEqual({ corner: 'bl', margin: 40 })
    // Still the picture in picture after being moved: a hand placed layout is Custom, and still counts.
    expect(pipOf(setPip(overTrack(), 'k', { corner: 'br' }), 'k')).not.toBeNull()
  })

  it('becomes a circle, square and rounded all the way, and gets its own shape back after', () => {
    let t = setPip(twoViews(), 'c', { shape: 'circle' })
    let pip = pipOf(t, 'c')!
    expect(pipShape(pip.style, pip.place, W, H)).toBe('circle')
    expect(Math.round(pip.place.w * W)).toBe(Math.round(pip.place.h * H))
    // Its crop is square too, so the picture is not squashed.
    expect(pip.crop.w).toBeCloseTo(pip.crop.h, -1)
    t = setPip(t, 'c', { shape: 'rounded' })
    pip = pipOf(t, 'c')!
    expect(pipShape(pip.style, pip.place, W, H)).toBe('rounded')
    expect((pip.place.w * W) / (pip.place.h * H)).toBeCloseTo(16 / 9, 1)
  })

  it('takes a square, tall or wide box, filled rather than stretched, and its own shape back (bugs and notes 2, note 34)', () => {
    const shapeOf = (t: Timeline): { box: number; crop: number } => {
      const pip = pipOf(t, 'c')!
      return { box: (pip.place.w * W) / (pip.place.h * H), crop: pip.crop.w / pip.crop.h }
    }
    let t = setPip(twoViews(), 'c', { aspect: 1 })
    expect(shapeOf(t).box).toBeCloseTo(1, 1)
    // The crop the box's shape: the camera cropped to fill it, not squashed.
    expect(shapeOf(t).crop).toBeCloseTo(1, 1)
    t = setPip(t, 'c', { aspect: 9 / 16 })
    expect(shapeOf(t).box).toBeCloseTo(9 / 16, 1)
    expect(shapeOf(t).crop).toBeCloseTo(9 / 16, 1)
    t = setPip(t, 'c', { aspect: 'own' })
    expect(shapeOf(t).box).toBeCloseTo(16 / 9, 1)
    // Its corner and width stay.
    expect(pipCorner(pipOf(t, 'c')!.place, W, H).corner).toBe('tr')
  })

  it('takes a width and a height typed each on its own', () => {
    const was = pipOf(twoViews(), 'c')!.place
    const hPx = was.h * H
    const t = setPip(twoViews(), 'c', { size: 500 / W, aspect: 500 / hPx })
    const pip = pipOf(t, 'c')!
    expect(Math.round(pip.place.w * W)).toBe(500)
    expect(Math.abs(pip.place.h * H - hPx)).toBeLessThan(2)
  })

  it('leaves the circle for a rounded box when a shape that is not square is asked for', () => {
    let t = setPip(twoViews(), 'c', { shape: 'circle' })
    t = setPip(t, 'c', { aspect: 16 / 9 })
    const pip = pipOf(t, 'c')!
    expect(pipShape(pip.style, pip.place, W, H)).toBe('rounded')
  })
})

