import { describe, it, expect } from 'vitest'
import {
  addClip,
  applyLayout,
  createTimeline,
  cropOf,
  setCrop,
  setCropOn,
  v1Clips,
  type Clip,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'

/**
 * A crop copied on its own and pasted onto other clips: only the crop
 * changes, as the same share of each recording, and a text is left alone.
 */

function media(id: string, w: number, h: number, extra: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id,
    originalPath: `C:\v\${id}.mkv`,
    playablePath: `C:\v\${id}.mkv`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    width: w,
    height: h,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: '',
    ...extra
  }
}

function threeClips(): Timeline {
  const t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }, 'vertical'),
    media: [media('a', 1920, 1080), media('b', 1920, 1080), media('big', 3840, 2160)]
  }
  return addClip(addClip(addClip(t, 'a'), 'b'), 'big')
}

function clip(t: Timeline, i: number): Clip {
  return v1Clips(t)[i]!
}

describe('copying a crop', () => {
  it('takes the crop shown and the size of the recording it was drawn on', () => {
    let t = threeClips()
    t = setCrop(t, clip(t, 0).id, { x: 100, y: 40, w: 600, h: 800 })
    expect(cropOf(t, clip(t, 0).id)).toEqual({ crop: { x: 100, y: 40, w: 600, h: 800 }, width: 1920, height: 1080 })
  })

  it('is nothing for a clip that is not there', () => {
    expect(cropOf(threeClips(), 'gone')).toBeNull()
  })
})

describe('pasting a crop', () => {
  it('gives every clip named the crop, as the same share of its recording, and changes nothing else', () => {
    let t = threeClips()
    t = setCrop(t, clip(t, 0).id, { x: 100, y: 40, w: 600, h: 800 })
    t = applyLayout(t, clip(t, 1).id, 'split')
    const before = clip(t, 1)
    const copied = cropOf(t, clip(t, 0).id)!
    t = setCropOn(t, [clip(t, 1).id, clip(t, 2).id], copied)
    expect(clip(t, 1).transform.crop).toEqual({ x: 100, y: 40, w: 600, h: 800 })
    // Twice the size, so twice the pixels: the same part of the picture.
    expect(clip(t, 2).transform.crop).toEqual({ x: 200, y: 80, w: 1200, h: 1600 })
    // Place, layers and layout stay the target's own.
    expect(clip(t, 1).transform.place).toEqual(before.transform.place)
    expect(clip(t, 1).layers).toEqual(before.layers)
    expect(clip(t, 1).layout).toBe(before.layout)
  })

  it('keeps a pasted crop inside a recording it would run off', () => {
    let t = threeClips()
    const copied = { crop: { x: 1800, y: 0, w: 400, h: 1080 }, width: 2200, height: 1080 }
    t = setCropOn(t, [clip(t, 0).id], copied)
    const c = clip(t, 0).transform.crop
    expect(c.x + c.w).toBeLessThanOrEqual(1920)
  })

  it('leaves a text alone, which has nothing to crop', () => {
    let t: Timeline = {
      ...createTimeline(30, { width: 1080, height: 1920 }, 'vertical'),
      media: [media('words', 1080, 1920, { text: { text: 'Hi' } as NonNullable<ProjectMedia['text']> })]
    }
    t = addClip(t, 'words')
    const before = clip(t, 0).transform.crop
    t = setCropOn(t, [clip(t, 0).id], { crop: { x: 0, y: 0, w: 200, h: 200 }, width: 1080, height: 1920 })
    expect(clip(t, 0).transform.crop).toEqual(before)
    expect(cropOf(t, clip(t, 0).id)).toBeNull()
  })
})
