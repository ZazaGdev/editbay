import { CAPTION_FONT } from './captions'
import { BLUR_SIGMA_PER_ASS } from './caption-drawing'

/**
 * Text over the video: its words and how they look. A text is drawn by the
 * window into a picture, which everything after that treats as any other, so
 * the preview and the export show the same pixels.
 */

export type TextAlign = 'left' | 'center' | 'right'

export interface TextStyle {
  /** The words, a line to each line break. */
  text: string
  /** A font family, as the window names it. */
  font: string
  bold: boolean
  italic: boolean
  /** The letters' size, in output pixels. */
  size: number
  colour: string
  /** An outline round every letter, this wide in output pixels. 0 for none. */
  outlineWidth: number
  outlineColour: string
  /** A shadow under the letters, or none. */
  shadow: boolean
  shadowColour: string
  shadowBlur: number
  shadowX: number
  shadowY: number
  /** A box behind the words, or none. */
  box: boolean
  boxColour: string
  /** How much of the box is drawn, 0 to 1. */
  boxOpacity: number
  boxRadius: number
  /** Room between the words and the box's edge, in output pixels. */
  boxPadding: number
  align: TextAlign
  /** The distance from one line to the next, as a multiple of the size. */
  lineSpacing: number
  /** Plan 99: a blurred glow round the letters, its colour, and how far it reaches in output pixels. */
  glow: boolean
  glowColour: string
  glowSize: number
}

/** What a new text starts as: white words with a black outline, readable over anything. */
export const DEFAULT_TEXT: TextStyle = {
  text: 'Your text',
  font: CAPTION_FONT,
  bold: false,
  italic: false,
  size: 96,
  colour: '#ffffff',
  outlineWidth: 6,
  outlineColour: '#000000',
  shadow: false,
  shadowColour: '#000000',
  shadowBlur: 12,
  shadowX: 0,
  shadowY: 6,
  box: false,
  boxColour: '#000000',
  boxOpacity: 0.6,
  boxRadius: 16,
  boxPadding: 24,
  align: 'center',
  lineSpacing: 1.15,
  glow: false,
  glowColour: '#ffd400',
  glowSize: 24
}

/** The smallest and largest a text may be, in output pixels. */
export const TEXT_MIN_SIZE = 8
export const TEXT_MAX_SIZE = 800

const COLOUR = /^#[0-9a-f]{6}$/i

function num(v: unknown, fallback: number, low: number, high: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(high, Math.max(low, v)) : fallback
}

function colour(v: unknown, fallback: string): string {
  return typeof v === 'string' && COLOUR.test(v) ? v.toLowerCase() : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/**
 * A text's style made safe, as a stored one is when a project is read, or a
 * change is before it is kept: anything missing or out of range takes the
 * default, so a damaged text still draws.
 */
export function cleanTextStyle(raw: unknown): TextStyle {
  const x = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof TextStyle, unknown>>
  const d = DEFAULT_TEXT
  return {
    text: typeof x.text === 'string' ? x.text.replace(/\r\n?/g, '\n').slice(0, 2000) : d.text,
    font: typeof x.font === 'string' && x.font.trim() !== '' ? x.font.trim().slice(0, 100) : d.font,
    bold: bool(x.bold, d.bold),
    italic: bool(x.italic, d.italic),
    size: Math.round(num(x.size, d.size, TEXT_MIN_SIZE, TEXT_MAX_SIZE)),
    colour: colour(x.colour, d.colour),
    outlineWidth: num(x.outlineWidth, d.outlineWidth, 0, 100),
    outlineColour: colour(x.outlineColour, d.outlineColour),
    shadow: bool(x.shadow, d.shadow),
    shadowColour: colour(x.shadowColour, d.shadowColour),
    shadowBlur: num(x.shadowBlur, d.shadowBlur, 0, 200),
    shadowX: num(x.shadowX, d.shadowX, -200, 200),
    shadowY: num(x.shadowY, d.shadowY, -200, 200),
    box: bool(x.box, d.box),
    boxColour: colour(x.boxColour, d.boxColour),
    boxOpacity: num(x.boxOpacity, d.boxOpacity, 0, 1),
    boxRadius: num(x.boxRadius, d.boxRadius, 0, 400),
    boxPadding: num(x.boxPadding, d.boxPadding, 0, 400),
    align: x.align === 'left' || x.align === 'right' || x.align === 'center' ? x.align : d.align,
    lineSpacing: num(x.lineSpacing, d.lineSpacing, 0.5, 3),
    glow: bool(x.glow, d.glow),
    glowColour: colour(x.glowColour, d.glowColour),
    glowSize: num(x.glowSize, d.glowSize, 1, 200)
  }
}

/**
 * The room a text's picture leaves round its box for what is drawn outside
 * the letters, the outline, the shadow and the glow, in output pixels. A glow
 * reaches past its widened outline by about three of its blur's standard
 * deviations (plan 99). Pure, so moving a text can allow for it changing.
 */
export function textMargin(style: TextStyle): number {
  const outline = Math.max(style.outlineWidth, 0)
  const shadow = style.shadow ? style.shadowBlur + Math.max(Math.abs(style.shadowX), Math.abs(style.shadowY)) : 0
  const glow = style.glow ? style.glowSize / 2 + 3 * style.glowSize * BLUR_SIGMA_PER_ASS : 0
  return Math.ceil(outline + Math.max(shadow, glow))
}

/**
 * A text scaled by `k`, as dragging a corner of its box scales it: the size
 * and everything measured in pixels with it, so it looks the same, larger.
 */
export function scaledText(style: TextStyle, k: number): TextStyle {
  if (!(k > 0)) return style
  return cleanTextStyle({
    ...style,
    size: style.size * k,
    outlineWidth: style.outlineWidth * k,
    shadowBlur: style.shadowBlur * k,
    shadowX: style.shadowX * k,
    shadowY: style.shadowY * k,
    boxRadius: style.boxRadius * k,
    boxPadding: style.boxPadding * k,
    glowSize: style.glowSize * k
  })
}

/**
 * The name a text's picture is kept under: the same for the same words and
 * style, whichever window drew it, so drawing it again finds it there.
 * FNV-1a over the style's JSON, in a fixed key order.
 */
export function textKey(style: TextStyle): string {
  const clean = cleanTextStyle(style)
  const json = JSON.stringify(Object.keys(clean).sort().map((k) => [k, clean[k as keyof TextStyle]]))
  let h = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // Two halves, so two different texts sharing one name is not a practical worry.
  let g = 0x6c62272e
  for (let i = json.length - 1; i >= 0; i--) {
    g ^= json.charCodeAt(i)
    g = Math.imul(g, 0x01000193) >>> 0
  }
  return `${h.toString(16).padStart(8, '0')}${g.toString(16).padStart(8, '0')}`
}

/** What a text is called on the timeline: its first line, or "Text" when it has none. */
export function textName(style: TextStyle): string {
  const first = style.text.split('\n').find((l) => l.trim() !== '')?.trim() ?? ''
  if (first === '') return 'Text'
  return first.length > 40 ? `${first.slice(0, 39)}…` : first
}
