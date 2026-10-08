import { describe, it, expect } from 'vitest'
import { DEFAULT_TEXT, textMargin } from '../../src/shared/text'
import { addTextTo, createProject, editSequence, findVideoClip, setTextOn, timelineOf, type Project } from '../../src/shared/project'
import { placeInFrame } from '../../src/shared/layout'
import { S1 } from '../project-helpers'

/**
 * Item 21: a text's Align decides which of its sides stays put as it is
 * drawn again, and a box can be lined up with the frame's sides and middle.
 */

const W = 1080
const H = 1920
const small = { path: 'C:/cache/text/a.png', width: 400, height: 120 }
const wide = { path: 'C:/cache/text/b.png', width: 800, height: 120 }

function withText(align: 'left' | 'center' | 'right'): Project {
  const p = editSequence({ ...createProject('t', 30, { width: W, height: H }), media: [] }, S1, (t) => t)
  return addTextTo(p, S1, { mediaId: 'm', clipId: 'c', at: 0, style: { ...DEFAULT_TEXT, align }, drawn: small })
}
const placeOf = (p: Project): { x: number; w: number } => findVideoClip(timelineOf(p, S1), 'c')!.clip.transform.place
const px = (n: number): number => Math.round(n * W)

describe('a text drawn again wider', () => {
  it('keeps its left edge when aligned left, its right edge when aligned right, and its middle when centred', () => {
    for (const align of ['left', 'center', 'right'] as const) {
      const p = withText(align)
      const before = placeOf(p)
      const after = placeOf(setTextOn(p, 'm', { ...DEFAULT_TEXT, align, text: 'A good deal longer' }, wide))
      if (align === 'left') expect(px(after.x)).toBe(px(before.x))
      if (align === 'right') expect(px(after.x + after.w)).toBe(px(before.x + before.w))
      if (align === 'center') expect(px(after.x + after.w / 2)).toBe(px(before.x + before.w / 2))
    }
  })
})

describe('a text given a glow (plan 99)', () => {
  it('keeps its letters where they were when aligned left or right, the picture growing outwards by the room the glow needs', () => {
    for (const align of ['left', 'right'] as const) {
      const p = withText(align)
      const before = placeOf(p)
      const glowing = { ...DEFAULT_TEXT, align, glow: true }
      const grew = textMargin(glowing) - textMargin({ ...DEFAULT_TEXT, align })
      expect(grew).toBeGreaterThan(20)
      const drawn = { ...small, width: small.width + 2 * grew }
      const after = placeOf(setTextOn(p, 'm', glowing, drawn))
      // The letters' left edge, for left aligned, is the picture's edge plus its margin.
      if (align === 'left') expect(px(after.x) + textMargin(glowing)).toBe(px(before.x) + textMargin({ ...DEFAULT_TEXT, align }))
      if (align === 'right') expect(px(after.x + after.w) - textMargin(glowing)).toBe(px(before.x + before.w) - textMargin({ ...DEFAULT_TEXT, align }))
    }
  })

  it('has the same room round it as before glows existed while its glow is off', () => {
    // The old rule: the outline, and the shadow's blur and offset.
    expect(textMargin({ ...DEFAULT_TEXT, glowSize: 150 })).toBe(Math.ceil(DEFAULT_TEXT.outlineWidth))
    const shadowed = { ...DEFAULT_TEXT, shadow: true, glowSize: 150 }
    expect(textMargin(shadowed)).toBe(Math.ceil(shadowed.outlineWidth + shadowed.shadowBlur + Math.max(Math.abs(shadowed.shadowX), Math.abs(shadowed.shadowY))))
  })
})

describe('lining a box up with the frame', () => {
  const box = { x: 0.3, y: 0.4, w: 0.2, h: 0.05 }
  it('puts it the margin in from a side, or in the middle, moving it one way only', () => {
    expect(px(placeInFrame(box, 'left', W, H).x)).toBe(54)
    expect(px(placeInFrame(box, 'right', W, H).x + 0.2)).toBe(W - 54)
    expect(placeInFrame(box, 'centre', W, H).x + 0.1).toBeCloseTo(0.5, 6)
    expect(placeInFrame(box, 'centre', W, H).y).toBe(0.4)
    expect(Math.round(placeInFrame(box, 'top', W, H).y * H)).toBe(54)
    expect(placeInFrame(box, 'middle', W, H).y + 0.025).toBeCloseTo(0.5, 6)
    expect(Math.round((placeInFrame(box, 'bottom', W, H).y + 0.05) * H)).toBe(H - 54)
  })
})
