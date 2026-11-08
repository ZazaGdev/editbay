import { describe, it, expect } from 'vitest'
import { DEFAULT_CAPTION_STYLE, captionMoves, captionsAss, cleanCaptionStyle, layoutCaption, type CaptionClip, type CaptionStyle } from '../../src/shared/captions'
import { captionDrawing } from '../../src/shared/caption-drawing'

/** Plan 107: captions coming in and going out, a line or a word at a time. */

// One second at 30 fps, three words a third of a second apart.
const clip: CaptionClip = {
  id: 'c',
  timelineStart: 60,
  length: 30,
  words: ['ONE', 'TWO', 'SIX'].map((text, i) => ({ text, start: i * 10, length: 10 }))
}
const style = (change: Partial<CaptionStyle>): CaptionStyle => ({ ...DEFAULT_CAPTION_STYLE, ...change })
const moves = (s: CaptionStyle, frame: number) => captionMoves(clip, s, frame, 30)
const drawing = (s: CaptionStyle, frame: number) => captionDrawing(clip, s, layoutCaption(clip, s, 1920, 1080), 0, moves(s, frame))
const ass = (s: CaptionStyle): string[] => captionsAss({ clips: [clip], style: s, from: 0, to: 120, fps: 30, width: 1920, height: 1080 })!.split('\n').filter((l) => l.startsWith('Dialogue:'))

describe('a caption style from before plan 107', () => {
  it('cuts its captions in and out, and writes the same events as before', () => {
    expect(DEFAULT_CAPTION_STYLE.animation).toBe('none')
    expect(DEFAULT_CAPTION_STYLE.animateBy).toBe('line')
    for (let f = 60; f < 90; f++) expect(moves(DEFAULT_CAPTION_STYLE, f)).toBeNull()
    expect(ass(DEFAULT_CAPTION_STYLE)).toHaveLength(3)
  })

  it('loads with no animation, and a damaged one goes back to none', () => {
    const old = cleanCaptionStyle({ size: 0.05 })
    expect([old.animation, old.animateBy]).toEqual(['none', 'line'])
    const bad = cleanCaptionStyle({ animation: 'spin', animateBy: 'letter' })
    expect([bad.animation, bad.animateBy]).toEqual(['none', 'line'])
    const good = cleanCaptionStyle({ animation: 'slideUp', animateBy: 'word' })
    expect([good.animation, good.animateBy]).toEqual(['slideUp', 'word'])
  })
})

describe('a whole caption coming in and going out', () => {
  it('pops in from smaller, past its size, and settles still', () => {
    const s = style({ animation: 'pop' })
    const first = moves(s, 60)!.whole
    expect(first.scale).toBeLessThan(1)
    expect(first.opacity).toBeGreaterThan(0)
    // easeOutBack goes past full size before it settles.
    const scales = [61, 62, 63, 64, 65, 66].map((f) => moves(s, f)?.whole.scale ?? 1)
    expect(Math.max(...scales)).toBeGreaterThan(1)
    expect(moves(s, 75)).toBeNull()
  })

  it('fades out over its last frames, and is still drawn on its very last one', () => {
    const s = style({ animation: 'fade' })
    expect(moves(s, 86)).toBeNull()
    const last = moves(s, 89)!.whole
    expect(last.opacity).toBeGreaterThan(0)
    expect(last.opacity).toBeLessThan(moves(s, 87)!.whole.opacity)
  })

  it('slides up from below and on up as it goes, and down the other way', () => {
    expect(moves(style({ animation: 'slideUp' }), 60)!.whole.rise).toBeLessThan(0)
    expect(moves(style({ animation: 'slideUp' }), 89)!.whole.rise).toBeGreaterThan(0)
    expect(moves(style({ animation: 'slideDown' }), 60)!.whole.rise).toBeGreaterThan(0)
    expect(moves(style({ animation: 'slideDown' }), 89)!.whole.rise).toBeLessThan(0)
  })

  it('takes at most a third of a short caption to come in, so it is read standing still', () => {
    const short: CaptionClip = { ...clip, length: 6, words: [{ text: 'HI', start: 0, length: 6 }] }
    const s = style({ animation: 'slideUp' })
    expect(captionMoves(short, s, 61, 30)).not.toBeNull()
    expect(captionMoves(short, s, 62, 30)).toBeNull()
    expect(captionMoves(short, s, 63, 30)).toBeNull()
  })

  it('grows and shrinks about the middle of the caption, its box with it', () => {
    const s = style({ animation: 'pop', box: true })
    const still = captionDrawing(clip, s, layoutCaption(clip, s, 1920, 1080), 0, null)
    const popping = drawing(s, 60)
    const mid = (r: { x: number; w: number }): number => r.x + r.w / 2
    expect(mid(popping.box!)).toBeCloseTo(mid(still.box!), 6)
    expect(popping.box!.w).toBeLessThan(still.box!.w)
    expect(popping.box!.opacity).toBeLessThan(s.boxOpacity)
    expect(popping.pieces!.every((p) => p.scale < 1)).toBe(true)
  })
})

describe('a word at a time as each is said', () => {
  it('shows only the words said so far, with nothing moving when there is no animation', () => {
    const s = style({ animateBy: 'word' })
    expect(moves(s, 60)!.words.map((w) => w.opacity)).toEqual([1, 0, 0])
    expect(moves(s, 70)!.words.map((w) => w.opacity)).toEqual([1, 1, 0])
    // Every word said, nothing differs from a caption standing still.
    expect(moves(s, 85)).toBeNull()
  })

  it('pops each word in as it is said, the others standing still, and leaves the caption whole', () => {
    const s = style({ animateBy: 'word', animation: 'pop' })
    const m = moves(s, 70)!
    expect(m.words[0]).toEqual({ opacity: 1, scale: 1, rise: 0 })
    expect(m.words[1]!.scale).toBeLessThan(1)
    expect(m.words[2]!.opacity).toBe(0)
    expect(m.whole).toEqual({ opacity: 1, scale: 1, rise: 0 })
    expect(moves(s, 89)!.whole.opacity).toBeLessThan(1)
  })

  it('keeps the word being said in the highlight colour', () => {
    const s = style({ animateBy: 'word', animation: 'pop' })
    const d = captionDrawing(clip, s, layoutCaption(clip, s, 1920, 1080), 1, moves(s, 70))
    expect(d.pieces!.find((p) => p.lit)!.word).toBe(1)
  })
})

describe('the export', () => {
  it('writes a frame at a time while a caption pops in, and one event while it stands still', () => {
    const lines = ass(style({ animation: 'pop' }))
    expect(lines.some((l) => l.includes('\\fscx') && l.includes('\\alpha'))).toBe(true)
    // The first word lit for frames 60 to 69: some single frames coming in, then one event to its end.
    const firstWord = lines.filter((l) => l.includes('ONE') && !l.includes('\\alpha') && !l.includes('\\fscx'))
    expect(firstWord.length).toBeGreaterThan(0)
    expect(lines.length).toBeGreaterThan(9)
  })

  it('does not write a word that is not said yet', () => {
    const lines = ass(style({ animateBy: 'word' }))
    // The first frames: only ONE.
    const atStart = lines.filter((l) => l.startsWith('Dialogue: 0,0:00:01.98,'))
    expect(atStart.length).toBeGreaterThan(0)
    expect(atStart.every((l) => l.endsWith('ONE'))).toBe(true)
  })
})
