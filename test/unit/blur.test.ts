import { describe, it, expect } from 'vitest'
import { blurFfmpeg, blurRegions, blurSigma, boxFromPixels, boxInPixels, cleanBox, cleanBoxes, MOST_BOXES, newBox } from '../../src/shared/blur'
import { addClip, addSource, addTrack, createProject, createTimeline, findVideoClip, setBlur, setBlurBoxes, withTimeline, FIRST_SEQUENCE_ID, type ProjectMedia, type Timeline } from '../../src/shared/project'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { planRender } from '../../src/shared/render-plan'
import { presetById } from '../../src/shared/presets'

/** Plan 85: blur on the whole picture or in boxes on the recording. */

function media(id: string): ProjectMedia {
  return {
    id, originalPath: `C:/v/${id}.mp4`, playablePath: `C:/v/${id}.mp4`, conformed: false, conformReasons: [],
    durationSec: 4, width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true, peaksPath: '', filmstripPath: ''
  }
}

function oneClip(): Timeline {
  return addClip({ ...createTimeline(30, { width: 1920, height: 1080 }), media: [media('a'), media('b')] }, 'a', 'c')
}

const graphs = (t: Timeline): string[] =>
  planRender({
    timeline: t,
    names: { project: 'p', joined: 'p', clip: () => 'c' } as never,
    preset: presetById('landscape'),
    mode: 'join',
    outputDir: 'C:/out',
    scratchDir: 'C:/s',
    filenamePattern: '{project}'
  }).segments.map((s) => s.args[s.args.indexOf('-filter_complex') + 1] ?? '')

describe('a blurred box', () => {
  it('is kept inside the frame and at least a hundredth of it, and dropped when damaged', () => {
    expect(cleanBox({ x: 0.9, y: -1, w: 0.5, h: 0, amount: 300 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.01, amount: 100 })
    expect(cleanBox({ x: 0.1, y: 0.1, w: 0.1, h: 0.1, amount: 0 })).toBeNull()
    expect(cleanBox('box')).toBeNull()
    expect(cleanBoxes(Array.from({ length: MOST_BOXES + 3 }, () => newBox()))).toHaveLength(MOST_BOXES)
    expect(cleanBoxes([])).toBeUndefined()
  })

  it('is placed on even pixels of the recording, and read back as the same shares', () => {
    const r = boxInPixels({ x: 0.1, y: 0.2, w: 0.3, h: 0.25 }, 1920, 1080)
    expect(r).toEqual({ x: 192, y: 216, w: 576, h: 270 })
    expect(boxFromPixels(r, 1920, 1080, 40)).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.25, amount: 40 })
  })

  it('is blurred more for more, by a share of the recording\'s height', () => {
    expect(blurSigma(100, 1080)).toBeCloseTo(27)
    expect(blurSigma(50, 2160)).toBeCloseTo(27)
    expect(blurRegions({ blur: 20, blurBoxes: [newBox()] }, 1920, 1080).map((r) => r.rect)).toEqual([
      { x: 0, y: 0, w: 1920, h: 1080 },
      boxInPixels(newBox(), 1920, 1080)
    ])
  })

  it('is cut from the picture with a margin, blurred, cut to the box and laid back where it was', () => {
    const [f] = blurFfmpeg({ blurBoxes: [{ x: 0.5, y: 0.5, w: 0.25, h: 0.25, amount: 40 }] }, 1920, 1080, 't')
    expect(f).toBe(
      'split=2[bxta0][bxtk0];[bxtk0]crop=548:338:926:506,format=yuv444p,gblur=sigma=10.80,crop=480:270:34:34,format=yuv420p[bxtz0];[bxta0][bxtz0]overlay=960:540'
    )
  })
})

describe('blur on a clip', () => {
  it('is set and taken away, the whole picture and the boxes apart', () => {
    let t = setBlur(oneClip(), 'c', 30)
    t = setBlurBoxes(t, 'c', [newBox()])
    expect(findVideoClip(t, 'c')!.clip.blur).toBe(30)
    expect(findVideoClip(t, 'c')!.clip.blurBoxes).toHaveLength(1)
    t = setBlur(setBlurBoxes(t, 'c', []), 'c', null)
    expect('blur' in findVideoClip(t, 'c')!.clip).toBe(false)
    expect('blurBoxes' in findVideoClip(t, 'c')!.clip).toBe(false)
  })

  it('is saved and read back', () => {
    const t = setBlurBoxes(setBlur(oneClip(), 'c', 30), 'c', [newBox()])
    const p = withTimeline({ ...createProject('p', 30, { width: 1920, height: 1080 }), media: t.media }, FIRST_SEQUENCE_ID, t)
    const back = splitProjectFile(joinProjectFile(p, defaultWorkspace())).project.sequences[0]!.videoTracks[0]!.clips[0]!
    expect([back.blur, back.blurBoxes]).toEqual([30, [cleanBox(newBox())]])
  })

  it('is written at the head of the clip in the export, before its crop', () => {
    const [graph] = graphs(setBlurBoxes(setBlur(oneClip(), 'c', 30), 'c', [newBox()]))
    expect(graph).toMatch(/fps=30:start_time=0,setparams=colorspace=bt709,format=yuv444p,gblur=sigma=8\.10,format=yuv420p,split=2\[bxv\w*a0\]/)
    // The boxes are laid back before the clip's own crop, so they follow the footage.
    expect(graph).toMatch(/overlay=\d+:\d+,crop=/)
  })

  it('is written on a clip laid over another, with labels of its own', () => {
    let t = oneClip()
    t = addTrack(t, 'video', 'v2')
    t = addSource(t, { clipId: 'over', mediaId: 'b', at: 0, onTrack: 'v2', streams: [] })
    t = setBlurBoxes(t, 'over', [newBox(), { ...newBox(), x: 0 }])
    const graph = graphs(t).find((g) => g.includes('overlay='))!
    expect(graph.match(/gblur/g)).toHaveLength(2)
    expect(new Set(graph.match(/\[bx\w+\]/g)).size).toBe(6)
  })
})
