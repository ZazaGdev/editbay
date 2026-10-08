/**
 * Where a caption goes on a frame: the caption fonts' widths, the words as
 * drawn, and the lines a caption is broken into, for the preview and the
 * export alike.
 */

import { DEFAULT_CAPTION_FONT, captionFont, type CaptionFont } from './caption-fonts'
import { type CaptionAt, type CaptionClip, type CaptionStyle, DEFAULT_CAPTION_STYLE, captionFontOf, styledWord } from './captions'

/** The font captions are written in unless another is chosen, bundled with the app so the preview and the export are the same. */
export const CAPTION_FONT = captionFont(DEFAULT_CAPTION_FONT).family
/** Its file, in the app's fonts folder. */
export const CAPTION_FONT_FILE = captionFont(DEFAULT_CAPTION_FONT).file


/** How wide some text is in a caption font, the default unless another is named, in ems. */
export function textWidth(text: string, font: CaptionFont = captionFont(DEFAULT_CAPTION_FONT)): number {
  let w = 0
  for (const ch of text) w += font.advance[ch] ?? font.averageAdvance
  return w / 1000
}

/**
 * libass sizes a font so its Windows ascent and descent together are the
 * size asked for: 1.109 and 0.453 of an em for Montserrat. A canvas sizes it
 * by its em. So an ASS font size is the em in pixels times this, which each
 * caption font has its own of.
 */
export const ASS_SIZE_PER_EM = captionFont(DEFAULT_CAPTION_FONT).assSizePerEm
/** How far apart the lines of one caption are, baseline to baseline, in ems. */
const LINE_PITCH = 1.15
/** A line of a caption keeps within this share of the frame's width. */
const LINE_SHARE = 0.9

/** One line of a caption as drawn: which of its words, and where its baseline is. */
export interface CaptionLine {
  /** Indexes into the caption's words. */
  words: number[]
  /** Pixels from the top of the frame. */
  baseline: number
}

/** Where a caption goes in a frame: the size of its letters and outline, the middle of its lines, and each line. */
export interface CaptionLayout {
  fontPx: number
  outlinePx: number
  centerX: number
  /** How wide its widest line is drawn, and how tall its lines are together, in frame pixels. */
  width: number
  height: number
  /** Where its middle is, down the frame, in frame pixels. */
  middle: number
  lines: CaptionLine[]
}

/** The box a caption's words take on the frame, in frame pixels: what a press on it lands in. */
export function captionBox(layout: CaptionLayout): { x: number; y: number; w: number; h: number } {
  return { x: layout.centerX - layout.width / 2, y: layout.middle - layout.height / 2, w: layout.width, h: layout.height }
}

/** A position on the frame held inside it, or null for one that is not a position at all. */
export function cleanCaptionAt(raw: unknown): CaptionAt | null {
  const x = raw as Partial<CaptionAt> | null
  if (typeof x !== 'object' || x === null || typeof x.x !== 'number' || typeof x.y !== 'number') return null
  if (!Number.isFinite(x.x) || !Number.isFinite(x.y)) return null
  const held = (n: number): number => Math.min(1, Math.max(0, n))
  return { x: held(x.x), y: held(x.y) }
}

/**
 * A word as it is drawn: in capitals when the style says so, without what the
 * subtitle format takes as commands. A line break would end the line of the
 * subtitle file the word is on and start one of the word's choosing, so it
 * becomes a space.
 */
export function drawnWord(text: string, style: CaptionStyle): string {
  return styledWord(text, style).replace(/[{}\\]/g, '').replace(/[\r\n]+/g, ' ')
}

/**
 * How wide some caption text is in the style's font, in ems, with its letter
 * spacing, which comes after every letter, a space's too, as libass and the
 * canvas both add it.
 */
export function spacedWidth(text: string, style: Pick<CaptionStyle, 'font' | 'pcFont' | 'spacing'>): number {
  return textWidth(text, captionFontOf(style)) + [...text].length * (style.spacing ?? 0)
}

/**
 * Where a caption goes in a frame of this size. Its words are broken into
 * lines that keep within the frame, each line centred, and the lines together
 * centred on the style's height in the frame, a capital's middle on it.
 */
export function layoutCaption(c: CaptionClip, style: CaptionStyle, frameW: number, frameH: number): CaptionLayout {
  const font = captionFontOf(style)
  const spaced = (text: string): number => spacedWidth(text, style)
  const asked = style.size * frameH
  const room = (LINE_SHARE * frameW) / asked
  const lines: number[][] = []
  const widths: number[] = []
  const space = spaced(' ')
  c.words.forEach((w, i) => {
    const own = spaced(drawnWord(w.text, style))
    const line = lines.at(-1)
    const width = widths.at(-1) ?? 0
    if (line && width + space + own <= room) {
      line.push(i)
      widths[widths.length - 1] = width + space + own
    } else {
      lines.push([i])
      widths.push(own)
    }
  })
  // A word too long for a line on its own, as a long one in capitals can be, makes the whole caption smaller to fit.
  const fontPx = asked * Math.min(1, room / Math.max(0, ...widths))
  const middle = (c.at?.y ?? style.height) * frameH
  const pitch = LINE_PITCH * fontPx
  return {
    fontPx,
    outlinePx: (style.outline ?? DEFAULT_CAPTION_STYLE.outline) * fontPx,
    centerX: (c.at?.x ?? style.across) * frameW,
    // Widths are measured in the font's own size, so a line is that many font sizes wide.
    width: Math.max(0, ...widths) * fontPx,
    height: lines.length * pitch,
    middle,
    lines: lines.map((words, i) => ({ words, baseline: middle + (i - (lines.length - 1) / 2) * pitch + (font.capHeight * fontPx) / 2 }))
  }
}
