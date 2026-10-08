import { describe, it, expect } from 'vitest'
import {
  createTimeline,
  createProject,
  addClip,
  splitClip,
  setCrop,
  setPlace,
  addLayer,
  removeLayer,
  applyLayout,
  swapPictures,
  applyLayoutToSource,
  setShape,
  hasLayout,
  duplicateSequence,
  editSequence,
  findVideoClip,
  timelineOf,
  v1Clips,
  MAIN_PICTURE,
  type Timeline,
  type ProjectMedia,
  type Clip,
  type Rect
} from '../../src/shared/project'
import { FULL_PLACE, MAX_LAYERS, placeAspect } from '../../src/shared/layout'
import { S1, addClipTo } from '../project-helpers'

function media(id: string, w: number, h: number): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mkv`,
    playablePath: `C:\\v\\${id}.mkv`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    width: w,
    height: h,
    fps: 60,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

const LEFT = { x: 0, y: 0, w: 1920, h: 1080 }
const RIGHT = { x: 1920, y: 0, w: 1920, h: 1080 }

function inside(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

/** A vertical timeline with one clip of an OBS-shaped 3840x1080 recording. */
function obsTimeline(presetId = 'vertical'): Timeline {
  const out = presetId === 'landscape' ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 }
  const t = { ...createTimeline(30, out, presetId), media: [media('obs', 3840, 1080), media('other', 1920, 1080)] }
  return addClip(t, 'obs')
}

function first(t: Timeline): Clip {
  return v1Clips(t)[0]!
}

describe('a new clip', () => {
  it('has one picture filling the frame, laid out Single', () => {
    const c = first(obsTimeline())
    expect(c.transform.place).toEqual(FULL_PLACE)
    expect(c.layers).toEqual([])
    expect(c.layout).toBe('single')
    expect(hasLayout(c)).toBe(false)
  })
})

describe('laying a clip out', () => {
  it('Split takes the left view on top and the right view below on a vertical frame', () => {
    const t0 = obsTimeline()
    const t = applyLayout(t0, first(t0).id, 'split')
    const c = first(t)
    expect(c.layout).toBe('split')
    expect(c.transform.place).toEqual({ x: 0, y: 0, w: 1, h: 0.5 })
    expect(c.layers).toHaveLength(1)
    expect(c.layers[0]!.place).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 })
    expect(inside(c.transform.crop, LEFT)).toBe(true)
    expect(inside(c.layers[0]!.crop, RIGHT)).toBe(true)
    expect(hasLayout(c)).toBe(true)
  })

  it('Picture in picture keeps the main picture full frame with a box of the right view', () => {
    const t0 = obsTimeline()
    const c = first(applyLayout(t0, first(t0).id, 'pip'))
    expect(c.transform.place).toEqual(FULL_PLACE)
    expect(inside(c.layers[0]!.crop, RIGHT)).toBe(true)
    expect(c.layers[0]!.crop.w / c.layers[0]!.crop.h).toBeCloseTo(16 / 9, 2)
  })

  it('Single goes back to one picture filling the frame', () => {
    const t0 = obsTimeline()
    const split = applyLayout(t0, first(t0).id, 'split')
    const c = first(applyLayout(split, first(split).id, 'single'))
    expect(c.layers).toEqual([])
    expect(c.transform.place).toEqual(FULL_PLACE)
    expect(c.transform.crop.w / c.transform.crop.h).toBeCloseTo(1080 / 1920, 2)
    expect(c.layout).toBe('single')
  })

  it('keeps the layer id when laid out again, so a selected layer stays selected', () => {
    const t0 = obsTimeline()
    const split = applyLayout(t0, first(t0).id, 'split')
    const id = first(split).layers[0]!.id
    expect(first(applyLayout(split, first(split).id, 'pip')).layers[0]!.id).toBe(id)
  })

  it('does nothing on a Handoff sequence, which has no frame to lay out in', () => {
    const t = setShape(obsTimeline(), 'handoff')
    expect(applyLayout(t, first(t).id, 'split')).toBe(t)
    expect(addLayer(t, first(t).id, 'L1')).toBe(t)
  })
})

describe('adding and removing layers', () => {
  it('adds a layer where Picture in picture would, from the right view, and makes it Custom', () => {
    const t0 = obsTimeline()
    const c = first(addLayer(t0, first(t0).id, 'L1'))
    expect(c.layers.map((l) => l.id)).toEqual(['L1'])
    expect(c.layers[0]!.place.x + c.layers[0]!.place.w).toBeCloseTo(1)
    expect(inside(c.layers[0]!.crop, RIGHT)).toBe(true)
    expect(c.layout).toBe('custom')
  })

  it('adds from the middle of an ordinary source', () => {
    let t = obsTimeline()
    t = addClip(t, 'other')
    const c = v1Clips(t)[1]!
    const layer = findVideoClip(addLayer(t, c.id, 'L1'), c.id)!.clip.layers[0]!
    expect(layer.crop.x + layer.crop.w / 2).toBeCloseTo(960, -1)
  })

  it('stops at eight layers', () => {
    let t = obsTimeline()
    for (let i = 0; i < MAX_LAYERS + 2; i++) t = addLayer(t, first(t).id, `L${i}`)
    expect(first(t).layers).toHaveLength(MAX_LAYERS)
  })

  it('removes one, and that makes the layout Custom', () => {
    const t0 = obsTimeline()
    const split = applyLayout(t0, first(t0).id, 'split')
    const c = first(removeLayer(split, first(split).id, first(split).layers[0]!.id))
    expect(c.layers).toEqual([])
    expect(c.layout).toBe('custom')
  })
})

describe('moving pictures', () => {
  it('sets a layer crop without touching the main picture or the layout', () => {
    const t0 = obsTimeline()
    const split = applyLayout(t0, first(t0).id, 'split')
    const c0 = first(split)
    const c = first(setCrop(split, c0.id, { x: 2000, y: 100, w: 800, h: 700 }, c0.layers[0]!.id))
    expect(c.layers[0]!.crop).toEqual({ x: 2000, y: 100, w: 800, h: 700 })
    expect(c.transform.crop).toEqual(c0.transform.crop)
    expect(c.layout).toBe('split')
  })

  it('placing a picture by hand makes the layout Custom', () => {
    const t0 = obsTimeline()
    const split = applyLayout(t0, first(t0).id, 'split')
    const c0 = first(split)
    const c = first(setPlace(split, c0.id, c0.layers[0]!.id, { x: 0.1, y: 0.6, w: 0.8, h: 0.3 }, false))
    expect(c.layers[0]!.place).toEqual({ x: 0.1, y: 0.6, w: 0.8, h: 0.3 })
    expect(c.layers[0]!.crop).toEqual(c0.layers[0]!.crop)
    expect(c.layout).toBe('custom')
  })

  it('with the lock, reshapes the crop to its new place, inside its view', () => {
    const t0 = obsTimeline()
    const split = applyLayout(t0, first(t0).id, 'split')
    const c0 = first(split)
    const place = { x: 0, y: 0.5, w: 1, h: 0.25 }
    const c = first(setPlace(split, c0.id, c0.layers[0]!.id, place, true))
    const crop = c.layers[0]!.crop
    expect(crop.w / crop.h).toBeCloseTo(placeAspect(place, 1080, 1920), 2)
    expect(inside(crop, RIGHT)).toBe(true)
  })

  it('gives back its crop when an edge is dragged away and back to where it started', () => {
    // Every movement of a drag reshapes the crop the drag began with. Reshaping
    // the latest crop instead zoomed it in a little on every movement.
    const t0 = obsTimeline()
    const split = applyLayout(t0, first(t0).id, 'split')
    const start = first(split).transform
    let t = split
    for (const h of [0.4, 0.2, 0.0625, 0.2, 0.4, 0.5]) {
      t = setPlace(t, first(t).id, MAIN_PICTURE, { x: 0, y: 0.5 - h, w: 1, h }, true, start.crop)
    }
    expect(first(t).transform.crop).toEqual(start.crop)
  })

  it('places the main picture too', () => {
    const t0 = obsTimeline()
    const c = first(setPlace(t0, first(t0).id, MAIN_PICTURE, { x: 0, y: 0, w: 1, h: 0.5 }, true))
    expect(c.transform.place).toEqual({ x: 0, y: 0, w: 1, h: 0.5 })
    expect(hasLayout(c)).toBe(true)
  })
})

describe('swapping the views', () => {
  it('exchanges the crops and keeps the places and the drawing order', () => {
    const t0 = obsTimeline()
    const pip = applyLayout(t0, first(t0).id, 'pip')
    const before = first(pip)
    const c = first(swapPictures(pip, before.id))
    expect(c.transform.place).toEqual(before.transform.place)
    expect(c.layers[0]!.place).toEqual(before.layers[0]!.place)
    // The full frame now shows the right view, the box the left.
    expect(inside(c.transform.crop, RIGHT)).toBe(true)
    expect(inside(c.layers[0]!.crop, LEFT)).toBe(true)
    // Each crop reshaped to its own place.
    expect(c.transform.crop.w / c.transform.crop.h).toBeCloseTo(1080 / 1920, 2)
    expect(c.layers[0]!.crop.w / c.layers[0]!.crop.h).toBeCloseTo(16 / 9, 2)
    expect(c.layout).toBe('pip')
  })
})

describe('layers and the rest of the editor', () => {
  it('splitting a clip gives both halves the same layout', () => {
    const t0 = obsTimeline()
    const split = applyLayout(t0, first(t0).id, 'split')
    const t = v1Clips(splitClip(split, 100))
    expect(t).toHaveLength(2)
    expect(t[1]!.layers).toEqual(t[0]!.layers)
    expect(t[1]!.layout).toBe('split')
  })

  it('Apply to all copies the layout to every clip of the same recording, and no other', () => {
    let t = obsTimeline()
    t = addClip(addClip(t, 'obs'), 'other')
    t = applyLayout(t, v1Clips(t)[0]!.id, 'split')
    t = applyLayoutToSource(t, v1Clips(t)[0]!.id)
    const clips = v1Clips(t)
    expect(clips[1]!.layers).toEqual(clips[0]!.layers)
    expect(clips[1]!.transform).toEqual(clips[0]!.transform)
    expect(clips[1]!.layout).toBe('split')
    expect(clips[2]!.layers).toEqual([])
  })

  it('duplicating a sequence copies each clip with its layers', () => {
    let p = createProject('x', 30, { width: 1080, height: 1920 })
    p = addClipTo({ ...p, media: [media('obs', 3840, 1080)] }, 'obs')
    const clipId = v1Clips(timelineOf(p, S1))[0]!.id
    p = editSequence(p, S1, (t) => applyLayout(t, clipId, 'split'))
    const copy = v1Clips(timelineOf(duplicateSequence(p, S1, 'copy'), 'copy'))[0]!
    expect(copy.layers).toHaveLength(1)
    expect(copy.layout).toBe('split')
  })
})

describe('changing the shape of a sequence', () => {
  it('lays a vertical Split out side by side on landscape, each crop inside its own view', () => {
    const t0 = obsTimeline()
    const t = setShape(applyLayout(t0, first(t0).id, 'split'), 'landscape')
    const c = first(t)
    expect(c.transform.place).toEqual({ x: 0, y: 0, w: 0.5, h: 1 })
    expect(c.layers[0]!.place).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
    expect(inside(c.transform.crop, LEFT)).toBe(true)
    expect(inside(c.layers[0]!.crop, RIGHT)).toBe(true)
    expect(c.transform.crop.w / c.transform.crop.h).toBeCloseTo(960 / 1080, 2)
  })

  it('keeps a Picture in picture box in the corner, the shape of its view', () => {
    const t0 = obsTimeline()
    const c = first(setShape(applyLayout(t0, first(t0).id, 'pip'), 'landscape'))
    const box = c.layers[0]!.place
    expect(box.x + box.w).toBeCloseTo(1)
    expect(placeAspect(box, 1920, 1080)).toBeCloseTo(16 / 9, 2)
  })

  it('scales a place laid out by hand to fit, keeping its shape', () => {
    const t0 = obsTimeline()
    const placed = setPlace(t0, first(t0).id, MAIN_PICTURE, { x: 0, y: 0, w: 1, h: 0.5 }, true)
    const c = first(setShape(placed, 'landscape'))
    expect(c.layout).toBe('custom')
    expect(placeAspect(c.transform.place, 1920, 1080)).toBeCloseTo(1080 / 960, 2)
    expect(c.transform.place.h).toBeLessThanOrEqual(1)
  })

  it('reshapes a plain clip exactly as before', () => {
    const t = setShape(obsTimeline(), 'square')
    const c = first(t)
    expect(c.transform.place).toEqual(FULL_PLACE)
    expect(c.transform.crop.w).toBe(c.transform.crop.h)
  })

  it('leaves the layers alone for Handoff, and lays them out again on the way back', () => {
    const t0 = obsTimeline()
    const split = applyLayout(t0, first(t0).id, 'split')
    const handoff = setShape(split, 'handoff')
    expect(first(handoff).layers).toEqual(first(split).layers)
    const back = first(setShape(handoff, 'landscape'))
    expect(back.layers[0]!.place).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
  })
})
