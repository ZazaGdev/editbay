/**
 * Plan 99: what is drawn round a caption's words, worked out once for the
 * Output view and the export alike: the box behind the caption, the glow, and,
 * when the word being said pops, each word at a place of its own.
 *
 * libass draws the export and a canvas draws the preview, and the two place
 * text a little differently, so anything whose place has to agree is placed
 * here, from the font's own widths, rather than measured by either.
 */

import { captionFontOf, type CaptionClip, type CaptionStyle } from './captions'
import { drawnWord, spacedWidth, type CaptionLayout } from './caption-layout'

/** How much bigger the word being said is drawn when it grows. */
export const POP_GROW = 1.25
/** Room between the words and the edge of the box behind them, in ems, outside the outline. */
const BOX_PAD = 0.25
/** The box's corners, in ems. */
const BOX_RADIUS = 0.2
/** The same for the box behind the word being said. */
const WORD_BOX_PAD = 0.12
const WORD_BOX_RADIUS = 0.15

/**
 * libass's `\blur b` is a Gaussian of this standard deviation times b, as its
 * source has it (`2 / sqrt(ln 256)`) and as this plan measured from its pixels:
 * a canvas blurs by the standard deviation, so it blurs by b times this.
 */
export const BLUR_SIGMA_PER_ASS = 2 / Math.sqrt(Math.log(256))

/** A rounded box, in frame pixels. */
export interface CaptionRect {
  x: number
  y: number
  w: number
  h: number
  radius: number
  colour: string
  opacity: number
}

/** One word drawn on its own: its text as drawn, its left edge and baseline in frame pixels, and how much bigger than the rest. */
export interface CaptionPiece {
  word: number
  text: string
  x: number
  baseline: number
  scale: number
  lit: boolean
}

export interface CaptionDrawing {
  /** The box behind the whole caption, or null. */
  box: CaptionRect | null
  /** The box behind the word being said, or null. */
  wordBox: CaptionRect | null
  /** The glow: how far its blur reaches, as libass's `\blur`, and its colour, in frame pixels; or null. */
  glow: { blur: number; colour: string } | null
  /** Every word on its own, when the word being said pops; null when the lines are drawn whole, as before. */
  pieces: CaptionPiece[] | null
}

/** Whether a style draws its captions a word at a time. */
export function popsWords(style: Pick<CaptionStyle, 'popGrow' | 'popBox'>): boolean {
  return style.popGrow === true || style.popBox === true
}

/**
 * What is drawn round caption `c`, laid out as `layout`, while word `lit` is
 * being said. The box behind the caption stays the same size whichever word is
 * lit, so it does not twitch as the words grow in turn.
 */
export function captionDrawing(c: CaptionClip, style: CaptionStyle, layout: CaptionLayout, lit: number): CaptionDrawing {
  const font = captionFontOf(style)
  const em = layout.fontPx
  const cap = font.capHeight * em
  const grow = style.popGrow === true ? POP_GROW : 1
  const widthOf = (k: number): number => spacedWidth(drawnWord(c.words[k]!.text, style), style) * em
  const space = spacedWidth(' ', style) * em

  const pieces: CaptionPiece[] | null = popsWords(style) ? [] : null
  // The widest a line can be: its words, and the widest of them grown.
  let widest = 0
  for (const line of layout.lines) {
    const widths = line.words.map(widthOf)
    const plain = widths.reduce((a, b) => a + b, 0) + space * Math.max(0, widths.length - 1)
    widest = Math.max(widest, plain + (grow - 1) * Math.max(0, ...widths))
    if (!pieces) continue
    const scales = line.words.map((k) => (k === lit ? grow : 1))
    const drawn = widths.reduce((a, w, i) => a + w * scales[i]!, 0) + space * Math.max(0, widths.length - 1)
    let x = layout.centerX - drawn / 2
    line.words.forEach((k, i) => {
      pieces.push({ word: k, text: drawnWord(c.words[k]!.text, style), x, baseline: line.baseline, scale: scales[i]!, lit: k === lit })
      x += widths[i]! * scales[i]! + space
    })
  }

  let box: CaptionRect | null = null
  if (style.box && layout.lines.length > 0) {
    const pad = BOX_PAD * em + layout.outlinePx
    const top = layout.lines[0]!.baseline - cap * grow - pad
    const bottom = layout.lines.at(-1)!.baseline + pad
    box = { x: layout.centerX - widest / 2 - pad, y: top, w: widest + 2 * pad, h: bottom - top, radius: BOX_RADIUS * em, colour: style.boxColour, opacity: style.boxOpacity }
  }

  let wordBox: CaptionRect | null = null
  const said = pieces?.find((p) => p.lit)
  if (style.popBox && said) {
    const pad = WORD_BOX_PAD * em * said.scale + layout.outlinePx
    const w = widthOf(said.word) * said.scale
    const h = cap * said.scale
    wordBox = { x: said.x - pad, y: said.baseline - h - pad, w: w + 2 * pad, h: h + 2 * pad, radius: WORD_BOX_RADIUS * em * said.scale, colour: style.popBoxColour, opacity: 1 }
  }

  return {
    box,
    wordBox,
    glow: style.glow > 0 ? { blur: style.glow * em, colour: style.glowColour } : null,
    pieces
  }
}
