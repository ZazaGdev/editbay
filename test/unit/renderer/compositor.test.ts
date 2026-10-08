import { coverBox } from '../../../src/renderer/components/Guides'
import { describe, it, expect } from 'vitest'
import { drawCaption, drawOnto, drawOutput, drawPlan, mixFor, type DrawnClip, type DrawPlan } from '../../../src/renderer/preview/compositor'
import { addClip, createTimeline, setCaptions, v1Clips, type ProjectMedia, type Timeline } from '../../../src/shared/project'
import { layoutCaption } from '../../../src/shared/captions'
import { FULL_PLACE } from '../../../src/shared/layout'

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

function timeline(presetId = 'vertical'): Timeline {
  const t = createTimeline(30, { width: 1080, height: 1920 }, presetId)
  return addClip({ ...t, media: [media('a')] }, 'a')
}

const corner = { crop: { x: 0, y: 0, w: 1920, h: 1080 }, place: { x: 0.6, y: 0.05, w: 0.35, h: 0.1 } }
const box = { width: 540, height: 960 }

/** Just enough of a 2D context to see what was drawn from which source. */
function fakeContext(): { ctx: CanvasRenderingContext2D; drawn: unknown[] } {
  const drawn: unknown[] = []
  const ctx = {
    canvas: { width: 540, height: 960 },
    fillStyle: '',
    imageSmoothingQuality: 'low',
    setTransform: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    rect: () => undefined,
    clip: () => undefined,
    fillRect: () => undefined,
    drawImage: (source: unknown) => drawn.push(source)
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn }
}

describe('the Output view with nothing on V1', () => {
  it('draws a picture on a higher track in the frame, past V1\'s end', () => {
    const plan = drawPlan(timeline(), [{ pictures: [corner] }], box)
    expect(plan.frame).toEqual({ x: 0, y: 0, w: 540, h: 960 })
    // It is the lowest clip there, so it is the first source.
    expect(plan.steps.map((s) => s.source)).toEqual([0])
  })

  it('has nothing to draw under Handoff, which takes its frame from V1\'s clip', () => {
    // The preview hands Handoff V1's clip alone, and V1 has none here.
    expect(drawPlan(timeline('handoff'), [], box).steps).toEqual([])
  })

  it('draws V1 first, then the tracks above it, when V1 has a clip there', () => {
    const t = timeline()
    const v1: DrawnClip = { pictures: [{ crop: v1Clips(t)[0]!.transform.crop, place: FULL_PLACE }] }
    const plan = drawPlan(t, [v1, { pictures: [{ crop: corner.crop, place: FULL_PLACE }] }], box)
    expect(plan.steps.map((s) => s.source)).toEqual([0, 1])
  })
})

describe('the Output view with a clip on several tracks', () => {
  it('draws every picture of each clip, the lowest clip first and each higher one over it', () => {
    const t = timeline()
    const lowest: DrawnClip = {
      pictures: [
        { crop: { x: 0, y: 0, w: 960, h: 1080 }, place: { x: 0, y: 0, w: 1, h: 0.5 } },
        { crop: { x: 960, y: 0, w: 960, h: 1080 }, place: { x: 0, y: 0.5, w: 1, h: 0.5 } }
      ]
    }
    const plan = drawPlan(t, [lowest, { pictures: [corner] }, { pictures: [{ crop: corner.crop, place: FULL_PLACE }] }], box)
    expect(plan.steps.map((s) => s.source)).toEqual([0, 0, 1, 2])
    expect(plan.steps.map((s) => s.from)).toEqual([lowest.pictures[0]!.crop, lowest.pictures[1]!.crop, corner.crop, corner.crop])
    // The lowest clip's two pictures in their halves of the frame, the second below the first.
    expect(plan.steps[0]!.to.y).toBeLessThan(480)
    expect(plan.steps[1]!.to.y).toBeGreaterThanOrEqual(480)
    // The corner picture in the top right, a little in from the top.
    expect(plan.steps[2]!.to.x).toBeGreaterThan(270)
    expect(plan.steps[2]!.to.y).toBeLessThan(100)
  })

  it('draws only the lowest clip\'s main picture, filling the frame at its own size, under Handoff', () => {
    const t = timeline('handoff')
    const main = { crop: { x: 100, y: 0, w: 300, h: 200 }, place: corner.place }
    const layer = { crop: { x: 1000, y: 0, w: 600, h: 400 }, place: { x: 0, y: 0, w: 0.5, h: 0.5 } }
    const plan = drawPlan(t, [{ pictures: [main, layer] }, { pictures: [corner] }], box)
    // 300 by 200 fitted in the monitor: 540 by 360, with black above and below.
    expect(plan.frame).toEqual({ x: 0, y: 300, w: 540, h: 360 })
    expect(plan.steps).toEqual([{ source: 0, from: main.crop, to: { x: 0, y: 300, w: 540, h: 360 } }])
  })
})

describe('drawing a plan', () => {
  const rowOnly: DrawPlan = { frame: { x: 0, y: 0, w: 540, h: 960 }, steps: [{ source: 1, from: corner.crop, to: { x: 0, y: 0, w: 10, h: 10 } }] }
  const withV1: DrawPlan = { ...rowOnly, steps: [{ source: 0, from: corner.crop, to: { x: 0, y: 0, w: 10, h: 10 } }, ...rowOnly.steps] }
  const row = { id: 'row video' } as unknown as HTMLVideoElement

  it('draws a higher picture over black when there is nothing from the lowest source', () => {
    const { ctx, drawn } = fakeContext()
    drawOnto(ctx, [null, row], rowOnly, 1)
    expect(drawn).toEqual([row])
  })

  it('draws nothing over black while the lowest clip there has a picture that is not ready', () => {
    const { ctx, drawn } = fakeContext()
    drawOnto(ctx, [null, row], withV1, 1)
    expect(drawn).toEqual([])
  })

  it('draws a picture on V2 over a gap in V1 as soon as its own player has a frame', () => {
    const { ctx, drawn } = fakeContext()
    drawOnto(ctx, [row], drawPlan(timeline(), [{ pictures: [corner] }], box), 1)
    expect(drawn).toEqual([row])
  })
})

/** Just enough of a 2D context to see what text was drawn, where, and in what. */
function textContext(): { ctx: CanvasRenderingContext2D; texts: { how: string; text: string; x: number; y: number; style: string; font: string }[] } {
  const texts: { how: string; text: string; x: number; y: number; style: string; font: string }[] = []
  const ctx = {
    canvas: { width: 540, height: 960 },
    fillStyle: '',
    strokeStyle: '',
    font: '',
    lineWidth: 1,
    save: () => undefined,
    restore: () => undefined,
    setTransform: () => undefined,
    beginPath: () => undefined,
    rect: () => undefined,
    clip: () => undefined,
    // Ten pixels a character, so where each word goes can be worked out here.
    measureText: (text: string) => ({ width: text.length * 10 }),
    fillText(text: string, x: number, y: number) {
      texts.push({ how: 'fill', text, x, y, style: this.fillStyle, font: this.font })
    },
    strokeText(text: string, x: number, y: number) {
      texts.push({ how: 'stroke', text, x, y, style: this.strokeStyle, font: this.font })
    }
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts }
}

describe('the caption in the Output view', () => {
  /** "one two" over 0 to 20, "two" said from 10, over V1's clip in a vertical frame. */
  function captioned(presetId = 'vertical'): Timeline {
    return setCaptions(timeline(presetId), [{ text: 'one', start: 0, length: 10 }, { text: 'two', start: 10, length: 10 }], [])
  }
  const plan = (t: Timeline): DrawPlan => drawPlan(t, [{ pictures: [{ crop: v1Clips(t)[0]!.transform.crop, place: FULL_PLACE }] }], box)

  it('draws its words white with a black outline, where the export puts them, in the bundled font', () => {
    const t = captioned()
    const { ctx, texts } = textContext()
    drawCaption(ctx, t, 3, plan(t), 1)
    const layout = layoutCaption(t.captions.clips[0]!, t.captions.style, 1080, 1920)
    // The monitor shows the frame at half size.
    const y = layout.lines[0]!.baseline / 2
    const x = 270 - 35
    expect(texts.slice(0, 2)).toEqual([
      { how: 'stroke', text: 'ONE TWO', x, y, style: '#000000', font: `${layout.fontPx / 2}px "Montserrat ExtraBold"` },
      { how: 'fill', text: 'ONE TWO', x, y, style: '#FFFFFF', font: `${layout.fontPx / 2}px "Montserrat ExtraBold"` }
    ])
  })

  it('draws the word being said over itself in the highlight colour, and moves on to the next as it is said', () => {
    const t = captioned()
    const at = (frame: number): { text: string; x: number; style: string } | undefined => {
      const { ctx, texts } = textContext()
      drawCaption(ctx, t, frame, plan(t), 1)
      const lit = texts[2]
      return lit ? { text: lit.text, x: lit.x, style: lit.style } : undefined
    }
    expect(at(3)).toEqual({ text: 'ONE', x: 235, style: '#FFD400' })
    // "ONE " is 40 pixels here: TWO starts after it.
    expect(at(12)).toEqual({ text: 'TWO', x: 275, style: '#FFD400' })
  })

  it('draws nothing where no caption is, or under a shape with no frame', () => {
    const t = captioned()
    const { ctx, texts } = textContext()
    drawCaption(ctx, t, 25, plan(t), 1)
    expect(texts).toEqual([])
    const handoff = captioned('handoff')
    drawCaption(ctx, handoff, 3, plan(handoff), 1)
    expect(texts).toEqual([])
  })

  it('draws it only over pictures drawn, never over black while they load', () => {
    const t = captioned()
    const { ctx, texts } = textContext()
    const withImages = Object.assign(ctx, { imageSmoothingQuality: 'low', fillRect: () => undefined, drawImage: () => undefined })
    drawOutput(withImages, t, 3, [null], plan(t), 1)
    expect(texts).toEqual([])
    drawOutput(withImages, t, 3, [{} as HTMLVideoElement], plan(t), 1)
    expect(texts.map((x) => x.text)).toContain('ONE TWO')
  })
})

/** A context that records the rectangles filled over the pictures, and at what opacity. */
function washContext(): { ctx: CanvasRenderingContext2D; fills: { x: number; y: number; w: number; h: number; colour: string; alpha: number }[] } {
  const fills: { x: number; y: number; w: number; h: number; colour: string; alpha: number }[] = []
  let cleared = false
  const ctx = {
    canvas: { width: 540, height: 960 },
    fillStyle: '',
    globalAlpha: 1,
    imageSmoothingQuality: 'low',
    setTransform: () => undefined,
    beginPath: () => undefined,
    rect: () => undefined,
    clip: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    drawImage: () => undefined,
    fillRect(x: number, y: number, w: number, h: number) {
      // The first fill is the black the whole canvas is cleared with.
      if (!cleared) {
        cleared = true
        return
      }
      fills.push({ x, y, w, h, colour: this.fillStyle as string, alpha: this.globalAlpha as number })
    }
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills }
}

describe('a transition dipping through a colour', () => {
  const full: DrawnClip = { pictures: [{ crop: { x: 0, y: 0, w: 1920, h: 1080 }, place: FULL_PLACE }] }

  it('lays the colour over the picture at the opacity it is given', () => {
    const plan = drawPlan(timeline(), [{ ...full, wash: { colour: 'black', alpha: 0.4 } }], box)
    expect(plan.steps[0]?.wash).toEqual({ colour: 'black', alpha: 0.4 })
    const { ctx, fills } = washContext()
    drawOnto(ctx, [{} as unknown as CanvasImageSource], plan, 1)
    expect(fills).toHaveLength(1)
    expect(fills[0]).toMatchObject({ colour: '#000', alpha: 0.4 })
  })

  it('lays it over that picture and no further, so a cutaway dipping leaves what is under it alone', () => {
    const plan = drawPlan(timeline(), [full, { pictures: [corner], wash: { colour: 'white', alpha: 1 } }], box)
    const { ctx, fills } = washContext()
    drawOnto(ctx, [{} as unknown as CanvasImageSource, {} as unknown as CanvasImageSource], plan, 1)
    expect(fills).toHaveLength(1)
    const over = plan.steps[1]!.to
    expect(fills[0]).toMatchObject({ x: over.x, y: over.y, w: over.w, h: over.h, colour: '#fff' })
    // Smaller than the whole frame: the picture underneath is not dipping.
    expect(over.w).toBeLessThan(plan.frame.w)
  })

  it('lays it over the whole frame for the lowest clip, bars and all, as the export dips it (audit 2026-10-01)', () => {
    const plan = drawPlan(timeline(), [{ pictures: [corner], wash: { colour: 'white', alpha: 0.5 } }], box)
    const { ctx, fills } = washContext()
    drawOnto(ctx, [{} as unknown as CanvasImageSource], plan, 1)
    expect(fills).toHaveLength(1)
    expect(fills[0]).toMatchObject({ x: plan.frame.x, y: plan.frame.y, w: plan.frame.w, h: plan.frame.h, colour: '#fff', alpha: 0.5 })
  })

  it('dips only the pixels of a picture with see-through parts, which the export leaves see-through', () => {
    const plan = drawPlan(timeline(), [full, { pictures: [corner], free: {}, wash: { colour: 'white', alpha: 0.5 } }], box)
    const { ctx, fills } = washContext()
    const filters: string[] = []
    ;(ctx as unknown as { drawImage: () => void }).drawImage = function (this: { filter?: string }) {
      filters.push(this.filter ?? 'none')
    }
    drawOnto(ctx, [{} as unknown as CanvasImageSource, {} as unknown as CanvasImageSource], plan, 1)
    expect(fills).toHaveLength(0)
    expect(filters).toContain('brightness(0) invert(1)')
  })

  it('lays nothing over a picture with no transition on it', () => {
    const plan = drawPlan(timeline(), [full], box)
    const { ctx, fills } = washContext()
    drawOnto(ctx, [{} as unknown as CanvasImageSource], plan, 1)
    expect(fills).toHaveLength(0)
  })
})

describe('the two sides of a blend', () => {
  const frame = { x: 0, y: 0, w: 540, h: 960 }

  it('mixes a dissolve by how far through it is, and leaves the picture underneath whole', () => {
    const { out, into } = mixFor('dissolve', 0.25, frame)
    expect(out).toEqual({})
    expect(into).toEqual({ alpha: 0.25 })
  })

  it('uncovers a wipe left from the right edge, and a wipe right from the left', () => {
    expect(mixFor('wipeLeft', 0.25, frame).into.clip).toEqual({ x: 405, y: 0, w: 135, h: 960 })
    expect(mixFor('wipeRight', 0.25, frame).into.clip).toEqual({ x: 0, y: 0, w: 135, h: 960 })
    // Nothing of the incoming picture at the start, and all of it at the end.
    expect(mixFor('wipeLeft', 0, frame).into.clip?.w).toBe(0)
    expect(mixFor('wipeLeft', 1, frame).into.clip?.w).toBe(540)
  })

  it('moves both pictures together for a push, one out and one in behind it', () => {
    const left = mixFor('pushLeft', 0.25, frame)
    expect(left.out.dx).toBe(-135)
    expect(left.into.dx).toBe(405)
    const right = mixFor('pushRight', 0.25, frame)
    expect(right.out.dx).toBe(135)
    expect(right.into.dx).toBe(-405)
    // They meet: the incoming picture is exactly where the outgoing one left off.
    expect(left.into.dx! - left.out.dx!).toBe(frame.w)
  })

  it('wipes and pushes up and down as it does sideways', () => {
    expect(mixFor('wipeUp', 0.25, frame).into.clip).toEqual({ x: 0, y: 720, w: 540, h: 240 })
    expect(mixFor('wipeDown', 0.25, frame).into.clip).toEqual({ x: 0, y: 0, w: 540, h: 240 })
    const up = mixFor('pushUp', 0.25, frame)
    expect(up.out.dy).toBe(-240)
    expect(up.into.dy).toBe(720)
    expect(mixFor('pushDown', 0.25, frame).into.dy).toBe(-720)
  })

  it('slides the next picture over a still one for a cover, and the one going off a still next for a reveal', () => {
    const cover = mixFor('coverLeft', 0.25, frame)
    expect(cover.out).toEqual({})
    expect(cover.into.dx).toBe(405)
    expect(mixFor('coverDown', 0.75, frame).into.dy).toBe(-240)
    const reveal = mixFor('revealRight', 0.25, frame)
    expect(reveal.out.dx).toBe(135)
    expect(reveal.into.clip).toEqual({ x: 0, y: 0, w: 135, h: 960 })
  })

  it('opens a soft circle from the middle, and closes one on it', () => {
    const reach = Math.hypot(270, 480)
    const open = mixFor('circleOpen', 0.5, frame).into.radial!
    expect(open).toMatchObject({ x: 270, y: 480, reach })
    // Half way: the middle is the next picture, the corners still the one going.
    expect(open.alpha(0)).toBe(1)
    expect(open.alpha(reach)).toBe(0)
    expect(open.alpha(reach / 2)).toBeCloseTo(0.5, 5)
    // Early on, only a little of the middle.
    expect(mixFor('circleOpen', 0.25, frame).into.radial!.alpha(reach / 2)).toBe(0)
    const close = mixFor('circleClose', 0.5, frame).into.radial!
    expect(close.alpha(0)).toBe(0)
    expect(close.alpha(reach)).toBe(1)
  })

  it('closes to black on the one going and opens on the next for the iris and the box', () => {
    const early = mixFor('iris', 0.25, frame)
    expect(early.into.hidden).toBe(true)
    expect(early.out.circle!.r).toBeCloseTo(Math.pow(0.5, 3) * Math.hypot(270, 480), 5)
    const late = mixFor('iris', 0.75, frame)
    expect(late.out.hidden).toBe(true)
    expect(late.into.circle!.r).toBeCloseTo(early.out.circle!.r, 5)
    expect(mixFor('box', 0.25, frame).out.clip).toEqual({ x: 135, y: 240, w: 270, h: 480 })
    expect(mixFor('box', 0.75, frame).into.clip).toEqual({ x: 135, y: 240, w: 270, h: 480 })
  })

  it('zooms into the one going over the first half, and fades the next in over the second', () => {
    const early = mixFor('zoomIn', 0.25, frame)
    expect(early.out.zoom!.k).toBeGreaterThan(1)
    expect(early.into.alpha).toBe(0)
    const late = mixFor('zoomIn', 0.75, frame)
    expect(late.into.alpha).toBeCloseTo(1 - 0.5 * 0.5 * (3 - 2 * 0.5), 5)
    expect(mixFor('zoomIn', 1, frame).into.alpha).toBe(1)
  })

  it('blurs both across most in the middle, while one turns into the other', () => {
    const middle = mixFor('blur', 0.5, frame, 1080)
    const early = mixFor('blur', 0.1, frame, 1080)
    expect(middle.out.blurX!).toBeGreaterThan(early.out.blurX!)
    expect(middle.into.blurX).toBe(middle.out.blurX)
    expect(middle.into.alpha).toBe(0.5)
    // As wide on a 540 wide monitor as `hblur` is on the 1080 wide output.
    expect(middle.out.blurX).toBeCloseTo((541 * 540) / 1080, 5)
  })

  it('pulls the next picture back from four times its size while it dissolves in (plan 95)', () => {
    expect(mixFor('zoomOut', 0, frame).into).toMatchObject({ zoom: { x: 270, y: 480, k: 4 }, alpha: 0 })
    expect(mixFor('zoomOut', 0.5, frame).into).toMatchObject({ zoom: { k: 2.5 }, alpha: 0.5 })
    expect(mixFor('zoomOut', 1, frame).into.zoom!.k).toBe(1)
    expect(mixFor('zoomOut', 0.5, frame).out).toEqual({})
  })

  it('cuts both into squares as pixelize does, largest in the middle (plan 95)', () => {
    // `pixelize` on a 1080 by 1920 output: squares of 2 x 0.5 x 1080 / 20 = 54 pixels, half that on a 540 wide monitor.
    const middle = mixFor('pixelate', 0.5, frame, 1080)
    expect(middle.out.pixel!.size).toBeCloseTo(27, 5)
    expect(middle.into.pixel).toEqual(middle.out.pixel)
    expect(middle.into.alpha).toBe(0.5)
    // A quarter in: 0.25 rounded up to the next fiftieth.
    expect(mixFor('pixelate', 0.25, frame, 1080).out.pixel!.size).toBeCloseTo(((2 * 0.26 * 1080) / 20) * 0.5, 5)
    expect(mixFor('pixelate', 0, frame, 1080).out.pixel).toBeUndefined()
  })

  it('pulls red and blue apart most in the middle of an RGB split (plan 95)', () => {
    // 3 % of the 1080 wide output, 32 pixels, is 16 on a 540 wide monitor.
    const middle = mixFor('rgbSplit', 0.5, frame, 1080)
    expect(middle.out.split).toEqual({ d: 16, frame })
    expect(middle.into).toEqual({ split: { d: 16, frame }, alpha: 0.5 })
    expect(mixFor('rgbSplit', 0.25, frame, 1080).out.split!.d).toBe(8)
    expect(mixFor('rgbSplit', 0, frame, 1080).out.split).toBeUndefined()
  })

  it('turns both one whole turn about the middle of the frame (plan 95)', () => {
    expect(mixFor('spin', 0.5, frame).out.turn).toEqual({ x: 270, y: 480, a: Math.PI })
    expect(mixFor('spin', 0.5, frame).into).toEqual({ turn: { x: 270, y: 480, a: Math.PI }, alpha: 0.5 })
    expect(mixFor('spin', 0, frame).out.turn!.a).toBe(0)
    expect(mixFor('spin', 1, frame).out.turn!.a).toBeCloseTo(2 * Math.PI, 9)
  })

  it('holds a progress outside the window at its ends', () => {
    expect(mixFor('dissolve', -1, frame).into.alpha).toBe(0)
    expect(mixFor('dissolve', 9, frame).into.alpha).toBe(1)
  })

  it('draws the incoming picture see-through over the outgoing one', () => {
    const under: DrawnClip = { pictures: [{ crop: { x: 0, y: 0, w: 1920, h: 1080 }, place: FULL_PLACE }] }
    const over: DrawnClip = { ...under, mix: { alpha: 0.5 } }
    const plan = drawPlan(timeline(), [under, over], box)
    expect(plan.steps.map((s) => s.mix)).toEqual([undefined, { alpha: 0.5 }])
    const drawnAt: number[] = []
    const ctx = {
      canvas: { width: 540, height: 960 },
      fillStyle: '',
      globalAlpha: 1,
      imageSmoothingQuality: 'low',
      setTransform: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      beginPath: () => undefined,
      rect: () => undefined,
      clip: () => undefined,
      translate: () => undefined,
      fillRect: () => undefined,
      drawImage(this: { globalAlpha: number }) {
        drawnAt.push(this.globalAlpha)
      }
    }
    const source = {} as unknown as CanvasImageSource
    drawOnto(ctx as unknown as CanvasRenderingContext2D, [source, source], plan, 1)
    expect(drawnAt).toEqual([1, 0.5])
  })
})

describe('a look on a clip', () => {
  const whole = { crop: { x: 0, y: 0, w: 1080, h: 1080 }, place: FULL_PLACE }

  it('is drawn on every picture of its clip, and on nothing else', () => {
    const plan = drawPlan(timeline(), [{ pictures: [whole] }, { pictures: [whole, corner], look: 'mono' }], box)
    expect(plan.steps.map((s) => [s.source, s.filter ?? null])).toEqual([
      [0, null],
      [1, 'grayscale(1)'],
      [1, 'grayscale(1)']
    ])
  })

  it('draws nothing for a look the app does not have', () => {
    expect(drawPlan(timeline(), [{ pictures: [whole], look: 'sepia' }], box).steps[0]!.filter).toBeUndefined()
  })

  it('is set for its own picture only, and never left on for the next', () => {
    const filters: string[] = []
    const { ctx } = fakeContext()
    const seen = ctx as unknown as { filter: string; drawImage: () => void }
    seen.filter = 'none'
    seen.drawImage = () => void filters.push(seen.filter)
    const plan = drawPlan(timeline(), [{ pictures: [whole], look: 'mono' }, { pictures: [corner] }], box)
    drawOnto(ctx, [{} as CanvasImageSource, {} as CanvasImageSource], plan, 1)
    expect(filters).toEqual(['grayscale(1)', 'none'])
    expect(seen.filter).toBe('none')
  })
})

describe('an overlay on the Output view', () => {
  it('is drawn turned and faded, its box reaching past the frame, as the export lays it', () => {
    const t = timeline()
    const plan = drawPlan(
      t,
      [{ pictures: [{ crop: { x: 0, y: 0, w: 400, h: 200 }, place: { x: -0.5, y: 0.25, w: 1, h: 0.28125 } }], free: { rotation: 90, opacity: 0.5 } }],
      { width: 1080, height: 1920 }
    )
    const step = plan.steps[0]!
    expect(step.to.x).toBeCloseTo(-540)
    expect(step.turn).toBeCloseTo(Math.PI / 2)
    expect(step.alpha).toBe(0.5)
  })

  it('is drawn popped to a size about its middle while it comes in, and at its own size otherwise', () => {
    const t = timeline()
    const at = (scale?: number) =>
      drawPlan(
        t,
        [{ pictures: [{ crop: { x: 0, y: 0, w: 400, h: 200 }, place: { x: 0.25, y: 0.25, w: 0.5, h: 0.140625 } }], free: scale === undefined ? {} : { scale } }],
        { width: 1080, height: 1920 }
      ).steps[0]!
    expect(at(0.4).grow).toBeCloseTo(0.4)
    expect(at(1).grow).toBeUndefined()
    expect(at().grow).toBeUndefined()
  })
})

describe('the Instagram grid guide', () => {
  it('is the largest 3:4 box of the frame, centred', () => {
    expect(coverBox(1080, 1920)).toEqual({ x: 0, y: (1 - 1440 / 1920) / 2, w: 1, h: 1440 / 1920 })
    const wide = coverBox(1920, 1080)
    expect(wide.h).toBe(1)
    expect(wide.w * 1920).toBeCloseTo(810)
    expect(wide.x).toBeCloseTo((1 - 810 / 1920) / 2)
  })
})
