/**
 * How a sequence's captions look: the settings, their defaults, the choices
 * offered, and making a stored or edited style safe. Moved out of
 * `captions.ts`, which re-exports all of it (plan 99).
 */

import { CAPTION_FONTS, DEFAULT_CAPTION_FONT, captionFont, type CaptionFont } from './caption-fonts'
import type { FontFigures } from './font-file'

/** How a sequence's captions look, one setting for all of them. */
export interface CaptionStyle {
  /** How tall the letters are, as a share of the frame's height. */
  size: number
  /** Where the middle of a caption sits, as a share of the frame's height from the top. */
  height: number
  /** And across, as a share of its width from the left: the middle unless Relocate moved them. */
  across: number
  /** At most this many words in a caption, 1 to 5. */
  wordsPerCaption: number
  capitals: boolean
  /** The colour of the word being said, as #RRGGBB. The others are `wordColour`. */
  highlight: string
  /** Plan 76: which bundled font, from `CAPTION_FONTS`, by its id. */
  font: string
  /** The colour of every word but the one being said, as #RRGGBB. */
  wordColour: string
  /** How thick the outline round each letter is, as a share of the letters' size: 0 for none. */
  outline: number
  /** The outline's colour, as #RRGGBB. */
  outlineColour: string
  /**
   * Plan 87: a font from this PC in place of the bundled one, with the figures
   * the layout needs read from its file when it was chosen. They travel with
   * the project, so the captions break and fit the same on any computer.
   */
  pcFont?: FontFigures
  /** How far the shadow falls, down and to the right, as a share of the letters' size: 0 for none. */
  shadow: number
  /** The shadow's colour, as #RRGGBB. */
  shadowColour: string
  /** Room added after every letter, as a share of the letters' size: 0 as the font has it. */
  spacing: number
  /** Plan 99: a rounded box behind the whole caption, its colour, and how much of it is drawn, 0 to 1. */
  box: boolean
  boxColour: string
  boxOpacity: number
  /** A blurred glow round the letters, how far it reaches as a share of the letters' size: 0 for none. */
  glow: number
  glowColour: string
  /** The word being said drawn bigger than the rest. */
  popGrow: boolean
  /** The word being said with a box of its own behind it, in this colour. */
  popBox: boolean
  popBoxColour: string
}

/**
 * Big and bold near the lower middle of a vertical frame: 7% of its height,
 * which is 134 pixels in 1920, centred 65% of the way down, just above what
 * TikTok, Reels and Shorts cover at the bottom.
 */
export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  size: 0.07,
  height: 0.65,
  across: 0.5,
  wordsPerCaption: 3,
  capitals: true,
  highlight: '#FFD400',
  font: DEFAULT_CAPTION_FONT,
  wordColour: '#FFFFFF',
  outline: 0.08,
  outlineColour: '#000000',
  shadow: 0,
  shadowColour: '#000000',
  spacing: 0,
  box: false,
  boxColour: '#000000',
  boxOpacity: 0.6,
  glow: 0,
  glowColour: '#FFD400',
  popGrow: false,
  popBox: false,
  popBoxColour: '#7C3AED'
}

/** A change to how captions look: `pcFont` null goes back to the bundled font the style names. */
export type CaptionStyleChange = Partial<Omit<CaptionStyle, 'pcFont'>> & { pcFont?: FontFigures | null }

/** The shadow distances offered, as shares of the letters' size. */
export const CAPTION_SHADOWS: { shadow: number; name: string }[] = [
  { shadow: 0, name: 'None' },
  { shadow: 0.04, name: 'Near' },
  { shadow: 0.08, name: 'Medium' },
  { shadow: 0.14, name: 'Far' }
]

/** The letter spacings offered, as shares of the letters' size. */
export const CAPTION_SPACINGS: { spacing: number; name: string }[] = [
  { spacing: -0.03, name: 'Tight' },
  { spacing: 0, name: 'Normal' },
  { spacing: 0.05, name: 'Wide' },
  { spacing: 0.12, name: 'Wider' }
]

/** The most a shadow may fall, and the least and most letter spacing, as shares of the letters' size. */
const MAX_SHADOW = 0.3
const MIN_SPACING = -0.1
const MAX_SPACING = 0.5

/** The glows offered, as shares of the letters' size: how far the blur reaches. */
export const CAPTION_GLOWS: { glow: number; name: string }[] = [
  { glow: 0, name: 'None' },
  { glow: 0.12, name: 'Soft' },
  { glow: 0.25, name: 'Strong' }
]
/** The furthest a glow may reach: past this libass takes long to blur each word. */
const MAX_GLOW = 0.34

/** The font a style draws in: the PC font it carries, or the bundled one it names. */
export function captionFontOf(style: Pick<CaptionStyle, 'font' | 'pcFont'>): CaptionFont {
  if (style.pcFont) return { ...style.pcFont, id: 'pc', label: style.pcFont.family, file: '' }
  return captionFont(style.font)
}

/** A PC font's figures as a style keeps them, or undefined when they are not whole. */
function cleanPcFont(raw: unknown): FontFigures | undefined {
  const x = raw as Partial<FontFigures> | null
  if (typeof x !== 'object' || x === null) return undefined
  const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 10_000
  if (typeof x.family !== 'string' || x.family.trim() === '' || /[,\r\n{}]/.test(x.family)) return undefined
  if (!number(x.capHeight) || !number(x.assSizePerEm) || !number(x.assDescent) || !number(x.averageAdvance)) return undefined
  if (typeof x.advance !== 'object' || x.advance === null) return undefined
  const advance: Record<string, number> = {}
  for (const [ch, n] of Object.entries(x.advance)) if ([...ch].length === 1 && typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 10_000) advance[ch] = n
  return { family: x.family, capHeight: x.capHeight, assSizePerEm: x.assSizePerEm, assDescent: x.assDescent, averageAdvance: x.averageAdvance, advance }
}

/** The outline thicknesses offered, as shares of the letters' size. Medium is how captions always were. */
export const CAPTION_OUTLINES: { outline: number; name: string }[] = [
  { outline: 0, name: 'None' },
  { outline: 0.05, name: 'Thin' },
  { outline: 0.08, name: 'Medium' },
  { outline: 0.12, name: 'Thick' }
]
/** The thickest an outline may be: past this the letters close up. */
const MAX_OUTLINE = 0.2

/**
 * The highlight colours offered, which are the caption's own data rather than
 * the window's. Any other colour can be picked beside them.
 */
export const HIGHLIGHT_COLOURS: { colour: string; name: string }[] = [
  { colour: '#FFD400', name: 'Yellow' },
  { colour: '#4DFF7C', name: 'Green' },
  { colour: '#3FD7FF', name: 'Blue' },
  { colour: '#FF4FA3', name: 'Pink' }
]

export const MIN_WORDS_PER_CAPTION = 1
export const MAX_WORDS_PER_CAPTION = 5

/**
 * How captions look, setting by setting, from something that may not be
 * whole, as a file or an edit gives it: any setting that cannot be used is
 * the default, since it is only how they look.
 */
export function cleanCaptionStyle(raw: unknown): CaptionStyle {
  const x = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<CaptionStyle>
  const d = DEFAULT_CAPTION_STYLE
  const share = (v: unknown, fallback: number): number => (typeof v === 'number' && v > 0 && v < 1 ? v : fallback)
  const words = typeof x.wordsPerCaption === 'number' ? Math.round(x.wordsPerCaption) : NaN
  const colour = (v: unknown, fallback: string): string => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : fallback)
  const pcFont = cleanPcFont(x.pcFont)
  return {
    size: share(x.size, d.size),
    height: share(x.height, d.height),
    across: share(x.across, d.across),
    wordsPerCaption: words >= MIN_WORDS_PER_CAPTION && words <= MAX_WORDS_PER_CAPTION ? words : d.wordsPerCaption,
    capitals: typeof x.capitals === 'boolean' ? x.capitals : d.capitals,
    highlight: colour(x.highlight, d.highlight),
    // A font this build does not have is drawn in the default rather than failing.
    font: CAPTION_FONTS.some((f) => f.id === x.font) ? (x.font as string) : d.font,
    wordColour: colour(x.wordColour, d.wordColour),
    outline: typeof x.outline === 'number' && Number.isFinite(x.outline) && x.outline >= 0 ? Math.min(MAX_OUTLINE, x.outline) : d.outline,
    outlineColour: colour(x.outlineColour, d.outlineColour),
    ...(pcFont ? { pcFont } : {}),
    shadow: typeof x.shadow === 'number' && Number.isFinite(x.shadow) && x.shadow >= 0 ? Math.min(MAX_SHADOW, x.shadow) : d.shadow,
    shadowColour: colour(x.shadowColour, d.shadowColour),
    spacing: typeof x.spacing === 'number' && Number.isFinite(x.spacing) ? Math.min(MAX_SPACING, Math.max(MIN_SPACING, x.spacing)) : d.spacing,
    box: typeof x.box === 'boolean' ? x.box : d.box,
    boxColour: colour(x.boxColour, d.boxColour),
    boxOpacity: typeof x.boxOpacity === 'number' && Number.isFinite(x.boxOpacity) ? Math.min(1, Math.max(0, x.boxOpacity)) : d.boxOpacity,
    glow: typeof x.glow === 'number' && Number.isFinite(x.glow) && x.glow >= 0 ? Math.min(MAX_GLOW, x.glow) : d.glow,
    glowColour: colour(x.glowColour, d.glowColour),
    popGrow: typeof x.popGrow === 'boolean' ? x.popGrow : d.popGrow,
    popBox: typeof x.popBox === 'boolean' ? x.popBox : d.popBox,
    popBoxColour: colour(x.popBoxColour, d.popBoxColour)
  }
}
