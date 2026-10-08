import { describe, it, expect } from 'vitest'
import { drawCaption } from '../../../src/renderer/preview/drawCaption'
import { drawPlan, type DrawPlan } from '../../../src/renderer/preview/compositor'
import { addClip, createTimeline, setCaptionStyle, setCaptions, v1Clips, type ProjectMedia, type Timeline } from '../../../src/shared/project'
import { layoutCaption, type CaptionStyleChange } from '../../../src/shared/captions'
import { BLUR_SIGMA_PER_ASS, POP_GROW, captionDrawing } from '../../../src/shared/caption-drawing'
import { FULL_PLACE } from '../../../src/shared/layout'

/**
 * Plan 99: the Output view draws a caption's box, glow and popping word where
 * the shared geometry says, which is where the export writes them.
 */

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

/** "one two" over 0 to 20, "two" said from 10, in a vertical frame, in this style. */
function captioned(change: CaptionStyleChange): Timeline {
  const t = createTimeline(30, { width: 1080, height: 1920 }, 'vertical')
  return setCaptionStyle(setCaptions(addClip({ ...t, media: [media('a')] }, 'a'), [{ text: 'one', start: 0, length: 10 }, { text: 'two', start: 10, length: 10 }], []), change)
}
const plan = (t: Timeline): DrawPlan => drawPlan(t, [{ pictures: [{ crop: v1Clips(t)[0]!.transform.crop, place: FULL_PLACE }] }], { width: 540, height: 960 })

interface Mark {
  how: string
  text?: string
  x: number
  y: number
  w?: number
  h?: number
  style: string
  alpha: number
  filter: string
  scale: number
  lineWidth: number
}

/** A context that records what is drawn, where, under which translation and scale, with which filter. */
function recorder(): { ctx: CanvasRenderingContext2D; marks: Mark[] } {
  const marks: Mark[] = []
  const state = { tx: 0, ty: 0, s: 1 }
  const stack: (typeof state & { filter: string; alpha: number })[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    filter: 'none',
    globalAlpha: 1,
    lineWidth: 1,
    letterSpacing: '0px',
    save() {
      stack.push({ ...state, filter: this.filter, alpha: this.globalAlpha })
    },
    restore() {
      const top = stack.pop()!
      Object.assign(state, { tx: top.tx, ty: top.ty, s: top.s })
      this.filter = top.filter
      this.globalAlpha = top.alpha
    },
    setTransform: () => undefined,
    translate(x: number, y: number) {
      state.tx += x * state.s
      state.ty += y * state.s
    },
    scale(s: number) {
      state.s *= s
    },
    beginPath: () => undefined,
    rect: () => undefined,
    clip: () => undefined,
    fill: () => undefined,
    roundRect(x: number, y: number, w: number, h: number) {
      marks.push({ how: 'box', x, y, w, h, style: this.fillStyle, alpha: this.globalAlpha, filter: this.filter, scale: state.s, lineWidth: this.lineWidth })
    },
    measureText: (text: string) => ({ width: text.length * 10 }),
    fillText(text: string, x: number, y: number) {
      marks.push({ how: 'fill', text, x: state.tx + x * state.s, y: state.ty + y * state.s, style: this.fillStyle, alpha: this.globalAlpha, filter: this.filter, scale: state.s, lineWidth: this.lineWidth })
    },
    strokeText(text: string, x: number, y: number) {
      marks.push({ how: 'stroke', text, x: state.tx + x * state.s, y: state.ty + y * state.s, style: this.strokeStyle, alpha: this.globalAlpha, filter: this.filter, scale: state.s, lineWidth: this.lineWidth })
    }
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, marks }
}

/** The monitor shows the 1080 wide frame 540 wide. */
const K = 0.5

describe('a caption box on the Output view', () => {
  it('is drawn first, where and how big the shared geometry puts it, at its opacity', () => {
    const t = captioned({ box: true, boxColour: '#123456', boxOpacity: 0.4 })
    const { ctx, marks } = recorder()
    drawCaption(ctx, t, 3, plan(t), 1)
    const layout = layoutCaption(t.captions.clips[0]!, t.captions.style, 1080, 1920)
    const box = captionDrawing(t.captions.clips[0]!, t.captions.style, layout, 0).box!
    expect(marks[0]).toMatchObject({ how: 'box', x: box.x * K, y: box.y * K, w: box.w * K, h: box.h * K, style: '#123456', alpha: 0.4 })
    // The words after it, opaque.
    expect(marks.slice(1).every((m) => m.how !== 'box' && m.alpha === 1)).toBe(true)
  })
})

describe('a caption glow on the Output view', () => {
  it('draws the words in its colour first, blurred by what libass blurs by, then the words unblurred', () => {
    const t = captioned({ glow: 0.2, glowColour: '#00FFFF' })
    const { ctx, marks } = recorder()
    drawCaption(ctx, t, 3, plan(t), 2)
    const layout = layoutCaption(t.captions.clips[0]!, t.captions.style, 1080, 1920)
    const blur = 0.2 * layout.fontPx
    const glow = marks.filter((m) => m.filter !== 'none')
    expect(glow.map((m) => [m.how, m.style])).toEqual([
      ['stroke', '#00FFFF'],
      ['fill', '#00FFFF']
    ])
    // In the canvas's own pixels: frame to monitor, then the window's scale of 2.
    expect(glow[0]!.filter).toBe(`blur(${blur * BLUR_SIGMA_PER_ASS * K * 2}px)`)
    expect(glow[0]!.lineWidth).toBeCloseTo(2 * (layout.outlinePx + blur / 2) * K, 6)
    expect(marks.indexOf(glow[1]!)).toBeLessThan(marks.findIndex((m) => m.filter === 'none'))
  })
})

describe('the word being said popping on the Output view', () => {
  it('draws each word where the export places it, the lit one grown from its baseline', () => {
    const t = captioned({ popGrow: true })
    const { ctx, marks } = recorder()
    drawCaption(ctx, t, 12, plan(t), 1)
    const c = t.captions.clips[0]!
    const layout = layoutCaption(c, t.captions.style, 1080, 1920)
    const pieces = captionDrawing(c, t.captions.style, layout, 1).pieces!
    const fills = marks.filter((m) => m.how === 'fill')
    expect(fills.map((f) => [f.text, f.x, f.y, f.scale, f.style])).toEqual(
      pieces.map((p) => [p.text, p.x * K, p.baseline * K, p.scale, p.lit ? '#FFD400' : '#FFFFFF'])
    )
    expect(fills[1]!.scale).toBe(POP_GROW)
    // Its outline as thick as the others', as libass does not grow it with the letters.
    const strokes = marks.filter((m) => m.how === 'stroke')
    expect(strokes[1]!.lineWidth * strokes[1]!.scale).toBeCloseTo(strokes[0]!.lineWidth * strokes[0]!.scale, 6)
  })

  it('draws the box behind the word being said under it, in its own colour', () => {
    const t = captioned({ popBox: true, popBoxColour: '#FF0000' })
    const { ctx, marks } = recorder()
    drawCaption(ctx, t, 12, plan(t), 1)
    const c = t.captions.clips[0]!
    const layout = layoutCaption(c, t.captions.style, 1080, 1920)
    const wordBox = captionDrawing(c, t.captions.style, layout, 1).wordBox!
    expect(marks[0]).toMatchObject({ how: 'box', x: wordBox.x * K, y: wordBox.y * K, style: '#FF0000', alpha: 1 })
    // Over a glow, so the glow never hides it, and still under the words.
    const { ctx: glowing, marks: withGlow } = recorder()
    drawCaption(glowing, captioned({ popBox: true, glow: 0.2 }), 12, plan(t), 1)
    expect(withGlow.map((m) => (m.how === 'box' ? 'box' : m.filter !== 'none' ? 'glow' : 'word')).filter((m, i, all) => m !== all[i - 1])).toEqual(['glow', 'box', 'word'])
    // Moved on with the words: on the first word while it is said.
    const { ctx: first, marks: early } = recorder()
    drawCaption(first, t, 3, plan(t), 1)
    expect(early[0]!.x).toBeLessThan(marks[0]!.x)
  })
})
