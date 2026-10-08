import { describe, it, expect } from 'vitest'
import {
  addClip,
  applyLayout,
  createProject,
  createTimeline,
  findVideoClip,
  setPlace,
  setShape,
  setSimpleZoom,
  setZoomKeys,
  settleZoomKeys,
  splitClip,
  startEndOf,
  swapPictures,
  timelineOf,
  v1Clips,
  withTimeline,
  zoomOf,
  type Clip,
  type Layer,
  type ProjectMedia,
  type Rect,
  type Timeline
} from '../../src/shared/project'
import { cropAtKeys } from '../../src/shared/crop-geometry'
import { applyEditTo } from '../../src/main/project/session'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { S1 } from '../project-helpers'

/** Plan 73: every picture of a clip has a zoom of its own, not only the main one. */

function media(id: string): ProjectMedia {
  return {
    id,
    originalPath: `C:\\v\\${id}.mp4`,
    playablePath: `C:\\v\\${id}.mp4`,
    conformed: false,
    conformReasons: [],
    durationSec: 10,
    width: 3840,
    height: 1080,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: '',
    filmstripPath: ''
  }
}

/** A ten second side by side recording on V1 of a vertical sequence, laid out as Split, as `c`. */
function split(): Timeline {
  const t = createTimeline(30, { width: 1080, height: 1920 })
  return applyLayout(addClip({ ...t, media: [media('a')] }, 'a', 'c'), 'c', 'split')
}

const clip = (t: Timeline): Clip => findVideoClip(t, 'c')!.clip
const layerOf = (t: Timeline): Layer => clip(t).layers[0]!
/** Ten per cent in on a crop, around its middle, in even pixels. */
function closerThan(r: Rect): Rect {
  const w = Math.round((r.w * 0.9) / 2) * 2
  const h = Math.round((r.h * 0.9) / 2) * 2
  return { x: Math.round((r.x + (r.w - w) / 2) / 2) * 2, y: Math.round((r.y + (r.h - h) / 2) / 2) * 2, w, h }
}

/** `c` with its second picture zooming in from its Start across the whole clip, Simple. */
function zooming(): Timeline {
  const t = split()
  return setSimpleZoom(t, 'c', { end: closerThan(layerOf(t).crop) }, layerOf(t).id)
}

describe("a further picture's zoom", () => {
  it('is its own: the second picture zooms, and the main one stays as it was', () => {
    const before = clip(split())
    const t = zooming()
    const c = clip(t)
    const layer = layerOf(t)
    expect(layer.simple).toBe('smooth')
    expect(startEndOf(c, layer.id).start).toEqual(before.layers[0]!.crop)
    expect(cropAtKeys(layer.crop, layer.keys, 299).w).toBeLessThan(layer.crop.w)
    expect(c.transform).toEqual(before.transform)
  })

  it('is left alone by an edit to the main picture', () => {
    const t = zooming()
    const main = clip(t).transform.crop
    const after = setSimpleZoom(t, 'c', { end: closerThan(main) })
    expect(layerOf(after)).toEqual(layerOf(t))
    expect(clip(after).transform.simple).toBe('smooth')
  })

  it('is kept on both halves of a split, each settled on its own frames', () => {
    const t0 = split()
    const l0 = layerOf(t0)
    const t = setZoomKeys(t0, 'c', [
      { at: 30, crop: l0.crop },
      { at: 240, crop: closerThan(l0.crop) }
    ], l0.id)
    // Settled after the cut, as every edit is.
    const [a, b] = v1Clips(settleZoomKeys(splitClip(t, 150, 'c')))
    expect(a!.layers[0]!.keys?.length).toBeGreaterThan(0)
    expect(b!.layers[0]!.keys?.length).toBeGreaterThan(0)
    // Each half's crop is the zoom's picture on its own first frame.
    const first = layerOf(t)
    expect(b!.layers[0]!.crop).toEqual(cropAtKeys(first.crop, first.keys, b!.sourceIn))
  })

  it('follows its picture when the place is reshaped, the pictures are swapped or the shape changes', () => {
    const t = zooming()
    const id = layerOf(t).id
    const settled = (x: Timeline): boolean => {
      const l = layerOf(x)
      return l.keys !== undefined && l.keys.length > 0 && JSON.stringify(l.keys[0]!.crop) === JSON.stringify(l.crop)
    }
    const reshaped = setPlace(t, 'c', id, { x: 0.1, y: 0.55, w: 0.8, h: 0.4 }, true)
    expect(settled(reshaped)).toBe(true)
    expect(layerOf(reshaped).simple).toBe('smooth')
    expect(settled(swapPictures(t, 'c'))).toBe(true)
    expect(settled(setShape(t, 'landscape'))).toBe(true)
  })

  it('is edited through the session with the picture named', () => {
    const t = split()
    const p = withTimeline({ ...createProject('p', 30, { width: 1080, height: 1920 }), media: [media('a')] }, S1, t)
    const id = layerOf(t).id
    const after = applyEditTo(p, { kind: 'setSimpleZoom', sequenceId: S1, clipId: 'c', change: { end: closerThan(layerOf(t).crop) }, picture: id })
    const c = v1Clips(timelineOf(after, S1))[0]!
    expect(zoomOf(c, id).simple).toBe('smooth')
    expect(zoomOf(c).simple).toBeUndefined()
  })

  it('is saved and opened again with the project', () => {
    const t = zooming()
    const p = withTimeline({ ...createProject('p', 30, { width: 1080, height: 1920 }), media: t.media }, S1, t)
    const back = splitProjectFile(joinProjectFile(p, defaultWorkspace())).project
    expect(v1Clips(timelineOf(back, S1))[0]!.layers[0]).toEqual(v1Clips(timelineOf(p, S1))[0]!.layers[0])
  })

  it('refuses a file whose further picture holds damaged keyframes, rather than dropping them', () => {
    const t = zooming()
    const p = withTimeline({ ...createProject('p', 30, { width: 1080, height: 1920 }), media: t.media }, S1, t)
    const text = joinProjectFile(p, defaultWorkspace()).replace('"keys": [', '"keys": "broken", "was": [')
    expect(() => splitProjectFile(text)).toThrow()
  })
})

describe('the zoom marked on the timeline, with more than one picture (bugs and notes 2, note 15)', () => {
  it("is the chosen picture's, or the one that moves when the main one does not", async () => {
    const { timelineZoom } = await import('../../src/shared/zoom-edit')
    const t = zooming()
    const c = clip(t)
    const id = layerOf(t).id
    expect(timelineZoom(c, id)).toEqual({ picture: id, frames: [c.sourceIn, c.sourceOut - 1], simple: true })
    // Nothing chosen, or the main one chosen and still: the picture that moves.
    expect(timelineZoom(c)?.picture).toBe(id)
    expect(timelineZoom(c, 'main')?.picture).toBe(id)
    expect(timelineZoom(clip(split()))).toBeNull()
  })
})
