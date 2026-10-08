import { describe, it, expect } from 'vitest'
import {
  addClip,
  applyLayout,
  clearZoomKeys,
  createTimeline,
  findVideoClip,
  joinClips,
  moveZoomKey,
  PRESET_SCALE,
  removeZoomKey,
  setClipIn,
  setCrop,
  setShape,
  setZoomEase,
  setZoomKey,
  setZoomKeys,
  settleZoomKeys,
  splitClip,
  v1Clips,
  zoomPreset,
  type Clip,
  type ProjectMedia,
  type Rect,
  type Timeline
} from '../../src/shared/project'
import { cropAtKeys } from '../../src/shared/crop-geometry'

/**
 * Plan 60: the zoom keyframes of a clip's main picture, on its recording's
 * own frames, and what the edits that already change a clip do to them.
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
const aspect = (r: Rect): number => r.w / r.h

/** Ten per cent in on the vertical crop, centred. */
const closer: Rect = { x: 686, y: 54, w: 548, h: 972 }

/** `c` zooming in from frame 60 to 90 of its recording and back out from 180 to 210. */
function zooming(): Timeline {
  const t = one()
  const start = clip(t).transform.crop
  return setZoomKeys(t, 'c', [
    { at: 60, crop: start },
    { at: 90, crop: closer },
    { at: 180, crop: closer, ease: 'linear' },
    { at: 210, crop: start }
  ])
}

/** The crop every frame of the recording shows in a clip, from its first to its last. */
function framesOf(c: Clip): Map<number, Rect> {
  const out = new Map<number, Rect>()
  for (let f = c.sourceIn; f < c.sourceOut; f++) out.set(f, cropAtKeys(c.transform.crop, c.transform.keys, f))
  return out
}

describe('a zoom keyframe', () => {
  it('is added in order, and a second on the same frame changes it and keeps its ease', () => {
    let t = one()
    const start = clip(t).transform.crop
    t = setZoomKey(t, 'c', 90, closer)
    t = setZoomKey(t, 'c', 30, start)
    expect(clip(t).transform.keys!.map((k) => k.at)).toEqual([30, 90])
    t = setZoomEase(t, 'c', 30, 'out')
    t = setZoomKey(t, 'c', 30, { ...start, x: start.x + 10 })
    expect(clip(t).transform.keys![0]).toEqual({ at: 30, crop: { ...start, x: start.x + 10 }, ease: 'out' })
  })

  it('is held inside the clip, its crop inside the recording on even pixels and in the clip shape', () => {
    let t = one()
    t = setZoomKey(t, 'c', 5000, { x: -40, y: 3, w: 1001, h: 1001 })
    const [k] = clip(t).transform.keys!
    expect(k!.at).toBe(299)
    expect(k!.crop.x).toBeGreaterThanOrEqual(0)
    for (const v of Object.values(k!.crop)) expect(v % 2).toBe(0)
    expect(aspect(k!.crop)).toBeCloseTo(aspect(clip(one()).transform.crop), 2)
  })

  it('keeps the clip crop equal to the crop on its first frame', () => {
    let t = one()
    t = setZoomKey(t, 'c', 0, closer)
    expect(clip(t).transform.crop).toEqual(closer)
  })

  it('is moved, taking the place of one already there, and removed, the last one taking the zoom off', () => {
    let t = zooming()
    t = moveZoomKey(t, 'c', 90, 180)
    expect(clip(t).transform.keys!.map((k) => k.at)).toEqual([60, 180, 210])
    // The moved one wins, with its own ease.
    expect(clip(t).transform.keys![1]!.ease).toBeUndefined()
    t = removeZoomKey(t, 'c', 60)
    t = removeZoomKey(t, 'c', 180)
    t = removeZoomKey(t, 'c', 210)
    expect(clip(t).transform.keys).toBeUndefined()
  })

  it('keeps Smooth unsaid, since absent is smooth', () => {
    const t = setZoomEase(setZoomEase(zooming(), 'c', 60, 'hold'), 'c', 60, 'smooth')
    expect('ease' in clip(t).transform.keys![0]!).toBe(false)
  })

  it('all go at once, the clip keeping the crop its first frame had', () => {
    const t = clearZoomKeys(setZoomKey(one(), 'c', 0, closer), 'c')
    expect(clip(t).transform.keys).toBeUndefined()
    expect(clip(t).transform.crop).toEqual(closer)
  })
})

describe('a zoom through the edits that change a clip', () => {
  it('survives a split: each half shows the same picture on every frame as the whole did', () => {
    const whole = clip(zooming())
    const before = framesOf(whole)
    const t = settleZoomKeys(splitClip(zooming(), 100, 'c'))
    const [first, second] = v1Clips(t)
    for (const half of [first!, second!]) {
      for (const [f, crop] of framesOf(half)) expect(crop).toEqual(before.get(f))
      expect(half.transform.crop).toEqual(before.get(half.sourceIn))
    }
    // The first half keeps one keyframe past its end, the second one before its start.
    expect(first!.transform.keys!.map((k) => k.at)).toEqual([60, 90, 180])
    expect(second!.transform.keys!.map((k) => k.at)).toEqual([90, 180, 210])
  })

  it('survives a trimmed start without moving on the picture', () => {
    const before = framesOf(clip(zooming()))
    const t = settleZoomKeys(setClipIn(zooming(), 'c', 120))
    const c = clip(t)
    expect(c.sourceIn).toBe(120)
    for (const [f, crop] of framesOf(c)) expect(crop).toEqual(before.get(f))
    expect(c.transform.crop).toEqual(closer)
  })

  it('is whole again when the halves of a split are joined', () => {
    const t = settleZoomKeys(splitClip(zooming(), 100, 'c'))
    const joined = settleZoomKeys(joinClips(t, v1Clips(t).map((c) => c.id), true))
    const [c] = v1Clips(joined)
    expect(c!.transform.keys).toEqual(clip(zooming()).transform.keys)
  })

  it('takes a new shape with every keyframe when the sequence does', () => {
    const t = setShape(zooming(), 'square')
    const c = clip(t)
    expect(aspect(c.transform.crop)).toBeCloseTo(1, 2)
    for (const k of c.transform.keys!) expect(aspect(k.crop)).toBeCloseTo(1, 2)
    // Still a zoom in: its closer keyframes are smaller than where it starts.
    expect(c.transform.keys![1]!.crop.w).toBeLessThan(c.transform.keys![0]!.crop.w)
  })

  it('takes a new shape with every keyframe when a layout is applied', () => {
    const t = applyLayout(zooming(), 'c', 'split')
    const c = clip(t)
    for (const k of c.transform.keys!) expect(aspect(k.crop)).toBeCloseTo(aspect(c.transform.crop), 2)
    // Where it starts is exactly the crop the layout gave it.
    expect(c.transform.keys![0]!.crop).toEqual(c.transform.crop)
  })

  it('starts where a crop set on the main picture puts it', () => {
    const start = { x: 600, y: 0, w: 606, h: 1080 }
    const t = setCrop(zooming(), 'c', start)
    expect(clip(t).transform.keys![0]!.crop).toEqual(start)
    expect(clip(t).transform.crop).toEqual(start)
  })

  it('keeps what the zoom does when the whole clip is framed again: its closer keyframes follow', () => {
    const before = clip(zooming())
    // Half the height, around another centre: the closer keyframe goes half as tall and moves with it.
    const start = { x: 200, y: 200, w: 304, h: 540 }
    const c = clip(setCrop(zooming(), 'c', start))
    const was = before.transform.keys![1]!.crop.h / before.transform.keys![0]!.crop.h
    const now = c.transform.keys![1]!.crop.h / c.transform.keys![0]!.crop.h
    expect(now).toBeCloseTo(was, 1)
    const centre = (r: Rect): number => r.x + r.w / 2
    expect(centre(c.transform.keys![1]!.crop)).toBeCloseTo(centre(start), -1)
  })
})

describe('a zoom made in one click', () => {
  it('punches in on a frame: the frame before holds, and it is 120% from there', () => {
    const t = zoomPreset(one(), 'c', 'punch', 90, 90)
    const c = clip(t)
    const start = c.transform.crop
    expect(c.transform.keys!.map((k) => [k.at, k.ease])).toEqual([
      [89, 'hold'],
      [90, undefined]
    ])
    expect(cropAtKeys(start, c.transform.keys, 89)).toEqual(start)
    const punched = cropAtKeys(start, c.transform.keys, 90)
    expect(start.w / punched.w).toBeCloseTo(PRESET_SCALE, 1)
    // Around the same middle.
    expect(punched.x + punched.w / 2).toBeCloseTo(start.x + start.w / 2, -1)
  })

  // Bugs and notes 2, note 14.
  it('goes as far in as asked, closes in on the point given, kept inside the view', () => {
    const start = clip(one()).transform.crop
    const far = clip(zoomPreset(one(), 'c', 'punch', 90, 90, undefined, { scale: 2 }))
    const at = (c: Clip): Rect => cropAtKeys(c.transform.crop, c.transform.keys, 90)
    expect(start.w / at(far).w).toBeCloseTo(2, 1)
    // A point near the recording's left edge: as near it as the recording allows, not past its edge.
    const left = at(clip(zoomPreset(one(), 'c', 'punch', 90, 90, undefined, { point: { x: 10, y: start.y + start.h / 2 } })))
    expect(left.x).toBe(0)
    const right = at(clip(zoomPreset(one(), 'c', 'punch', 90, 90, undefined, { point: { x: start.x + start.w * 0.7, y: start.y + start.h / 2 } })))
    expect(right.x + right.w / 2).toBeCloseTo(start.x + start.w * 0.7, -1)
  })

  it('takes as long as asked to get there', () => {
    const c = clip(zoomPreset(one(), 'c', 'in', 60, 60, undefined, { ramp: 30 }))
    expect(c.transform.keys!.map((k) => k.at)).toEqual([60, 90])
  })

  it('zooms in over half a second', () => {
    const c = clip(zoomPreset(one(), 'c', 'in', 60, 60))
    expect(c.transform.keys!.map((k) => k.at)).toEqual([60, 75])
  })

  it('zooms in and back out across a range', () => {
    const c = clip(zoomPreset(one(), 'c', 'inOut', 60, 120))
    expect(c.transform.keys!.map((k) => k.at)).toEqual([60, 75, 105, 120])
    expect(c.transform.keys![3]!.crop).toEqual(c.transform.keys![0]!.crop)
  })
})
