/**
 * Captions written out as files: an SRT subtitle file, a transcript to read,
 * and the ASS subtitle file ffmpeg draws them onto the picture with.
 */

import { type CaptionClip, type CaptionStyle, type TimedWord, DEFAULT_CAPTION_STYLE, captionEnd, captionFontOf, wordsOf } from './captions'
import { drawnWord, layoutCaption } from './caption-layout'
import { captionDrawing, type CaptionRect } from './caption-drawing'

/** A colour as ASS writes it: blue, green, red. */
function assColour(hex: string): string {
  const h = hex.replace('#', '')
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase()
}

/** How much of something is not drawn, as ASS writes it: 00 for all of it, FF for none. */
function assAlpha(opacity: number): string {
  return `&H${Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255).toString(16).toUpperCase().padStart(2, '0')}&`
}

/** Bezier handles for a quarter circle, as a share of its radius. */
const KAPPA = 0.5523

/**
 * A rounded box as an ASS drawing event's text (plan 99): drawn from its own
 * top left at (0, 0) and placed with `\an7\pos`, which lands it to the pixel,
 * with no outline or shadow of its own.
 */
function assBox(r: CaptionRect): string {
  const round = (n: number): number => Math.round(n * 100) / 100
  const w = round(r.w)
  const h = round(r.h)
  const k = round(Math.max(0, Math.min(r.radius, w / 2, h / 2)))
  const c = round(k * (1 - KAPPA))
  const path =
    k === 0
      ? `m 0 0 l ${w} 0 ${w} ${h} 0 ${h}`
      : `m ${k} 0 l ${round(w - k)} 0 b ${round(w - c)} 0 ${w} ${c} ${w} ${k} l ${w} ${round(h - k)} b ${w} ${round(h - c)} ${round(w - c)} ${h} ${round(w - k)} ${h} ` +
        `l ${k} ${h} b ${c} ${h} 0 ${round(h - c)} 0 ${round(h - k)} l 0 ${k} b 0 ${c} ${c} 0 ${k} 0`
  return `{\\an7\\pos(${round(r.x)},${round(r.y)})\\bord0\\shad0\\1c${assColour(r.colour)}\\1a${assAlpha(r.opacity)}\\p1}${path}{\\p0}`
}

/** A time in seconds as ASS writes it, to the hundredth. */
function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

/**
 * The captions over a stretch of the sequence, `from` to `to`, as an SRT
 * subtitle file whose times count from `from`, or null when no caption is
 * over it. One entry a caption, cut to the stretch, in its words as typed:
 * a platform's player draws subtitles in its own style, so the capitals a
 * caption style asks for are not the words.
 */
export function captionsSrt(opts: { clips: CaptionClip[]; from: number; to: number; fps: number }): string | null {
  const { from, to, fps } = opts
  const over = opts.clips
    .filter((c) => c.timelineStart < to && captionEnd(c) > from && c.words.length > 0)
    .sort((a, b) => a.timelineStart - b.timelineStart)
  if (over.length === 0) return null
  const at = (frame: number): string => {
    const ms = Math.round(((frame - from) * 1000) / fps)
    const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
    return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
  }
  return over
    .map((c, i) => `${i + 1}\n${at(Math.max(from, c.timelineStart))} --> ${at(Math.min(to, captionEnd(c)))}\n${c.words.map((w) => w.text).join(' ')}\n`)
    .join('\n')
}

/** A pause at least this long between two words starts a new paragraph of a transcript. */
const PARAGRAPH_PAUSE_SEC = 1.5
/** A paragraph of a transcript this many words long ends at the next sentence end, pause or not. */
const PARAGRAPH_WORDS = 80

/**
 * The words of the captions said over a stretch of the sequence as a
 * transcript, as typed, not in the short pieces a caption shows; or null
 * when none is said over it.
 */
export function captionsTranscript(opts: { clips: CaptionClip[]; from: number; to: number; fps: number }): string | null {
  return transcriptOf(wordsOf(opts.clips), opts.from, opts.to, opts.fps)
}

/**
 * Words said over a stretch of the sequence, `from` to `to`, as plain text to
 * read, or null when none is said over it. Every word as it is, one after
 * another: a new paragraph at a long pause, or at the first sentence end of
 * one that has run long, so a video with its silences cut out is not one
 * block of text.
 */
export function transcriptOf(said: TimedWord[], from: number, to: number, fps: number): string | null {
  const words = [...said].sort((a, b) => a.start - b.start).filter((w) => w.start >= from && w.start < to && w.text.trim() !== '')
  if (words.length === 0) return null
  const paragraphs: string[][] = [[]]
  words.forEach((w, i) => {
    const last = paragraphs.at(-1)!
    const before = words[i - 1]
    const pause = before ? (w.start - (before.start + before.length)) / fps : 0
    const long = last.length >= PARAGRAPH_WORDS && /[.!?]["')\]]*$/.test(last.at(-1) ?? '')
    if (last.length > 0 && (pause >= PARAGRAPH_PAUSE_SEC || long)) paragraphs.push([w.text.trim()])
    else last.push(w.text.trim())
  })
  return paragraphs.map((p) => p.join(' ')).join('\n\n') + '\n'
}

/**
 * The captions over a stretch of the sequence, `from` to `to`, as an ASS
 * subtitle file whose times count from `from`, for ffmpeg's `ass` filter to
 * draw over a frame of this size; or null when no caption is over it. Each
 * word is one event for as long as it is lit, the whole caption with that
 * word in the highlight colour, each line of it placed as the preview places
 * it. An event starts and ends half way between frames, so rounding to the
 * hundredth never moves it onto the wrong frame.
 */
export function captionsAss(opts: { clips: CaptionClip[]; style: CaptionStyle; from: number; to: number; fps: number; width: number; height: number }): string | null {
  const { style, from, to, fps, width, height } = opts
  const over = opts.clips.filter((c) => c.timelineStart < to && captionEnd(c) > from && c.words.length > 0)
  if (over.length === 0) return null
  const events: string[] = []
  const font = captionFontOf(style)
  const base = style.size * height
  // Shadow and letter spacing are shares of the letters' size, as the outline is (plan 87).
  const shadowShare = style.shadow ?? DEFAULT_CAPTION_STYLE.shadow
  const spacingShare = style.spacing ?? DEFAULT_CAPTION_STYLE.spacing
  const round2 = (n: number): number => Math.round(n * 100) / 100
  const words = assColour(style.wordColour ?? DEFAULT_CAPTION_STYLE.wordColour)
  const lit = assColour(style.highlight)
  const at = (frame: number): string => assTime((frame - from - 0.5) / fps)
  const round1 = (n: number): number => Math.round(n * 10) / 10
  for (const c of over) {
    const layout = layoutCaption(c, style, width, height)
    // Its own size and outline where the layout made it smaller, as for a word too long for a line.
    const own =
      layout.fontPx === base
        ? ''
        : `\\fs${round2(layout.fontPx * font.assSizePerEm)}\\bord${round2(layout.outlinePx)}${shadowShare > 0 ? `\\shad${round2(shadowShare * layout.fontPx)}` : ''}${spacingShare !== 0 ? `\\fsp${round2(spacingShare * layout.fontPx)}` : ''}`
    // Plan 99: the box behind the whole caption, the same whichever word is lit, under everything else for as long as it shows.
    const box = captionDrawing(c, style, layout, 0).box
    const shown = { s: Math.max(from, c.timelineStart), e: Math.min(to, captionEnd(c)) }
    if (box && shown.e > shown.s) events.push(`Dialogue: 0,${at(shown.s)},${at(shown.e)},Caption,,0,0,0,,${assBox(box)}`)
    c.words.forEach((_, i) => {
      const start = c.timelineStart + (i === 0 ? 0 : c.words[i]!.start)
      const end = i === c.words.length - 1 ? captionEnd(c) : c.timelineStart + c.words[i + 1]!.start
      const s = Math.max(from, start)
      const e = Math.min(to, end)
      if (e <= s) return
      const event = (text: string): number => events.push(`Dialogue: 0,${at(s)},${at(e)},Caption,,0,0,0,,${text}`)
      const drawing = captionDrawing(c, style, layout, i)
      // The words again in the glow's colour, their outline widened by half the glow and blurred, under the words.
      const glow = drawing.glow
        ? `\\1c${assColour(drawing.glow.colour)}\\3c${assColour(drawing.glow.colour)}\\bord${round2(layout.outlinePx + drawing.glow.blur / 2)}\\shad0\\blur${round2(drawing.glow.blur)}`
        : null
      if (drawing.pieces) {
        // A word at a time, each from its left edge on the baseline, the grown one scaled from there (plan 99).
        const placed = (p: { x: number; baseline: number; scale: number }): string =>
          `\\an1\\pos(${round1(p.x)},${round1(p.baseline + font.assDescent * layout.fontPx * p.scale)})${own}${p.scale === 1 ? '' : `\\fscx${round2(p.scale * 100)}\\fscy${round2(p.scale * 100)}`}`
        if (glow) for (const p of drawing.pieces) event(`{${placed(p)}${glow}}${p.text}`)
        // The box behind the word being said over the glow, so the glow never hides it.
        if (drawing.wordBox) event(assBox(drawing.wordBox))
        for (const p of drawing.pieces) event(`{${placed(p)}${p.lit ? `\\c${lit}` : ''}}${p.text}`)
        return
      }
      const x = round1(layout.centerX)
      const y = (line: { baseline: number }): number => round1(line.baseline + font.assDescent * layout.fontPx)
      if (glow) for (const line of layout.lines) event(`{\\an2\\pos(${x},${y(line)})${own}${glow}}${line.words.map((k) => drawnWord(c.words[k]!.text, style)).join(' ')}`)
      for (const line of layout.lines) {
        const text = line.words
          .map((k) => (k === i ? `{\\c${lit}}${drawnWord(c.words[k]!.text, style)}{\\c${words}}` : drawnWord(c.words[k]!.text, style)))
          .join(' ')
        event(`{\\an2\\pos(${x},${y(line)})${own}}${text}`)
      }
    })
  }
  const size = round2(base * font.assSizePerEm)
  const outline = round2((style.outline ?? DEFAULT_CAPTION_STYLE.outline) * base)
  const shadow = round2(shadowShare * base)
  const spacing = round2(spacingShare * base)
  // In the style line a colour is alpha, blue, green, red: opaque.
  const styleColour = (hex: string): string => `&H00${assColour(hex).slice(2, 8)}`
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    // Kerned, as the preview's canvas is: libass leaves it off unless asked.
    'Kerning: yes',
    'ScaledBorderAndShadow: yes',
    // The colours as written, on the RGB picture they are drawn on. Left
    // unsaid, ffmpeg 9 takes them for TV range and squeezes them, and the
    // yellow came out 21 levels dull (plan 89).
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${font.family},${size},${styleColour(style.wordColour ?? DEFAULT_CAPTION_STYLE.wordColour)},&H00FFFFFF,${styleColour(style.outlineColour ?? DEFAULT_CAPTION_STYLE.outlineColour)},${styleColour(style.shadowColour ?? DEFAULT_CAPTION_STYLE.shadowColour)},0,0,0,0,100,100,${spacing},0,1,${outline},${shadow},2,0,0,0,1`,

    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    ''
  ].join('\n')
}
