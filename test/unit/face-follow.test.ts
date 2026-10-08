import { describe, it, expect } from 'vitest'
import { followFaceKeys, trackFace, type FaceSample } from '../../src/shared/face-follow'
import { cropAtKeys, moves } from '../../src/shared/crop-geometry'
import type { Rect } from '../../src/shared/project'

/**
 * Follow face (plan 100): faces found on a 1920 x 1080 recording sampled five
 * times a second at 30 fps, turned into the keyframes of a 9:16 crop.
 */

const SIZE = { width: 1920, height: 1080 }
const CROP: Rect = { x: 656, y: 0, w: 608, h: 1080 }
const RATE = 5
const FPS = 30

const face = (cx: number, cy = 400, w = 120): Rect => ({ x: cx - w / 2, y: cy - w / 2, w, h: w })
/** One sample every sixth frame, for `sec` seconds, each with the faces `at` gives for its time. */
const samples = (sec: number, at: (t: number) => Rect[]): FaceSample[] =>
  Array.from({ length: sec * RATE }, (_, i) => ({ at: (i * FPS) / RATE, faces: at(i / RATE) }))
const keysFor = (s: FaceSample[], sec: number) =>
  followFaceKeys(s, CROP, SIZE, { sourceIn: 0, sourceOut: sec * FPS }, RATE, FPS)
const middleX = (r: Rect): number => r.x + r.w / 2

describe('followFaceKeys', () => {
  it('finds nothing to follow without a face', () => {
    expect(keysFor(samples(3, () => []), 3)).toBeNull()
  })

  it('a still face gives a crop on it that does not move', () => {
    const keys = keysFor(samples(4, () => [face(1500)]), 4)!
    expect(moves(keys)).toBe(false)
    expect(middleX(keys[0]!.crop)).toBeCloseTo(1500, 0)
    expect(keys[0]!.crop.w).toBe(CROP.w)
    expect(keys[keys.length - 1]!.at).toBe(4 * FPS - 1)
  })

  it('small shakes inside the middle third do not move the crop', () => {
    const keys = keysFor(samples(4, (t) => [face(960 + 60 * Math.sin(t * 7))]), 4)!
    expect(moves(keys)).toBe(false)
  })

  it('a face that walks across gives one eased pan that ends on it', () => {
    // From 300 to 1600 over the first three seconds, then still for two.
    const keys = keysFor(samples(5, (t) => [face(300 + Math.min(t, 3) * (1300 / 3))]), 5)!
    expect(moves(keys)).toBe(true)
    // Start, the pan's end, and the last frame: no keyframe on every sample.
    expect(keys.length).toBeLessThanOrEqual(4)
    const end = cropAtKeys(CROP, keys, 5 * FPS - 1)
    expect(Math.abs(middleX(end) - 1600)).toBeLessThan(CROP.w / 6)
  })

  it('a sudden step aside makes a pan of at least half a second, not a cut', () => {
    const keys = keysFor(samples(4, (t) => [face(t < 2 ? 400 : 560)]), 4)!
    const pans = keys.slice(1).filter((k, i) => k.crop.x !== keys[i]!.crop.x)
    expect(pans).toHaveLength(1)
    const start = keys[keys.indexOf(pans[0]!) - 1]!
    expect(pans[0]!.at - start.at).toBeGreaterThanOrEqual(FPS / 2)
  })

  it('a face lost for a second holds the crop where it was', () => {
    const keys = keysFor(samples(4, (t) => (t >= 1.5 && t < 2.5 ? [] : [face(700)])), 4)!
    expect(moves(keys)).toBe(false)
  })

  it('keeps the crop inside the recording when the face is at the edge', () => {
    const keys = keysFor(samples(2, () => [face(30, 30, 50)]), 2)!
    expect(keys[0]!.crop.x).toBe(0)
    expect(keys[0]!.crop.y).toBe(0)
  })
})

describe('trackFace', () => {
  it('follows the face the crop is on, not a bigger one beside it', () => {
    const s = samples(2, () => [face(960, 400, 100), face(200, 400, 300)])
    const track = trackFace(s, CROP, RATE)
    expect(track.every((r) => r !== null && middleX(r) === 960)).toBe(true)
  })

  it('does not jump to someone passing far away', () => {
    const s = samples(2, (t) => (t < 1 ? [face(960)] : [face(1700, 400, 200)]))
    const track = trackFace(s, CROP, RATE)
    expect(track.slice(RATE).every((r) => r === null)).toBe(true)
  })

  it('takes the largest face once the followed one has been gone a while', () => {
    const s = samples(4, (t) => (t < 1 ? [face(960)] : [face(1700, 400, 200)]))
    const track = trackFace(s, CROP, RATE)
    expect(middleX(track[track.length - 1]!)).toBe(1700)
  })
})
