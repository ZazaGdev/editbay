import { describe, it, expect } from 'vitest'
import { faceCentredCrop, type FaceSample } from '../../src/shared/face-follow'
import { addClip, addLayer, createTimeline, setCropsOn, v1Clips, zoomOf, type ProjectMedia, type Rect, type Timeline } from '../../src/shared/project'

/**
 * Centre on face (task 100): where the face mostly is over a clip, turned into
 * one still crop of the picture's size with the face in its middle, and that
 * crop put on the same picture of many clips in one step.
 */

const SIZE = { width: 3840, height: 2160 }
const CROP: Rect = { x: 2460, y: 140, w: 920, h: 920 }
const RATE = 5
const face = (cx: number, cy: number, w = 280): Rect => ({ x: cx - w / 2, y: cy - w / 2, w, h: w })
const samples = (n: number, at: (i: number) => Rect[]): FaceSample[] => Array.from({ length: n }, (_, i) => ({ at: i * 6, faces: at(i) }))
const middle = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

describe('faceCentredCrop', () => {
  it('puts the face in the middle of a crop of the same size', () => {
    // The face sits 60 px right of the crop's middle and 50 above, as on episode 3 from 1:30.
    const crop = faceCentredCrop(samples(20, () => [face(2980, 550)]), CROP, SIZE, RATE)!
    expect(middle(crop)).toEqual({ x: 2980, y: 550 })
    expect([crop.w, crop.h]).toEqual([CROP.w, CROP.h])
  })

  it('takes where the face mostly is, so a turn of the head does not throw it', () => {
    const crop = faceCentredCrop(samples(21, (i) => [face(i === 7 || i === 8 ? 3100 : 2950, 540)]), CROP, SIZE, RATE)!
    expect(middle(crop).x).toBe(2950)
  })

  it('follows the face in the crop, not a larger one elsewhere on the recording', () => {
    const crop = faceCentredCrop(samples(10, () => [face(800, 900, 500), face(2950, 560)]), CROP, SIZE, RATE)!
    expect(middle(crop)).toEqual({ x: 2950, y: 560 })
  })

  it('stays inside the recording when the face is near its edge', () => {
    const crop = faceCentredCrop(samples(10, () => [face(3700, 200)]), CROP, SIZE, RATE)!
    expect(crop).toEqual({ x: SIZE.width - CROP.w, y: 0, w: CROP.w, h: CROP.h })
  })

  it('is nothing when no face is found', () => {
    expect(faceCentredCrop(samples(10, () => []), CROP, SIZE, RATE)).toBeNull()
  })
})

function media(id: string): ProjectMedia {
  return {
    id,
    originalPath: `C:\v\${id}.mkv`,
    playablePath: `C:\v\${id}.mkv`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    width: SIZE.width,
    height: SIZE.height,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** Two clips of a 4K recording, each with a Picture 2. */
function twoWithPicture2(): Timeline {
  let t: Timeline = { ...createTimeline(30, { width: 1920, height: 1080 }, 'landscape'), media: [media('rec')] }
  t = addClip(addClip(t, 'rec'), 'rec')
  for (const c of v1Clips(t)) t = addLayer(t, c.id, 'P2')
  return t
}

describe('setCropsOn', () => {
  it('gives the same picture of each clip a crop of its own, leaving the main picture', () => {
    const t = twoWithPicture2()
    const [a, b] = v1Clips(t)
    const square = (x: number): Rect => ({ x, y: 400, w: 920, h: 920 })
    const shapeOf = (r: Rect): number => r.w / r.h
    const p2 = zoomOf(a!, 'P2').crop
    // In Picture 2's own shape, as the crop it already has.
    const wants = [a!, b!].map((c, i) => ({ clipId: c.id, crop: { ...square(1000 + 500 * i), h: Math.round(920 / shapeOf(p2)) } }))
    const out = setCropsOn(t, wants, 1)
    const [a2, b2] = v1Clips(out)
    expect(zoomOf(a2!, 'P2').crop.x).toBe(1000)
    expect(zoomOf(b2!, 'P2').crop.x).toBe(1500)
    expect(a2!.transform.crop).toEqual(a!.transform.crop)
  })

  it('leaves a clip without that picture as it is', () => {
    let t: Timeline = { ...createTimeline(30, { width: 1920, height: 1080 }, 'landscape'), media: [media('rec')] }
    t = addClip(t, 'rec')
    const c = v1Clips(t)[0]!
    expect(v1Clips(setCropsOn(t, [{ clipId: c.id, crop: CROP }], 1))[0]).toEqual(c)
  })
})
