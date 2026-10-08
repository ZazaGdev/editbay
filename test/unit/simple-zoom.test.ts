import { describe, it, expect } from 'vitest'
import {
  addClip,
  createTimeline,
  findVideoClip,
  joinClips,
  setClipIn,
  setClipOut,
  setCrop,
  setSimpleZoom,
  setZoomKey,
  setZoomKeys,
  settleZoomKeys,
  simpleLoses,
  splitClip,
  startEndOf,
  useKeyframes,
  useSimpleZoom,
  v1Clips,
  zoomPreset,
  type Clip,
  type ProjectMedia,
  type Rect,
  type Timeline
} from '../../src/shared/project'
import { cropAtKeys } from '../../src/shared/crop-geometry'

/**
 * Plan 65: a Simple zoom, a Start picture on the clip's first frame and an
 * End picture on its last, beside the keyframes of plan 60.
 */

function media(id: string): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** A ten second recording on V1 of a vertical sequence, as `c`: its crop the tallest 9:16 in the middle. */
function one(): Timeline {
  const t = createTimeline(30, { width: 1080, height: 1920 })
  return addClip({ ...t, media: [media('a')] }, 'a', 'c')
}

const clip = (t: Timeline, id = 'c'): Clip => findVideoClip(t, id)!.clip
const cropOn = (c: Clip, frame: number): Rect => cropAtKeys(c.transform.crop, c.transform.keys, frame)

/** Ten per cent in on the vertical crop, centred. */
const closer: Rect = { x: 686, y: 54, w: 548, h: 972 }

/** `c` zooming in from its Start to `closer` across the whole clip. */
function zooming(ease?: 'smooth' | 'linear' | 'cut'): Timeline {
  return setSimpleZoom(one(), 'c', { end: closer, ...(ease ? { ease } : {}) })
}

describe('a Simple zoom', () => {
  it('shows Start on the clip first frame and End on its last, and moves in between', () => {
    const t = zooming()
    const c = clip(t)
    const start = clip(one()).transform.crop
    expect(c.transform.simple).toBe('smooth')
    expect(cropOn(c, 0)).toEqual(start)
    expect(cropOn(c, 299)).toEqual(closer)
    expect(cropOn(c, 150).w).toBeLessThan(start.w)
    expect(cropOn(c, 150).w).toBeGreaterThan(closer.w)
    expect(startEndOf(c)).toEqual({ start, end: closer })
  })

  it('stretches or squeezes to fit a trimmed clip, Start and End on its new ends', () => {
    for (const t of [settleZoomKeys(setClipIn(zooming(), 'c', 100)), settleZoomKeys(setClipOut(zooming(), 'c', 150))]) {
      const c = clip(t)
      expect(cropOn(c, c.sourceIn)).toEqual(clip(one()).transform.crop)
      expect(cropOn(c, c.sourceOut - 1)).toEqual(closer)
      expect(c.transform.keys!.map((k) => k.at)).toEqual([c.sourceIn, c.sourceOut - 1])
    }
  })

  it('goes steadily, or stays on Start and cuts to End halfway', () => {
    const steady = clip(zooming('linear'))
    const start = clip(one()).transform.crop
    expect(cropOn(steady, 149.5).w).toBeCloseTo((start.w + closer.w) / 2, 0)
    const cut = clip(zooming('cut'))
    expect(cropOn(cut, 149)).toEqual(start)
    expect(cropOn(cut, 150)).toEqual(closer)
    expect(cropOn(cut, 299)).toEqual(closer)
  })

  it('is no zoom when End is the same as Start, and a still clip framed again stays still', () => {
    const start = clip(one()).transform.crop
    const back = clip(setSimpleZoom(zooming(), 'c', { end: start }))
    expect(back.transform.simple).toBeUndefined()
    expect(back.transform.keys).toBeUndefined()
    const reframed = clip(setSimpleZoom(one(), 'c', { start: closer }))
    expect(reframed.transform.keys).toBeUndefined()
    expect(reframed.transform.crop).toEqual(closer)
  })

  it('swaps into a zoom out, and changes only the end it is given', () => {
    const start = clip(one()).transform.crop
    const out = clip(setSimpleZoom(zooming(), 'c', { start: closer, end: start }))
    expect(startEndOf(out)).toEqual({ start: closer, end: start })
    const moved = { ...closer, x: closer.x - 100 }
    expect(startEndOf(clip(setSimpleZoom(zooming(), 'c', { end: moved })))).toEqual({ start, end: moved })
  })

  it('is split into two pieces that each run from where the picture was at the cut, with no jump', () => {
    const before = clip(zooming('linear'))
    const t = settleZoomKeys(splitClip(zooming('linear'), 100, 'c'))
    const [first, second] = v1Clips(t)
    expect(first!.transform.simple).toBe('linear')
    expect(second!.transform.simple).toBe('linear')
    expect(startEndOf(first!).start).toEqual(startEndOf(before).start)
    expect(startEndOf(second!).end).toEqual(closer)
    // Each piece is its own move, from its own first frame to its own last.
    expect(first!.transform.keys!.map((k) => k.at)).toEqual([0, 99])
    expect(second!.transform.keys!.map((k) => k.at)).toEqual([100, 299])
    // The frames either side of the cut show what the whole clip showed there, to the even pixel.
    expect(cropOn(first!, 99).w).toBeCloseTo(cropOn(before, 99).w, -1)
    expect(cropOn(second!, 100).w).toBeCloseTo(cropOn(before, 100).w, -1)
  })

  it('is whole again when the pieces of a split are joined: the first Start to the second End', () => {
    const t = settleZoomKeys(splitClip(zooming(), 100, 'c'))
    const [first, second] = v1Clips(t)
    const joined = clip(settleZoomKeys(joinClips(t, [first!.id, second!.id])), first!.id)
    expect(joined.transform.simple).toBe('smooth')
    expect(startEndOf(joined)).toEqual({ start: clip(one()).transform.crop, end: closer })
    expect(joined.transform.keys!.map((k) => k.at)).toEqual([0, 299])
  })

  it('reframed as a whole keeps its move: End follows Start', () => {
    const start = clip(one()).transform.crop
    const t = settleZoomKeys(setCrop(zooming(), 'c', { ...start, x: start.x - 200 }))
    const { start: s, end: e } = startEndOf(clip(t))
    expect(s.x).toBe(start.x - 200)
    expect(e.x).toBe(closer.x - 200)
  })
})

describe('going between Simple and keyframes', () => {
  it('makes a Simple zoom keyframes on the same frames, so nothing on screen changes', () => {
    const was = clip(zooming())
    const c = clip(useKeyframes(zooming(), 'c'))
    expect(c.transform.simple).toBeUndefined()
    expect(c.transform.keys).toEqual(was.transform.keys)
    // Now a trim leaves the keyframes on the recording, as keyframes put by hand do.
    const trimmed = clip(settleZoomKeys(setClipIn(useKeyframes(zooming(), 'c'), 'c', 100)))
    expect(cropOn(trimmed, 100)).toEqual(cropOn(was, 100))
  })

  it('turns a Simple zoom into keyframes as soon as one is put by hand or a one-click zoom is used', () => {
    expect(clip(setZoomKey(zooming(), 'c', 150, closer)).transform.simple).toBeUndefined()
    expect(clip(zoomPreset(zooming(), 'c', 'punch', 150, 150)).transform.simple).toBeUndefined()
  })

  it('makes keyframes a Simple zoom from the pictures on the first and last frames', () => {
    const start = clip(one()).transform.crop
    const keyed = setZoomKeys(one(), 'c', [
      { at: 30, crop: start, ease: 'linear' },
      { at: 90, crop: closer },
      { at: 200, crop: start }
    ])
    expect(simpleLoses(clip(keyed))).toBe(true)
    const c = clip(useSimpleZoom(keyed, 'c'))
    // Both ends show `start`: the keyframes between are what made it move, and they went.
    expect(c.transform.simple).toBeUndefined()
    expect(c.transform.keys).toBeUndefined()
    const inOnly = setZoomKeys(one(), 'c', [
      { at: 0, crop: start, ease: 'linear' },
      { at: 299, crop: closer }
    ])
    expect(simpleLoses(clip(inOnly))).toBe(false)
    const simple = clip(useSimpleZoom(inOnly, 'c'))
    expect(simple.transform.simple).toBe('linear')
    expect(startEndOf(simple)).toEqual({ start, end: closer })
  })
})

describe('a Simple zoom joined to a clip that is not one', () => {
  /** Each frame's crop, for the frames given, to the even pixel. */
  const widths = (c: Clip, frames: number[]): number[] => frames.map((f) => Math.round(cropOn(c, f).w / 2) * 2)

  it('plays as the two pieces did, a Simple one then a still one, as keyframes put by hand', () => {
    const start = clip(one()).transform.crop
    // Split first, then make only the first piece a Simple zoom: the second stays still on `start`.
    const cut = settleZoomKeys(splitClip(one(), 100, 'c'))
    const [first, second] = v1Clips(cut)
    const t = settleZoomKeys(setSimpleZoom(cut, first!.id, { end: closer }))
    const before = [clip(t, first!.id), clip(t, second!.id)]
    const joined = clip(settleZoomKeys(joinClips(t, [first!.id, second!.id])), first!.id)
    expect(joined.transform.simple).toBeUndefined()
    expect(widths(joined, [0, 50, 99, 100, 200, 299])).toEqual([
      ...widths(before[0]!, [0, 50, 99]),
      ...widths(before[1]!, [100, 200, 299])
    ])
    expect(cropOn(joined, 299)).toEqual(start)
  })

  it('keeps every keyframe of a keyframed second piece, rather than only its ends', () => {
    const cut = settleZoomKeys(splitClip(one(), 100, 'c'))
    const [first, second] = v1Clips(cut)
    const start = clip(one()).transform.crop
    let t = setSimpleZoom(cut, first!.id, { end: closer })
    t = setZoomKeys(t, second!.id, [
      { at: 150, crop: start },
      { at: 200, crop: closer },
      { at: 250, crop: start }
    ])
    const joined = clip(settleZoomKeys(joinClips(t, [first!.id, second!.id])), first!.id)
    expect(joined.transform.keys!.filter((k) => k.at >= 150).map((k) => k.at)).toEqual([150, 200, 250])
    expect(cropOn(joined, 200)).toEqual(closer)
  })
})

describe('what going to Simple would lose', () => {
  it('counts an ease Simple has no word for, as well as keyframes in between', () => {
    const start = clip(one()).transform.crop
    const slowly = setZoomKeys(one(), 'c', [
      { at: 0, crop: start, ease: 'in' },
      { at: 299, crop: closer }
    ])
    expect(simpleLoses(clip(slowly))).toBe(true)
    // A Cut made keyframes and back: nothing lost.
    expect(simpleLoses(clip(useKeyframes(zooming('cut'), 'c')))).toBe(false)
  })
})

describe('a split of a Simple zoom near the recording edge', () => {
  it('keeps both pieces inside the recording, wherever it is cut', () => {
    // Against the right edge the whole way, narrowing: the crops between have odd sides.
    const from = { x: 1312, y: 0, w: 608, h: 1080 }
    const to = { x: 1372, y: 60, w: 548, h: 972 }
    const moving = setSimpleZoom(setCrop(one(), 'c', from), 'c', { end: to, ease: 'linear' })
    expect(startEndOf(clip(moving))).toEqual({ start: from, end: to })
    for (let at = 1; at < 299; at++) {
      for (const c of v1Clips(splitClip(moving, at, 'c'))) {
        for (const k of c.transform.keys ?? []) expect(k.crop.x + k.crop.w, `cut at ${at}`).toBeLessThanOrEqual(1920)
      }
    }
  })
})
