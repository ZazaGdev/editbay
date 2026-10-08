import { describe, it, expect } from 'vitest'
import { drawPlan } from '../../../src/renderer/preview/compositor'
import {
  addClip,
  applyLayout,
  cleanPictureStyle,
  createTimeline,
  findVideoClip,
  setBlurFill,
  setPictureStyle,
  v1Clips,
  type ProjectMedia,
  type Timeline
} from '../../../src/shared/project'
import { blurSigma, shadowOf } from '../../../src/shared/picture-style'

/**
 * Plan 52: a picture in picture's corners, border and shadow, and a blurred
 * background, as stored and as the preview is told to draw them.
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

/** A recording on V1 laid out as a picture in picture. */
function pip(): { t: Timeline; id: string; layer: string } {
  let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a')] }
  t = addClip(t, 'a')
  const id = v1Clips(t)[0]!.id
  t = applyLayout(t, id, 'pip')
  return { t, id, layer: findVideoClip(t, id)!.clip.layers[0]!.id }
}

describe("a picture's frame", () => {
  it('is tidied: whole pixels within bounds, a real colour, and nothing that does nothing', () => {
    expect(cleanPictureStyle({ radius: 12.6, border: 500, borderColour: '#00FF00', shadow: true })).toEqual({
      radius: 13,
      border: 40,
      borderColour: '#00ff00',
      shadow: true
    })
    expect(cleanPictureStyle({ radius: 0, border: 0, shadow: false })).toBeUndefined()
    expect(cleanPictureStyle({ border: 4, borderColour: 'red' })).toEqual({ border: 4 })
    // A colour with no border to draw it on is not kept.
    expect(cleanPictureStyle({ radius: 4, borderColour: '#123456' })).toEqual({ radius: 4 })
    expect(cleanPictureStyle('round')).toBeUndefined()
  })

  it('goes on the picture named, and comes off with null', () => {
    const { t, id, layer } = pip()
    const styled = setPictureStyle(t, id, layer, { radius: 20, shadow: true })
    expect(findVideoClip(styled, id)!.clip.layers[0]!.style).toEqual({ radius: 20, shadow: true })
    expect(findVideoClip(setPictureStyle(styled, id, layer, null), id)!.clip.layers[0]!.style).toBeUndefined()
    expect(findVideoClip(setPictureStyle(t, id, 'main', { border: 6 }), id)!.clip.transform.style).toEqual({ border: 6 })
  })

  it("is drawn by the preview on a clip's second picture, in the export's numbers, and never on its main one on V1", () => {
    const { t, id, layer } = pip()
    const c = findVideoClip(setPictureStyle(setPictureStyle(t, id, layer, { radius: 20, border: 6, shadow: true }), id, 'main', { radius: 20 }), id)!.clip
    const plan = drawPlan(t, [{ pictures: [{ crop: c.transform.crop, place: c.transform.place, ...(c.transform.style ? { style: c.transform.style } : {}) }, ...c.layers] }], { width: 540, height: 960 })
    const [main, second] = plan.steps
    expect(main!.frame).toBeUndefined()
    const k = 540 / 1080
    const s = shadowOf(1080, 1920)
    expect(second!.frame).toEqual({ radius: 20 * k, border: 6 * k, colour: '#ffffff', shadow: { sigma: s.sigma * k, dy: s.dy * k, alpha: 0.5 } })
    expect(second!.box).toBeDefined()
  })
})

describe('a blurred background', () => {
  it('is on or absent', () => {
    const { t, id } = pip()
    expect(findVideoClip(setBlurFill(t, id, true), id)!.clip.blurFill).toBe(true)
    expect('blurFill' in findVideoClip(setBlurFill(setBlurFill(t, id, true), id, false), id)!.clip).toBe(false)
  })

  it('is drawn behind every picture of the clip, blurred by the same amount as the export', () => {
    const { t, id } = pip()
    const c = findVideoClip(t, id)!.clip
    const plan = drawPlan(t, [{ pictures: [{ crop: c.transform.crop, place: c.transform.place }, ...c.layers], blurFill: true }], { width: 540, height: 960 })
    expect(plan.steps.map((s) => s.blur)).toEqual([blurSigma(1080, 1920) / 2, blurSigma(1080, 1920) / 2])
  })
})

describe('a framed, blurred picture in picture through a blend', () => {
  it('keeps its frame and its blurred bars in the export for the length of the blend', async () => {
    const { addSource, addTrack, addTransition, setPlace } = await import('../../../src/shared/project')
    const { planRender } = await import('../../../src/shared/render-plan')
    const { presetById } = await import('../../../src/shared/presets')
    let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a'), media('b')] }
    t = addClip(t, 'a')
    t = addTrack(t, 'video', 'v2')
    t = addSource(t, { mediaId: 'b', clipId: 'p', at: 0, onTrack: 'v2', streams: [] })
    t = addSource(t, { mediaId: 'b', clipId: 'q', at: 150, onTrack: 'v2', streams: [] })
    for (const id of ['p', 'q']) {
      t = setPlace(t, id, 'main', { x: 0.5, y: 0.05, w: 0.4, h: 0.1265625 }, false)
      t = setPictureStyle(t, id, 'main', { radius: 30, border: 8, shadow: true })
      t = setBlurFill(t, id, true)
    }
    t = addTransition(t, 'q', 'in', { kind: 'dissolve', length: 30 })
    const plan = planRender({
      timeline: t,
      names: { project: 'p', sequence: 's', joined: 'p' },
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: 'D:\out',
      scratchDir: 'D:\out\.s',
      filenamePattern: '{project}'
    })
    const blend = plan.segments.map((s) => s.args[s.args.indexOf('-filter_complex') + 1]!).find((g) => g.includes('xfade'))!
    // Both sides framed and blurred: two rounded boxes, two borders, two shadows, two blurred backgrounds.
    expect(blend.match(/gblur=sigma=\d+\[bg/g)).toHaveLength(2)
    expect(blend.match(/\[bd/g)!.length).toBeGreaterThanOrEqual(2)
    expect(blend.match(/\[sd/g)!.length).toBeGreaterThanOrEqual(2)
  })
})

describe('which main pictures the preview frames', () => {
  const styled = { crop: { x: 0, y: 0, w: 1920, h: 1080 }, place: { x: 0, y: 0, w: 1, h: 1 }, style: { border: 10 } }
  const t = (): Timeline => ({ ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a')] })

  it('frames one on a track over another, full frame or not, as the export does', () => {
    const plan = drawPlan(t(), [{ pictures: [styled] }, { pictures: [styled], over: true }], { width: 540, height: 960 })
    expect(plan.steps[0]!.frame).toBeUndefined()
    expect(plan.steps[1]!.frame).toBeDefined()
  })

  it('does not frame the second side of a blend on the lowest track, which the export does not frame either', () => {
    const plan = drawPlan(t(), [{ pictures: [styled] }, { pictures: [styled], over: false }], { width: 540, height: 960 })
    expect(plan.steps[1]!.frame).toBeUndefined()
  })
})
