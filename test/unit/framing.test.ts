import { describe, it, expect } from 'vitest'
import {
  createTimeline,
  addClip,
  addLayer,
  applyLayout,
  framingOf,
  framingRefusal,
  setCrop,
  setFraming,
  setFramingOn,
  setPlace,
  v1Clips,
  type Timeline,
  type ProjectMedia,
  type Clip
} from '../../src/shared/project'
import { nudgePlace } from '../../src/shared/layout'
import { editedAt } from '../../src/shared/playback'

/**
 * Plan 13, step 4: framing carried from one clip to another, a place nudged
 * by pixels, and which picture the monitor edits.
 */

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
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** A vertical timeline with a clip of `a` then a clip of `b`, each ten seconds. */
function twoClips(a: [number, number], b: [number, number]): Timeline {
  const t = { ...createTimeline(30, { width: 1080, height: 1920 }, 'vertical'), media: [media('a', ...a), media('b', ...b)] }
  return addClip(addClip(t, 'a'), 'b')
}

function clip(t: Timeline, i: number): Clip {
  return v1Clips(t)[i]!
}

describe('framing', () => {
  it('carries crops, places, layers and layout exactly onto a recording of the same size', () => {
    let t = twoClips([3840, 1080], [3840, 1080])
    const from = clip(t, 0).id
    t = applyLayout(t, from, 'split')
    const framing = framingOf(t, from)!
    t = setFraming(t, clip(t, 1).id, framing)
    const a = clip(t, 0)
    const b = clip(t, 1)
    expect(b.transform).toEqual(a.transform)
    expect(b.layout).toBe('split')
    expect(b.layers.map((l) => [l.crop, l.place])).toEqual(a.layers.map((l) => [l.crop, l.place]))
    // Layers of its own, not the other clip's.
    expect(b.layers.map((l) => l.id)).not.toEqual(a.layers.map((l) => l.id))
  })

  it('scales each crop by the same fraction of a recording of the same shape, exactly', () => {
    let t = twoClips([3840, 2160], [1920, 1080])
    const from = clip(t, 0).id
    t = setCrop(t, from, { x: 1200, y: 400, w: 608, h: 1080 })
    t = setFraming(t, clip(t, 1).id, framingOf(t, from)!)
    expect(clip(t, 1).transform.crop).toEqual({ x: 600, y: 200, w: 304, h: 540 })
  })

  it('keeps each crop the shape of its place on a recording of another shape, around the same point', () => {
    let t = twoClips([3840, 1080], [1920, 1080])
    const from = clip(t, 0).id
    t = setCrop(t, from, { x: 1920, y: 0, w: 1920, h: 1080 })
    t = setFraming(t, clip(t, 1).id, framingOf(t, from)!)
    // The right half of the wide one frames the right half of the narrow one,
    // centred on its middle, in the vertical frame's shape: no bars at the sides.
    expect(clip(t, 1).transform.crop).toEqual({ x: 1136, y: 0, w: 608, h: 1080 })
  })

  it('lays a Split out again when pasted into a sequence of another shape', () => {
    let vertical = twoClips([1920, 1080], [1920, 1080])
    const from = clip(vertical, 0).id
    vertical = applyLayout(vertical, from, 'split')
    const framing = framingOf(vertical, from)!
    expect(framing.place.h).toBe(0.5)
    let landscape: Timeline = { ...createTimeline(30, { width: 1920, height: 1080 }, 'landscape'), media: vertical.media }
    landscape = addClip(landscape, 'b')
    landscape = setFraming(landscape, clip(landscape, 0).id, framing)
    const pasted = clip(landscape, 0)
    expect(pasted.layout).toBe('split')
    // Side by side, and each crop the shape of its half of a landscape frame.
    expect(pasted.transform.place).toEqual({ x: 0, y: 0, w: 0.5, h: 1 })
    const c = pasted.transform.crop
    expect(Math.abs(c.w / c.h - (960 / 1080))).toBeLessThan(0.01)
  })

  it('leaves the clip’s timing alone', () => {
    let t = twoClips([1920, 1080], [1920, 1080])
    const before = clip(t, 1)
    t = setFraming(t, before.id, framingOf(t, clip(t, 0).id)!)
    const after = clip(t, 1)
    expect([after.timelineStart, after.sourceIn, after.sourceOut]).toEqual([before.timelineStart, before.sourceIn, before.sourceOut])
  })

  it('keeps the crop its own shape under a shape with no frame, on a recording of another shape', () => {
    let t = twoClips([3840, 1080], [1920, 1080])
    const from = clip(t, 0).id
    t = setCrop(t, from, { x: 2000, y: 0, w: 608, h: 1080 })
    const handoff: Timeline = { ...t, presetId: 'handoff' }
    const done = setFraming(handoff, clip(handoff, 1).id, framingOf(t, from)!)
    const c = clip(done, 1).transform.crop
    expect(Math.abs(c.w / c.h - 608 / 1080)).toBeLessThan(0.01)
  })

  it('takes only the crop under a shape with no frame', () => {
    let t = twoClips([1920, 1080], [1920, 1080])
    const from = clip(t, 0).id
    t = addLayer(t, from, 'L1')
    t = setCrop(t, from, { x: 100, y: 100, w: 800, h: 600 })
    const framing = framingOf(t, from)!
    const handoff: Timeline = { ...t, presetId: 'handoff' }
    const done = setFraming(handoff, clip(handoff, 1).id, framing)
    expect(clip(done, 1).transform.crop).toEqual({ x: 100, y: 100, w: 800, h: 600 })
    expect(clip(done, 1).layers).toEqual([])
  })
})

describe('framing pasted onto several clips', () => {
  it('frames every clip named, in one call', () => {
    let t = twoClips([3840, 1080], [3840, 1080])
    t = addClip(t, 'b')
    const from = clip(t, 0).id
    t = applyLayout(t, from, 'split')
    const framing = framingOf(t, from)!
    t = setFramingOn(t, [clip(t, 1).id, clip(t, 2).id], framing)
    expect(clip(t, 1).layout).toBe('split')
    expect(clip(t, 2).layout).toBe('split')
    expect(clip(t, 2).transform).toEqual(clip(t, 0).transform)
    // Each has layers of its own.
    expect(clip(t, 2).layers.map((l) => l.id)).not.toEqual(clip(t, 1).layers.map((l) => l.id))
  })

  it('passes over a clip that is not there and frames the rest', () => {
    let t = twoClips([3840, 1080], [3840, 1080])
    const framing = framingOf(t, clip(t, 0).id)!
    const before = clip(t, 1)
    t = setFramingOn(t, ['gone', clip(t, 1).id], { ...framing, crop: { x: 100, y: 0, w: 1000, h: 1080 } })
    expect(clip(t, 1).transform.crop).not.toEqual(before.transform.crop)
  })
})

describe('a picture put where it already is', () => {
  it('keeps its named layout, so a change of shape still lays it out again', () => {
    let t = twoClips([1920, 1080], [1920, 1080])
    const id = clip(t, 0).id
    t = applyLayout(t, id, 'pip')
    const layer = clip(t, 0).layers[0]!
    t = setPlace(t, id, layer.id, layer.place, false)
    expect(clip(t, 0).layout).toBe('pip')
  })
})

describe('nudgePlace', () => {
  it('moves a place by output pixels, and keeps it inside the frame', () => {
    const place = { x: 0.5, y: 0.5, w: 0.25, h: 0.25 }
    const right = nudgePlace(place, 20, 0, 1080, 1920)
    expect(right.x * 1080).toBeCloseTo(560)
    expect(right.y).toBe(place.y)
    const far = nudgePlace(place, 5000, -5000, 1080, 1920)
    expect(far.x + far.w).toBeCloseTo(1)
    expect(far.y).toBe(0)
  })
})

describe('editedAt', () => {
  it('is the selected picture under the playhead, else the lowest there', () => {
    const t = twoClips([1920, 1080], [1920, 1080])
    const [a, b] = [clip(t, 0), clip(t, 1)]
    expect(editedAt(t, 10, null)?.clip.id).toBe(a.id)
    expect(editedAt(t, 10, a.id)?.clip.id).toBe(a.id)
    // Selected but not under the playhead: the one there instead.
    expect(editedAt(t, 10, b.id)?.clip.id).toBe(a.id)
    expect(editedAt(t, b.timelineStart + 1, b.id)?.clip.id).toBe(b.id)
    // Past the end, nothing.
    expect(editedAt(t, 100_000, a.id)).toBeNull()
  })
})

describe('a framing that will not go on', () => {
  it('refuses both views of a side by side recording onto a recording with one, and says why', () => {
    let t = twoClips([3840, 1080], [1920, 1080])
    const from = clip(t, 0).id
    t = applyLayout(t, from, 'split')
    expect(framingRefusal(t, clip(t, 1).id, framingOf(t, from)!)).toMatch(/holds only one/)
  })

  it('takes one view of a side by side recording onto any recording, and both onto another like it', () => {
    let t = twoClips([3840, 1080], [1920, 1080])
    expect(framingRefusal(t, clip(t, 1).id, framingOf(t, clip(t, 0).id)!)).toBeNull()
    t = twoClips([3840, 1080], [3840, 1080])
    t = applyLayout(t, clip(t, 0).id, 'split')
    expect(framingRefusal(t, clip(t, 1).id, framingOf(t, clip(t, 0).id)!)).toBeNull()
  })
})
