import { describe, it, expect } from 'vitest'
import { LOOKS, alphaOfKey, cleanAdjust, cleanLook, cleanStrength, colourCanvas, colourFfmpeg, colourKey, colourMatrix, distanceOfKey, distanceTable, feColorMatrixValues, isKeyed, lookOf, matrixOfKey } from '../../src/shared/looks'
import { planRender, type RenderRequest } from '../../src/shared/render-plan'
import { joinProjectFile, splitProjectFile } from '../../src/shared/project-file'
import { defaultWorkspace } from '../../src/shared/workspace'
import { createProject, withTimeline, FIRST_SEQUENCE_ID } from '../../src/shared/project'
import { presetById } from '../../src/shared/presets'
import {
  addClip,
  addSource,
  addTrack,
  addTransition,
  applyLayout,
  createTimeline,
  findVideoClip,
  linkedIds,
  setClipOut,
  setColourAdjust,
  setLook,
  setLookStrength,
  setRemoveBackground,
  splitClip,
  v1Clips,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'

/**
 * Plan 35: a look on a clip, black and white first. Every look has a canvas
 * half and an ffmpeg half, and what is tested here is that the look reaches
 * every picture of its clip in both, and no picture of any other clip.
 */

function media(id: string, overrides: Partial<ProjectMedia> = {}): ProjectMedia {
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
    filmstripPath: '',
    ...overrides
  }
}

function oneClip(m = media('a')): Timeline {
  return addClip({ ...createTimeline(30, { width: 1080, height: 1920 }), media: [m] }, m.id, 'c')
}

function request(timeline: Timeline): RenderRequest {
  return {
    timeline,
    names: { project: 'p', sequence: 'Vertical', joined: 'p' },
    preset: presetById('vertical'),
    mode: 'join',
    outputDir: 'D:\out',
    scratchDir: 'D:\out\.scratch',
    filenamePattern: '{project}'
  }
}

const graphOf = (args: string[]): string => args[args.indexOf('-filter_complex') + 1] ?? ''
const graphs = (t: Timeline): string[] => planRender(request(t)).segments.map((s) => graphOf(s.args))
const count = (text: string, of: string): number => text.split(of).length - 1

describe('the list of looks', () => {
  it('starts with black and white, drawn the same way in both halves', () => {
    const mono = lookOf('mono')!
    expect(mono.name).toBe('Black and white')
    expect(colourCanvas(colourKey({ look: 'mono' }))).toBe('grayscale(1)')
    expect(colourFfmpeg(colourKey({ look: 'mono' }), 'R', 'V')).toEqual(['hue=s=0'])
  })

  it('has one id per look', () => {
    expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOKS.length)
  })

  it('knows no look for an id it does not have, so a stored one can be dropped', () => {
    expect(lookOf('lomo')).toBeNull()
    expect(cleanLook('lomo')).toBeUndefined()
    expect(cleanLook(4)).toBeUndefined()
    expect(cleanLook(undefined)).toBeUndefined()
    expect(cleanLook('mono')).toBe('mono')
  })
})

describe('putting a look on a clip', () => {
  it('puts it on the picture and takes it off again', () => {
    const t = setLook(oneClip(), 'c', 'mono')
    expect(findVideoClip(t, 'c')!.clip.look).toBe('mono')
    const back = setLook(t, 'c', null)
    expect('look' in findVideoClip(back, 'c')!.clip).toBe(false)
  })

  it('refuses a look the app does not have, leaving none', () => {
    const t = setLook(oneClip(), 'c', 'lomo')
    expect('look' in findVideoClip(t, 'c')!.clip).toBe(false)
  })

  it('leaves the linked sound alone, which has no picture to change', () => {
    const t = setLook(oneClip(), 'c', 'mono')
    const sounds = t.audioTracks.flatMap((r) => r.clips).filter((s) => linkedIds(t, 'c').includes(s.id))
    expect(sounds.length).toBeGreaterThan(0)
    for (const s of sounds) expect('look' in s).toBe(false)
  })

  it('is kept by both halves of a split', () => {
    const t = splitClip(setLook(oneClip(), 'c', 'mono'), 60)
    expect(v1Clips(t).map((c) => c.look)).toEqual(['mono', 'mono'])
  })
})

describe('the look in the export', () => {
  it('is written once at the head of a plain clip, before its crop', () => {
    const [graph] = graphs(setLook(oneClip(), 'c', 'mono'))
    expect(graph).toContain('fps=30:start_time=0,hue=s=0,crop=')
    expect(count(graph!, 'hue=s=0')).toBe(1)
  })

  it('is not written for a clip without one', () => {
    expect(graphs(oneClip()).join(';')).not.toContain('hue=')
  })

  it('reaches every picture of a clip with layers, being written before the split', () => {
    let t = oneClip(media('obs', { width: 3840, height: 1080 }))
    t = setLook(applyLayout(t, 'c', 'split'), 'c', 'mono')
    const [graph] = graphs(t)
    expect(graph).toContain('[0:v]fps=30:start_time=0,hue=s=0,split=2[s0][s1]')
  })

  it('is on the clip laid over and not on the one underneath', () => {
    let t = oneClip()
    t = addTrack({ ...t, media: [...t.media, media('b')] }, 'video', 'v2')
    t = addSource(t, { clipId: 'over', mediaId: 'b', at: 30, onTrack: 'v2', streams: [] })
    t = setClipOut(t, 'over', 60)
    t = setLook(t, 'over', 'mono')
    const withOverlay = graphs(t).find((g) => g.includes('overlay'))!
    // The overlay is input 2 onwards: the picture underneath and its sound come first.
    expect(withOverlay).toMatch(/\[\d+:v\]fps=30:start_time=0,hue=s=0,crop=/)
    expect(withOverlay).not.toMatch(/\[0:v\]fps=30:start_time=0,hue=s=0/)
    expect(count(withOverlay, 'hue=s=0')).toBe(1)
  })

  it('stays on its own side of a blend', () => {
    let t: Timeline = { ...createTimeline(30, { width: 1080, height: 1920 }), media: [media('a')] }
    t = addClip(t, 'a', 'first')
    t = setClipOut(t, 'first', 150)
    t = addClip(t, 'a', 'second')
    t = setLook(t, 'first', 'mono')
    t = addTransition(t, 'second', 'in', { kind: 'dissolve', length: 30 })
    const blend = graphs(t).find((g) => g.includes('xfade'))!
    // Only the outgoing side is black and white, going into the colour of the incoming one.
    expect(count(blend, 'hue=s=0')).toBe(1)
    expect(blend.indexOf('hue=s=0')).toBeLessThan(blend.indexOf('[xa]'))
  })
})

/** A colour as a pixel of 0 to 255 comes out of a matrix, clamped once at the end, as both halves do. */
function apply(m: ReturnType<typeof colourMatrix>, rgb: [number, number, number]): number[] {
  if (!m) return rgb
  const x = rgb.map((v) => v / 255)
  return m.map((row) => Math.round(Math.min(1, Math.max(0, row[0]! * x[0]! + row[1]! * x[1]! + row[2]! * x[2]! + row[3]!)) * 255))
}

describe("a clip's colour as one matrix (plan 85)", () => {
  it('is nothing for as recorded, a look at no strength, or sliders all at 0', () => {
    expect(colourMatrix({})).toBeNull()
    expect(colourMatrix({ look: 'sepia', lookStrength: 0 })).toBeNull()
    expect(colourMatrix({ adjust: { brightness: 0 } })).toBeNull()
  })

  it('makes black and white grey, and half way half grey', () => {
    expect(apply(colourMatrix({ look: 'mono' }), [255, 0, 0])).toEqual([54, 54, 54])
    expect(apply(colourMatrix({ look: 'mono', lookStrength: 50 }), [255, 0, 0])).toEqual([155, 27, 27])
  })

  it('gives every look a change, and leaves middle grey nearly grey for the ones that are not a tint', () => {
    for (const l of LOOKS) expect(apply(colourMatrix({ look: l.id }), [200, 120, 60])).not.toEqual([200, 120, 60])
    for (const id of ['mono', 'contrast', 'vivid', 'faded']) {
      const [r, g, b] = apply(colourMatrix({ look: id }), [128, 128, 128])
      expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeLessThanOrEqual(1)
    }
  })

  it('moves each slider the way it says', () => {
    const grey = (a: object): number[] => apply(colourMatrix({ adjust: a }), [100, 100, 100])
    expect(grey({ brightness: 100 })[0]).toBeGreaterThan(100)
    expect(grey({ brightness: -100 })[0]).toBeLessThan(100)
    expect(apply(colourMatrix({ adjust: { contrast: 100 } }), [200, 200, 200])[0]).toBeGreaterThan(200)
    expect(apply(colourMatrix({ adjust: { saturation: -100 } }), [255, 0, 0])).toEqual([54, 54, 54])
    const [r, , b] = apply(colourMatrix({ adjust: { warmth: 100 } }), [128, 128, 128])
    expect(r!).toBeGreaterThan(b!)
  })

  it('puts the sliders after the look, so black and white can be made brighter but not coloured', () => {
    const [r, g, b] = apply(colourMatrix({ look: 'mono', adjust: { brightness: 50 } }), [255, 0, 0])
    expect(r).toBe(g)
    expect(g).toBe(b)
    expect(r!).toBeGreaterThan(54)
  })

  it('codes black and white alone as plan 35 drew it, and anything else as its matrix', () => {
    expect(colourKey({})).toBeUndefined()
    expect(colourKey({ look: 'mono' })).toBe('mono')
    const key = colourKey({ look: 'mono', adjust: { warmth: 20 } })!
    expect(key.startsWith('m:')).toBe(true)
    expect(matrixOfKey(key)).not.toBeNull()
    expect(colourCanvas(key)).toMatch(/^url\(#editbay-colour-[0-9a-f]+\)$/)
    const [toRgb, format, mixer, toVideo] = colourFfmpeg(key, 'R', 'V')
    expect([toRgb, format, toVideo]).toEqual(['R', 'format=rgba', 'V'])
    expect(mixer).toMatch(/^colorchannelmixer=rr=[-\d.]+:rg=.*:ba=[-\d.]+:aa=1$/)
    expect(feColorMatrixValues(matrixOfKey(key)!).split('  ')).toHaveLength(4)
  })

  it('keeps stored strengths and sliders in range, and drops what does nothing', () => {
    expect(cleanStrength(100)).toBeUndefined()
    expect(cleanStrength(140)).toBeUndefined()
    expect(cleanStrength(-5)).toBe(0)
    expect(cleanStrength('x')).toBeUndefined()
    expect(cleanAdjust({ brightness: 0, contrast: 300, warmth: 'hot' })).toEqual({ contrast: 100 })
    expect(cleanAdjust({ brightness: 0 })).toBeUndefined()
  })
})

describe('the strength and the sliders on a clip (plan 85)', () => {
  it('sets a strength, and keeps it when the look changes but not when the look goes', () => {
    let t = setLookStrength(setLook(oneClip(), 'c', 'sepia'), 'c', 40)
    expect(findVideoClip(t, 'c')!.clip.lookStrength).toBe(40)
    t = setLook(t, 'c', 'mono')
    expect(findVideoClip(t, 'c')!.clip.lookStrength).toBe(40)
    t = setLook(t, 'c', null)
    expect('lookStrength' in findVideoClip(t, 'c')!.clip).toBe(false)
  })

  it('moves one slider leaving the others, and takes them away at 0', () => {
    let t = setColourAdjust(oneClip(), 'c', { warmth: 30 })
    t = setColourAdjust(t, 'c', { contrast: -20 })
    expect(findVideoClip(t, 'c')!.clip.adjust).toEqual({ warmth: 30, contrast: -20 })
    t = setColourAdjust(t, 'c', { warmth: 0, contrast: 0 })
    expect('adjust' in findVideoClip(t, 'c')!.clip).toBe(false)
  })

  it('writes the matrix at the head of the clip in the export, between the conversions to RGB and back', () => {
    const [graph] = graphs(setColourAdjust(setLook(oneClip(), 'c', 'sepia'), 'c', { warmth: 30 }))
    expect(graph).toMatch(/fps=30:start_time=0,scale=in_color_matrix=bt709:in_range=tv,format=rgba,colorchannelmixer=[^,]+,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,crop=/)
  })

  it('is saved and read back, and a stored value out of range is tidied rather than refused', () => {
    const t = setColourAdjust(setLookStrength(setLook(oneClip(), 'c', 'sepia'), 'c', 40), 'c', { warmth: 30 })
    const p = withTimeline({ ...createProject('p', 30, { width: 1080, height: 1920 }), media: t.media }, FIRST_SEQUENCE_ID, t)
    const back = splitProjectFile(joinProjectFile(p, defaultWorkspace())).project.sequences[0]!.videoTracks[0]!.clips[0]!
    expect([back.look, back.lookStrength, back.adjust]).toEqual(['sepia', 40, { warmth: 30 }])
    const text = joinProjectFile(p, defaultWorkspace()).replace('"lookStrength": 40', '"lookStrength": 400').replace('"warmth": 30', '"warmth": "hot"')
    const tidied = splitProjectFile(text).project.sequences[0]!.videoTracks[0]!.clips[0]!
    expect('lookStrength' in tidied).toBe(false)
    expect('adjust' in tidied).toBe(false)
  })
})

describe('a background taken out (plan 90)', () => {
  /** What a key's alpha row and doubling make of one colour, clamped as both halves clamp. */
  const alphaOf = (key: string, [r, g, b]: [number, number, number]): number => {
    const a = alphaOfKey(key)!
    const once = Math.min(1, Math.max(0, a.row[0]! * r + a.row[1]! * g + a.row[2]! * b + a.row[3]!))
    return Math.min(1, once * a.times)
  }

  it('rides in the colour code as an alpha row, with no look or with one', () => {
    const plain = colourKey({ removeBackground: { colour: 'green' } })!
    expect(plain).toMatch(/^m:1,0,0,0,0,1,0,0,0,0,1,0;a:/)
    expect(matrixOfKey(plain)).not.toBeNull()
    const sepia = colourKey({ look: 'sepia', removeBackground: { colour: 'blue', strength: 80 } })!
    expect(matrixOfKey(sepia)).toEqual(matrixOfKey(colourKey({ look: 'sepia' })!))
    expect(alphaOfKey(sepia)).not.toBeNull()
    // Black and white stays a matrix when it carries a key: `hue` would lose the alpha.
    expect(colourKey({ look: 'mono', removeBackground: { colour: 'black' } })).toMatch(/^m:/)
    expect(alphaOfKey(colourKey({ look: 'sepia' }))).toBeNull()
  })

  it('makes a screen clear and a subject opaque, for each colour', () => {
    const green = colourKey({ removeBackground: { colour: 'green' } })!
    expect(alphaOf(green, [0, 0.69, 0.25])).toBe(0)
    expect(alphaOf(green, [1, 1, 1])).toBe(1)
    expect(alphaOf(green, [0.9, 0.6, 0.5])).toBe(1)
    const blue = colourKey({ removeBackground: { colour: 'blue' } })!
    expect(alphaOf(blue, [0, 0.28, 0.73])).toBe(0)
    expect(alphaOf(blue, [0.9, 0.6, 0.5])).toBe(1)
    const black = colourKey({ removeBackground: { colour: 'black' } })!
    expect(alphaOf(black, [0, 0, 0])).toBe(0)
    expect(alphaOf(black, [1, 0.8, 0.2])).toBe(1)
  })

  it('takes out more as it is turned up', () => {
    const at = (strength: number): number => alphaOf(colourKey({ removeBackground: { colour: 'green', strength } })!, [0.4, 0.6, 0.3])
    expect(at(100)).toBeLessThan(at(50))
    expect(at(50)).toBeLessThan(at(0))
  })

  it('stays within what ffmpeg takes, and is written the same in both halves', () => {
    for (const colour of ['green', 'blue', 'black'] as const) {
      for (const strength of [0, 50, 100]) {
        const key = colourKey({ removeBackground: { colour, strength } })!
        const a = alphaOfKey(key)!
        expect(a.row.every((x) => Math.abs(x) <= 2)).toBe(true)
        const [, mixer, ...rest] = colourFfmpeg(key, 'R', 'V').slice(1)
        expect(mixer).toContain(`:ar=${a.row[0]}:ag=${a.row[1]}:ab=${a.row[2]}:aa=${a.row[3]}`)
        expect(rest.includes('colorchannelmixer=aa=2')).toBe(a.times === 2)
        expect(feColorMatrixValues(matrixOfKey(key)!, a.row).split('  ')[3]).toBe(`${a.row[0]} ${a.row[1]} ${a.row[2]} ${a.row[3]} 0`)
      }
    }
  })

  it('is flattened over black on V1, where nothing is under it', () => {
    const [graph] = graphs(setRemoveBackground(oneClip(), 'c', { colour: 'green' }))
    expect(graph).toMatch(/colorchannelmixer=aa=2,premultiply=inplace=1,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p/)
  })

  it('is set, changed and taken off, and its strength kept only when not the default', () => {
    let t = setRemoveBackground(oneClip(), 'c', { colour: 'green', strength: 50 })
    expect(findVideoClip(t, 'c')!.clip.removeBackground).toEqual({ colour: 'green' })
    t = setRemoveBackground(t, 'c', { colour: 'black', strength: 70 })
    expect(findVideoClip(t, 'c')!.clip.removeBackground).toEqual({ colour: 'black', strength: 70 })
    t = setRemoveBackground(t, 'c', null)
    expect('removeBackground' in findVideoClip(t, 'c')!.clip).toBe(false)
    expect(setRemoveBackground(oneClip(), 'c', { colour: 'pink' } as never)).toEqual(oneClip())
  })

  it('is saved and read back, and one that cannot be read is dropped', () => {
    const t = setRemoveBackground(oneClip(), 'c', { colour: 'blue', strength: 30 })
    const p = withTimeline({ ...createProject('p', 30, { width: 1080, height: 1920 }), media: t.media }, FIRST_SEQUENCE_ID, t)
    const text = joinProjectFile(p, defaultWorkspace())
    expect(splitProjectFile(text).project.sequences[0]!.videoTracks[0]!.clips[0]!.removeBackground).toEqual({ colour: 'blue', strength: 30 })
    const broken = splitProjectFile(text.replace('"colour": "blue"', '"colour": "pink"')).project.sequences[0]!.videoTracks[0]!.clips[0]!
    expect('removeBackground' in broken).toBe(false)
  })
})

describe('a plain background of any colour taken out (plan 98)', () => {
  const orange = { colour: 'plain' as const, rgb: [224, 112, 32] as const }
  /** What the key makes of one colour, 0 to 255 each, as the export's steps do. */
  const alphaOf = (key: string, [r, g, b]: [number, number, number]): number => {
    const d = distanceOfKey(key)!
    const far = (Math.abs(r - d.rgb[0]) + Math.abs(g - d.rgb[1]) + Math.abs(b - d.rgb[2])) / 3 / 255
    return Math.min(1, Math.max(0, (far - d.from) / d.width))
  }

  it('rides in the colour code as the colour and its ramp, with no look or with one', () => {
    const key = colourKey({ removeBackground: orange })!
    expect(key).toBe('m:1,0,0,0,0,1,0,0,0,0,1,0;d:224,112,32,0.12,0.1')
    expect(isKeyed(key)).toBe(true)
    expect(alphaOfKey(key)).toBeNull()
    const sepia = colourKey({ look: 'sepia', removeBackground: { ...orange, strength: 100 } })!
    expect(matrixOfKey(sepia)).toEqual(matrixOfKey(colourKey({ look: 'sepia' })!))
    expect(distanceOfKey(sepia)).toEqual({ rgb: [224, 112, 32], from: 0.2, width: 0.1 })
    expect(isKeyed(colourKey({ look: 'sepia' }))).toBe(false)
  })

  it('makes the colour and what is near it clear, and anything else opaque', () => {
    const key = colourKey({ removeBackground: orange })!
    expect(alphaOf(key, [224, 112, 32])).toBe(0)
    expect(alphaOf(key, [234, 104, 40])).toBe(0)
    expect(alphaOf(key, [255, 255, 255])).toBe(1)
    expect(alphaOf(key, [40, 90, 200])).toBe(1)
    const white = colourKey({ removeBackground: { colour: 'plain', rgb: [245, 245, 245] } })!
    expect(alphaOf(white, [250, 248, 240])).toBe(0)
    expect(alphaOf(white, [120, 90, 70])).toBe(1)
  })

  it('takes out more as it is turned up', () => {
    const at = (strength: number): number => alphaOf(colourKey({ removeBackground: { ...orange, strength } })!, [180, 150, 70])
    expect(at(100)).toBeLessThan(at(50))
    expect(at(50)).toBeLessThan(at(0))
  })

  it('is written for ffmpeg as the distance, its average into alpha, the ramp, and the picture coloured after', () => {
    const filters = colourFfmpeg(colourKey({ removeBackground: orange }), 'R', 'V', 'q')
    expect(filters[0]).toBe('R')
    expect(filters[2]).toBe(
      "split=3[kdqc][kdqd][kdqs];[kdqd]lutrgb=r='abs(val-224)':g='abs(val-112)':b='abs(val-32)'," +
        'colorchannelmixer=rr=0:gg=0:bb=0:ar=0.333333:ag=0.333333:ab=0.333333:aa=0,' +
        "lut=a='clip((val-30.6)*10,0,255)',alphaextract[kdqa];" +
        '[kdqs]alphaextract[kdqo];[kdqa][kdqo]blend=all_mode=multiply[kdqk];[kdqc][kdqk]alphamerge'
    )
    expect(filters[3]).toMatch(/^colorchannelmixer=rr=1:.*:aa=1$/)
    expect(filters.at(-1)).toBe('V')
    // Each channel's distance in the preview's table is exact at every level, as `lutrgb` is.
    expect(distanceTable(224).split(' ').map(Number)[200]).toBeCloseTo(24 / 255, 6)
  })

  it('is set, saved and read back, and one without a usable colour is dropped', () => {
    const t = setRemoveBackground(oneClip(), 'c', { colour: 'plain', rgb: [224.4, 112, 300], strength: 30 })
    expect(findVideoClip(t, 'c')!.clip.removeBackground).toEqual({ colour: 'plain', rgb: [224, 112, 255], strength: 30 })
    const p = withTimeline({ ...createProject('p', 30, { width: 1080, height: 1920 }), media: t.media }, FIRST_SEQUENCE_ID, t)
    const text = joinProjectFile(p, defaultWorkspace())
    expect(splitProjectFile(text).project.sequences[0]!.videoTracks[0]!.clips[0]!.removeBackground).toEqual({ colour: 'plain', rgb: [224, 112, 255], strength: 30 })
    expect(setRemoveBackground(oneClip(), 'c', { colour: 'plain' })).toEqual(oneClip())
  })

  it('keeps every clip of one graph apart, each by its own labels', () => {
    const [graph] = graphs(setRemoveBackground(oneClip(), 'c', orange))
    expect(graph).toMatch(/split=3\[kd\w*c\]/)
    expect(graph).toContain('alphamerge,colorchannelmixer=rr=1')
    // Flattened over black on V1, as the other keys are.
    expect(graph).toMatch(/:aa=1,premultiply=inplace=1,scale=out_color_matrix=bt709/)
  })
})

describe('a background taken out, kept off what has none (plan 90)', () => {
  it('leaves a text alone, even when asked as a piece of a group', () => {
    const words = media('w', { text: { words: 'Hi' } as never })
    const t = addClip({ ...createTimeline(30, { width: 1080, height: 1920 }), media: [words] }, 'w', 't')
    expect('removeBackground' in findVideoClip(setRemoveBackground(t, 't', { colour: 'black' }), 't')!.clip).toBe(false)
  })
})
