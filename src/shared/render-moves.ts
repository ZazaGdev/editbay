/**
 * How a picture moves through its zoom keyframes in an export: the crop
 * worked out per frame as ffmpeg expressions, and the filters that cut it out.
 */

import type { Ease, Rect, ZoomKey } from './project'
import { moves } from './crop-geometry'

/**
 * How many times the output's own pixels a move is worked out in.
 *
 * `zoompan` is the only filter in the bundled ffmpeg that can move a crop, and
 * it rounds to whole pixels. A slow zoom moves less than a pixel a frame, so
 * on its own it holds the picture still and then jumps it. Measured on a 2%
 * zoom over 8 seconds: three quarters of the frames identical to the one
 * before, with holds of up to seven frames.
 *
 * Working four times over and scaling back down does the interpolation
 * `zoompan` will not: the same measurement gives holds of two frames, each a
 * quarter the size. It costs about two and a half times real time, and only
 * for the clips that move.
 *
 * Four times the **output**, not the recording: what has to look smooth is
 * what comes out, so a 1080 wide export works at 4320 whatever the recording
 * is, rather than scaling a 4K source to something no machine will filter.
 */
const MOVE_DETAIL = 4
/**
 * The widest that window is allowed to be (audit 2026-10-01). A 4K picture
 * under Handoff asked for 15360 pixels, some 200 MB a frame; at 7680 a 4K
 * zoom still steps by half a pixel, and an HD one by a quarter as before.
 */
const MOVE_WINDOW_MOST = 7680

/** An ffmpeg expression, with no spaces in it, since a filter graph is comma separated. */
function expr(parts: TemplateStringsArray, ...values: (string | number)[]): string {
  return parts.reduce((out, part, i) => out + part + (values[i] ?? ''), '').replace(/\s+/g, '')
}

/**
 * The filters that move a clip's picture through its zoom keyframes, in place
 * of the fixed `crop` a still clip gets.
 *
 * The crop is worked out per frame from the same arithmetic the preview draws
 * by, `cropAtKeys`: before the first keyframe its crop, after the last its
 * crop, and in between the two either side, each of x, y and w moved by the
 * eased fraction. Written for ffmpeg as one expression per coordinate, with
 * the frame counted on the recording, so a zoom lands on the same picture
 * whichever piece of the export it falls in. A Jump is the same formula with
 * no movement until the next keyframe, so a cut and a slow move are one code
 * path here as they are everywhere else.
 *
 * `zoompan` magnifies its input and takes a window of it, so the numbers are
 * turned inside out: the magnification is how many times the window covers the
 * crop, and the window's corner is the crop's corner in the input's pixels,
 * which are already magnified by the scale before it. Not multiplied by the
 * zoom as well: that put every move's end off to the right and down, by a tenth
 * of its offset on a punch-in and by the whole of it on a zoom to one side.
 */
function movingFilters(fps: number, keys: readonly ZoomKey[], move: Move, width: number): string[] {
  // Everything the move ever shows in this piece, cut out first. `zoompan`
  // has to magnify its whole input, so handing it the recording would mean
  // scaling a 1920 wide frame to thirteen thousand to move inside a slice of
  // it. Cut to the slice and the same precision costs a third as much.
  const seen = keys.slice(1).reduce((u, k) => union(u, k.crop), union(keys[0]!.crop, keys[0]!.crop))
  const local = keys.map((k) => ({ ...k, crop: { x: k.crop.x - seen.x, y: k.crop.y - seen.y, w: k.crop.w, h: k.crop.h } }))

  // The window the move is worked out in, and how far the cut-out is magnified
  // so the widest crop fills it exactly. A step of the window is a quarter of
  // an output pixel, which is what makes a slow zoom smooth.
  const wide = Math.max(...local.map((k) => k.crop.w))
  const tall = Math.max(...local.map((k) => k.crop.h))
  const windowW = even(Math.min(MOVE_DETAIL * width, MOVE_WINDOW_MOST))
  const windowH = even((windowW * tall) / wide)
  const detail = Math.max(1, windowW / wide)
  const times = detail.toFixed(6)

  const f = recordingFrame(move.first)
  return [
    `crop=${seen.w}:${seen.h}:${seen.x}:${seen.y}`,
    `scale=iw*${times}:ih*${times}:flags=bicubic`,
    `zoompan=` +
      [
        `z='${windowW}/((${keyedExpression(f, local, 'w')})*${times})'`,
        // In the magnified input's own pixels, which is where `zoompan` takes its window from.
        `x='(${keyedExpression(f, local, 'x')})*${times}'`,
        `y='(${keyedExpression(f, local, 'y')})*${times}'`,
        `d=1`,
        `s=${windowW}x${windowH}`,
        `fps=${fps}`
      ].join(':')
  ]
}

/**
 * The recording's frame as an ffmpeg expression: `zoompan`'s own count of
 * the frames of this piece, `on`, plus the recording's frame the piece
 * starts on. A piece that opens before the recording, where a transition
 * reaches back past its first frame, starts below it and holds the first
 * keyframe's crop until it gets there.
 */
export function recordingFrame(first: number): string {
  return first === 0 ? 'on' : `(on${first > 0 ? '+' : ''}${first})`
}

/** How far through a stretch between keyframes, as `easeOf` has it, for a fraction `t` written as an expression. */
function easeExpression(ease: Ease | undefined, t: string): string {
  switch (ease) {
    case 'linear':
      return `(${t})`
    case 'in':
      return `(${t})*(${t})`
    case 'out':
      return `(1-(1-(${t}))*(1-(${t})))`
    default:
      return `(${t})*(${t})*(3-2*(${t}))`
  }
}

/**
 * One coordinate of the crop on frame `f`, as `cropAtKeys` works it out: the
 * first keyframe's before it, the last's after it, and between two the one
 * before moved towards the one after by its ease.
 *
 * A sum of one term per stretch, each nothing outside its own frames, rather
 * than one `if` nested in the next: ffmpeg's expression parser refuses
 * brackets nested much past a hundred deep, which a nested chain reaches at
 * about a hundred keyframes, and a sum is as deep for two as for two hundred.
 * Exactly one term is not nothing on any frame, so adding the zeros changes
 * nothing.
 */
export function keyedExpression(f: string, keys: readonly ZoomKey[], coord: 'x' | 'y' | 'w'): string {
  return keyedValue(f, keys, (k) => k.crop[coord])
}

/**
 * Any number keyframes carry, on frame `f`, worked out as `keyedExpression`
 * works out a crop's: also how a box moves and fades (plan 97).
 */
export function keyedValue<K extends { at: number; ease?: Ease }>(f: string, keys: readonly K[], value: (k: K) => number): string {
  const first = keys[0]!
  const last = keys[keys.length - 1]!
  if (keys.length === 1) return String(value(first))
  const terms = [expr`if(lt(${f},${first.at}),${value(first)},0)`]
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!
    const b = keys[i + 1]!
    const from = value(a)
    const to = value(b)
    const t = expr`(${f}-${a.at})/${b.at - a.at}`
    const stretch = from === to || a.ease === 'hold' ? String(from) : expr`(${from}+(${to - from})*${easeExpression(a.ease, t)})`
    terms.push(expr`if(gte(${f},${a.at})*lt(${f},${b.at}),${stretch},0)`)
  }
  terms.push(expr`if(gte(${f},${last.at}),${value(last)},0)`)
  return balancedSum(terms)
}

/**
 * Terms added up in halves, each in brackets, rather than in one long row.
 * ffmpeg 9 refuses an expression nested past a depth it allows, and a row of
 * a hundred sums is a hundred deep, so a zoom with many keyframes would not
 * export (plan 89). In halves, four thousand terms are twelve deep.
 */
export function balancedSum(terms: readonly string[]): string {
  if (terms.length <= 2) return terms.join('+')
  const half = Math.ceil(terms.length / 2)
  return `(${balancedSum(terms.slice(0, half))})+(${balancedSum(terms.slice(half))})`
}

/**
 * A picture's zoom, and its clock: the recording's frame the piece being
 * written starts on, and how many frames the piece is. The export is cut in
 * pieces wherever anything else starts or ends, and a zoom must not start
 * again at each.
 */
export interface Move {
  keys: ZoomKey[]
  first: number
  frames: number
}

/** A zoom's clock alone: the recording's frame a piece starts on, and how many frames it is. */
export type Clock = Omit<Move, 'keys'>

/** A further picture's own move on a piece's clock, when it has keyframes that go somewhere. */
export function layerMove(keys: readonly ZoomKey[] | undefined, clock: Clock | undefined): Move | undefined {
  return clock && keys && moves(keys) ? { keys: [...keys], ...clock } : undefined
}

/**
 * The keyframes a piece needs: those inside its frames and one either side,
 * which are all its frames are worked out from. A long clip with twenty
 * zooms writes only the one or two each piece shows.
 */
export function keysForPiece(keys: readonly ZoomKey[], first: number, frames: number): ZoomKey[] {
  const lastFrame = first + Math.max(1, frames) - 1
  let lo = 0
  for (let i = 0; i < keys.length; i++) if (keys[i]!.at <= first) lo = i
  let hi = keys.length - 1
  for (let i = keys.length - 1; i >= 0; i--) if (keys[i]!.at >= lastFrame) hi = i
  return keys.slice(lo, Math.max(lo, hi) + 1)
}

/**
 * The filters that cut a picture out of its source: a fixed crop, or the
 * window of a move worked out at four times `width`, the width it is shown at.
 * A piece of a zooming clip where the picture happens to stay still, before
 * the first keyframe or after the last, takes the fixed crop it stays on.
 */
export function cropFilters(crop: Rect, move: Move | undefined, fps: number, width: number): string[] {
  if (move) {
    const keys = keysForPiece(move.keys, move.first, move.frames)
    if (moves(keys)) return movingFilters(fps, keys, move, width)
    crop = keys[0]?.crop ?? crop
  }
  return [`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`]
}

/** The smallest rectangle holding both, in whole pixels, which is everything a move shows. */
function union(a: Rect, b: Rect): Rect {
  const x = Math.floor(Math.min(a.x, b.x))
  const y = Math.floor(Math.min(a.y, b.y))
  return { x, y, w: even(Math.ceil(Math.max(a.x + a.w, b.x + b.w)) - x), h: even(Math.ceil(Math.max(a.y + a.h, b.y + b.h)) - y) }
}

/** Rounded to an even number of pixels, which every encoder wants. */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2)
}
