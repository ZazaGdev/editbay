import { describe, it, expect } from 'vitest'
import { DEFAULT_CAPTION_STYLE, captionsAss, cleanCaptionStyle, layoutCaption, type CaptionClip, type CaptionStyle } from '../../src/shared/captions'
import { BLUR_SIGMA_PER_ASS, POP_GROW, captionDrawing } from '../../src/shared/caption-drawing'
import { spacedWidth } from '../../src/shared/caption-layout'

/** Plan 99: the box behind a caption, its glow, and the word being said popping. */

const clip: CaptionClip = {
  id: 'c',
  timelineStart: 0,
  length: 30,
  words: ['ONE', 'TWO', 'SIX'].map((text, i) => ({ text, start: i * 10, length: 10 }))
}
const style = (change: Partial<CaptionStyle>): CaptionStyle => ({ ...DEFAULT_CAPTION_STYLE, ...change })
const drawing = (s: CaptionStyle, lit = 0) => captionDrawing(clip, s, layoutCaption(clip, s, 1920, 1080), lit)
const ass = (s: CaptionStyle): string[] => captionsAss({ clips: [clip], style: s, from: 0, to: 30, fps: 30, width: 1920, height: 1080 })!.split('\n').filter((l) => l.startsWith('Dialogue:'))

describe('a caption style from before plan 99', () => {
  it('has no box, no glow and no pop, and writes the same lines it always did', () => {
    const d = drawing(DEFAULT_CAPTION_STYLE)
    expect(d).toEqual({ box: null, wordBox: null, glow: null, pieces: null })
    // One event a word, a whole line each, and nothing drawn besides.
    expect(ass(DEFAULT_CAPTION_STYLE)).toHaveLength(3)
    expect(ass(DEFAULT_CAPTION_STYLE).every((l) => l.includes('\\an2'))).toBe(true)
  })

  it('cleans what a damaged file gives back to the defaults', () => {
    const s = cleanCaptionStyle({ box: 'yes', boxOpacity: 4, glow: -1, glowColour: 'red', popGrow: 1, popBoxColour: '#00ff00' })
    expect([s.box, s.boxOpacity, s.glow, s.glowColour, s.popGrow, s.popBoxColour]).toEqual([false, 1, 0, DEFAULT_CAPTION_STYLE.glowColour, false, '#00FF00'])
    expect(cleanCaptionStyle({ glow: 9 }).glow).toBeLessThan(0.5)
  })
})

describe('the box behind a caption', () => {
  it('surrounds every line of the words, padded past the outline, and is drawn first, under them', () => {
    const s = style({ box: true, boxColour: '#112233', boxOpacity: 0.5 })
    const layout = layoutCaption(clip, s, 1920, 1080)
    const box = drawing(s).box!
    expect(box.x).toBeLessThan(layout.centerX - layout.width / 2 - layout.outlinePx)
    expect(box.x + box.w).toBeGreaterThan(layout.centerX + layout.width / 2 + layout.outlinePx)
    expect(box.x + box.w / 2).toBeCloseTo(layout.centerX, 6)
    const baseline = layout.lines[0]!.baseline
    expect(box.y).toBeLessThan(baseline - 0.7 * layout.fontPx)
    expect(box.y + box.h).toBeGreaterThan(baseline)
    const lines = ass(s)
    // A drawing, placed from its top left, in blue, green, red, half drawn, before any words.
    expect(lines[0]).toContain(`\\an7\\pos(${Math.round(box.x * 100) / 100},${Math.round(box.y * 100) / 100})`)
    expect(lines[0]).toContain('\\1c&H332211&\\1a&H80&\\p1}m ')
    // For the whole caption, not word by word.
    expect(lines[0]).toMatch(/^Dialogue: 0,0:00:00\.00,0:00:00\.98,/)
    expect(lines.filter((l) => l.includes('\\p1'))).toHaveLength(1)
  })

  it('stays the same size whichever word is lit, wide enough for the widest grown', () => {
    const s = style({ box: true, popGrow: true })
    const boxes = [0, 1, 2].map((lit) => drawing(s, lit).box)
    expect(boxes[1]).toEqual(boxes[0])
    expect(boxes[2]).toEqual(boxes[0])
    const plain = drawing(style({ box: true })).box!
    expect(boxes[0]!.w).toBeGreaterThan(plain.w)
  })
})

describe('a glow', () => {
  it('blurs the words again in its colour, under them, as far as the style says', () => {
    const s = style({ glow: 0.2, glowColour: '#00FFFF' })
    const layout = layoutCaption(clip, s, 1920, 1080)
    expect(drawing(s).glow).toEqual({ blur: 0.2 * layout.fontPx, colour: '#00FFFF' })
    const lines = ass(s)
    // Each word's moment: the glow first, then the words over it.
    expect(lines).toHaveLength(6)
    expect(lines[0]).toContain(`\\1c&HFFFF00&\\3c&HFFFF00&\\bord${Math.round((layout.outlinePx + 0.1 * layout.fontPx) * 100) / 100}\\shad0\\blur${Math.round(0.2 * layout.fontPx * 100) / 100}`)
    expect(lines[0]).toContain('ONE TWO SIX')
    expect(lines[1]).not.toContain('\\blur')
  })

  it('is blurred on the canvas by the standard deviation libass blurs by', () => {
    // Measured from libass's own pixels for this plan: \blur 10 spreads an edge with a standard deviation of 8.44.
    expect(Math.abs(10 * BLUR_SIGMA_PER_ASS - 8.44)).toBeLessThan(0.1)
  })
})

describe('the word being said popping', () => {
  it('draws each word on its own, the lit one grown from its baseline, the rest of the line making room', () => {
    const s = style({ popGrow: true })
    const layout = layoutCaption(clip, s, 1920, 1080)
    const pieces = drawing(s, 1).pieces!
    expect(pieces.map((p) => [p.text, p.scale, p.lit])).toEqual([
      ['ONE', 1, false],
      ['TWO', POP_GROW, true],
      ['SIX', 1, false]
    ])
    const em = layout.fontPx
    const w = (t: string): number => spacedWidth(t, s) * em
    const space = spacedWidth(' ', s) * em
    expect(pieces[1]!.x - pieces[0]!.x).toBeCloseTo(w('ONE') + space, 6)
    expect(pieces[2]!.x - pieces[1]!.x).toBeCloseTo(w('TWO') * POP_GROW + space, 6)
    // The line, grown word and all, centred.
    const right = pieces[2]!.x + w('SIX')
    expect((pieces[0]!.x + right) / 2).toBeCloseTo(layout.centerX, 6)
    expect(pieces.every((p) => p.baseline === layout.lines[0]!.baseline)).toBe(true)
  })

  it('writes one event a word, placed from its left edge, the lit one scaled and in the highlight colour', () => {
    const s = style({ popGrow: true })
    const lines = ass(s)
    expect(lines).toHaveLength(9)
    const second = lines.slice(3, 6)
    expect(second.map((l) => l.split('}').at(-1))).toEqual(['ONE', 'TWO', 'SIX'])
    expect(second[1]).toContain(`\\fscx${POP_GROW * 100}\\fscy${POP_GROW * 100}\\c&H00D4FF&`)
    expect(second[0]).not.toContain('\\fscx')
    expect(second.every((l) => l.includes('\\an1\\pos('))).toBe(true)
  })

  it('puts a box of its own colour behind the word being said, round it as grown', () => {
    const s = style({ popBox: true, popGrow: true, popBoxColour: '#FF0000' })
    const d = drawing(s, 2)
    const said = d.pieces!.find((p) => p.lit)!
    const box = d.wordBox!
    expect(box.colour).toBe('#FF0000')
    expect(box.x).toBeLessThan(said.x)
    expect(box.x + box.w).toBeGreaterThan(said.x + spacedWidth('SIX', s) * layoutCaption(clip, s, 1920, 1080).fontPx * POP_GROW)
    expect(box.y + box.h).toBeGreaterThan(said.baseline)
    // Written under that word's moment, before its words.
    const lines = ass(s)
    // A box and three words for each word's moment: the third moment's box is the ninth line.
    expect(lines).toHaveLength(12)
    expect(lines[8]).toContain('\\1c&H0000FF&\\1a&H00&\\p1}')
  })

  it('draws the box behind the word being said over the glow, which would otherwise hide it, and under the words', () => {
    const lines = ass(style({ popBox: true, glow: 0.2 })).slice(0, 7)
    expect(lines.map((l) => (l.includes('\\p1') ? 'box' : l.includes('\\blur') ? 'glow' : 'word'))).toEqual(['glow', 'glow', 'glow', 'box', 'word', 'word', 'word'])
  })

  it('a box alone leaves every word its own size', () => {
    expect(drawing(style({ popBox: true }), 1).pieces!.every((p) => p.scale === 1)).toBe(true)
  })
})
