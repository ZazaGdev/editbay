import { describe, it, expect } from 'vitest'
import { backgroundOfEdges, effectPlacement, plainOfEdges } from '../../src/shared/effects'
import { addClip, addTrack, createTimeline, type ProjectMedia, type Timeline } from '../../src/shared/project'

/** Plan 90: telling an effect's background from a small frame of it, and where an effect goes over a clip. */

const SIDE = 16

/** A square RGBA frame: `edge` round its border, `middle` inside. */
function frame(edge: [number, number, number, number], middle: [number, number, number, number] = [255, 255, 255, 255]): Uint8Array {
  const px = new Uint8Array(SIDE * SIDE * 4)
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const onEdge = x === 0 || y === 0 || x === SIDE - 1 || y === SIDE - 1
      px.set(onEdge ? edge : middle, (y * SIDE + x) * 4)
    }
  }
  return px
}

describe("an effect's background", () => {
  it('is green, blue or black when its edge is', () => {
    expect(backgroundOfEdges(frame([0, 177, 64, 255]), SIDE)).toBe('green')
    expect(backgroundOfEdges(frame([0, 71, 187, 255]), SIDE)).toBe('blue')
    expect(backgroundOfEdges(frame([4, 4, 6, 255]), SIDE)).toBe('black')
  })

  it('is none for ordinary footage, a picture clear round its edge, or a mixed edge', () => {
    expect(backgroundOfEdges(frame([120, 110, 90, 255]), SIDE)).toBeNull()
    expect(backgroundOfEdges(frame([0, 0, 0, 0]), SIDE)).toBeNull()
    const mixed = frame([0, 177, 64, 255])
    // A third of the top edge something else: not a screen.
    for (let x = 0; x < SIDE; x++) mixed.set([200, 50, 50, 255], x * 4)
    for (let y = 0; y < SIDE; y++) mixed.set([200, 50, 50, 255], (y * SIDE) * 4)
    expect(backgroundOfEdges(mixed, SIDE)).toBeNull()
  })

  it('is any plain colour its edge nearly all is, a little noise and all (plan 98)', () => {
    expect(plainOfEdges(frame([224, 112, 32, 255]), SIDE)).toEqual([224, 112, 32])
    expect(plainOfEdges(frame([240, 240, 236, 255]), SIDE)).toEqual([240, 240, 236])
    const noisy = frame([128, 128, 128, 255])
    for (let x = 0; x < SIDE; x += 2) noisy.set([136, 122, 130, 255], x * 4)
    expect(plainOfEdges(noisy, SIDE)).toEqual([128, 128, 128])
  })

  it('is no plain colour for a busy or clear edge (plan 98)', () => {
    const busy = frame([128, 128, 128, 255])
    for (let x = 0; x < SIDE; x++) busy.set([200, 50, 50, 255], x * 4)
    for (let y = 0; y < SIDE; y++) busy.set([200, 50, 50, 255], (y * SIDE) * 4)
    expect(plainOfEdges(busy, SIDE)).toBeNull()
    expect(plainOfEdges(frame([0, 0, 0, 0]), SIDE)).toBeNull()
  })
})

function media(id: string, overrides: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id, originalPath: `C:\v\${id}.mp4`, playablePath: `C:\v\${id}.mp4`, conformed: false, conformReasons: [],
    durationSec: 10, fps: 30, width: 1920, height: 1080, hasAudio: true, filmstripPath: '', ...overrides
  } as ProjectMedia
}

describe('where an effect goes over a clip', () => {
  const base = (): Timeline => addClip({ ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a')] }, 'a', 'c')

  it('starts where the clip starts, a picture on the track above, made when there is none', () => {
    let n = 0
    const placed = effectPlacement(base(), 'c', true, () => `new-${++n}`)
    expect(placed).toEqual({ at: 0, onTrack: 'new-1', newTrack: 'video' })
    const two = addTrack(base(), 'video', 'V2')
    expect(effectPlacement(two, 'c', true, () => 'x')).toEqual({ at: 0, onTrack: 'V2' })
  })

  it('leaves a sound to find a free sound track', () => {
    expect(effectPlacement(base(), 'c', false, () => 'x')).toEqual({ at: 0 })
  })

  it('is nowhere for a clip that is gone', () => {
    expect(effectPlacement(base(), 'gone', true, () => 'x')).toBeNull()
  })
})
