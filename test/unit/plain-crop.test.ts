import { describe, it, expect } from 'vitest'
import { addClip, createTimeline, findVideoClip, setSimpleZoom, setZoomKeys, startEndOf, type Clip, type ProjectMedia, type Rect, type Timeline } from '../../src/shared/project'
import { cropEdit } from '../../src/shared/zoom-edit'
import { applyClipEdit } from '../../src/main/project/session'

/**
 * Task 122: a crop made while the zoom is not being worked on, nothing picked
 * in the Zoom panel, is only a crop. It never adds keyframes or starts a zoom;
 * a clip that already zooms has its whole zoom moved and scaled with the crop.
 */

function media(id: string): ProjectMedia {
  return {
    id,
    originalPath: `C:\v\${id}.mp4`,
    playablePath: `C:\v\${id}.mp4`,
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

/** A ten second recording on V1 of a sequence its shape, from frame 0. */
function one(): Timeline {
  const t = createTimeline(30, { width: 1920, height: 1080 })
  return addClip({ ...t, media: [media('a')] }, 'a', 'c')
}

const clip = (t: Timeline): Clip => findVideoClip(t, 'c')!.clip
const FULL: Rect = { x: 0, y: 0, w: 1920, h: 1080 }
const CLOSER: Rect = { x: 480, y: 270, w: 960, h: 540 }
const CROPPED: Rect = { x: 240, y: 134, w: 1440, h: 810 }

/** A plain crop, as the crop box, the Crop numbers or the nudge keys send it with nothing picked. */
const plainCrop = (t: Timeline, playhead: number, end = false): Timeline => applyClipEdit(t, cropEdit(clip(t), playhead, CROPPED, undefined, end, false))

describe('a crop with nothing picked in the Zoom panel', () => {
  it('only crops a clip with no zoom, even with End chosen before', () => {
    const out = clip(plainCrop(one(), 150, true))
    expect(out.transform.crop).toEqual(CROPPED)
    expect(out.transform.keys ?? []).toHaveLength(0)
    expect(out.transform.simple).toBeUndefined()
  })

  it('moves and scales a Simple zoom with the crop, keeping it a Simple zoom and adding no keyframe', () => {
    const t = setSimpleZoom(one(), 'c', { start: FULL, end: CLOSER, ease: 'smooth' })
    const before = clip(t)
    const out = clip(plainCrop(t, 150))
    expect(out.transform.simple).toBe(before.transform.simple)
    expect(out.transform.keys).toHaveLength(before.transform.keys!.length)
    const { start, end } = startEndOf(out)
    expect(start).toEqual(CROPPED)
    // Three quarters of the way in, around the same middle: still zooming in as close again.
    expect(end.h).toBeCloseTo(CLOSER.h * 0.75, -1)
    expect(end.x + end.w / 2).toBeCloseTo(CROPPED.x + CROPPED.w / 2, -1)
  })

  it('moves and scales keyframes put by hand with the crop, adding none at the playhead', () => {
    const t = setZoomKeys(one(), 'c', [
      { at: 0, crop: FULL },
      { at: 100, crop: CLOSER }
    ])
    const out = clip(plainCrop(t, 0))
    expect(out.transform.keys!.map((k) => k.at)).toEqual([0, 100])
    expect(out.transform.keys![0]!.crop).toEqual(CROPPED)
    expect(out.transform.keys![1]!.crop.h).toBeCloseTo(CLOSER.h * 0.75, -1)
  })
})

describe('a crop with the zoom being worked on', () => {
  it('puts a keyframe at the playhead, as before', () => {
    const t = setZoomKeys(one(), 'c', [
      { at: 0, crop: FULL },
      { at: 100, crop: CLOSER }
    ])
    const out = clip(applyClipEdit(t, cropEdit(clip(t), 50, CROPPED)))
    expect(out.transform.keys!.map((k) => k.at)).toEqual([0, 50, 100])
  })

  it('makes a still clip zoom when its End is chosen, as before', () => {
    const out = clip(applyClipEdit(one(), cropEdit(clip(one()), 299, CROPPED, undefined, true)))
    expect(out.transform.simple).toBeDefined()
  })
})
