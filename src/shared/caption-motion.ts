/**
 * Plan 107: captions animating in and out, a line at a time or a word at a
 * time as each is said. Worked out here once, a frame at a time, for the
 * preview and the export alike, so the two draw the same frames. The timings
 * and curves are from docs/research/2026-11-06-caption-animations.md.
 */

import type { CaptionClip } from './captions'

/** How a caption comes in and goes out. */
export type CaptionAnimation = 'none' | 'fade' | 'pop' | 'slideUp' | 'slideDown'
/** Whether the whole caption comes in at once, or each word as it is said. */
export type CaptionAnimateBy = 'line' | 'word'

export const CAPTION_ANIMATIONS: { id: CaptionAnimation; name: string; title: string }[] = [
  { id: 'none', name: 'None', title: 'Captions cut in and out' },
  { id: 'fade', name: 'Fade', title: 'Captions fade in and out' },
  { id: 'pop', name: 'Pop', title: 'Captions grow in past their size and settle, and shrink away' },
  { id: 'slideUp', name: 'Slide up', title: 'Captions rise into place and carry on up as they go' },
  { id: 'slideDown', name: 'Slide down', title: 'Captions drop into place and carry on down as they go' }
]

/** How a word or a caption is drawn at a frame: how much of it, how big, and how far above its place in ems. */
export interface CaptionMove {
  opacity: number
  scale: number
  rise: number
}

export const STILL: CaptionMove = { opacity: 1, scale: 1, rise: 0 }

/** A CSS cubic-bezier curve as a function of 0 to 1. */
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, s: number): number => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3
  return (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    // x rises with s for every curve used here, so halving finds it.
    let lo = 0
    let hi = 1
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2
      if (at(x1, x2, mid) < t) lo = mid
      else hi = mid
    }
    return at(y1, y2, (lo + hi) / 2)
  }
}

const linear = (t: number): number => t
const backOut = bezier(0.34, 1.56, 0.64, 1)
const cubicIn = bezier(0.32, 0, 0.67, 0)
const decelerate = bezier(0.05, 0.7, 0.1, 1)
const accelerate = bezier(0.3, 0, 0.8, 0.15)

/** How far a slide travels, in ems: half a line. */
const SLIDE = 0.5

interface Motion {
  inMs: number
  outMs: number
  /** How it is drawn `t` of the way in, 0 to 1. */
  in: (t: number) => CaptionMove
  /** And `t` of the way out. */
  out: (t: number) => CaptionMove
}

const MOTIONS: Record<Exclude<CaptionAnimation, 'none'>, Motion> = {
  fade: {
    inMs: 150,
    outMs: 100,
    in: (t) => ({ opacity: linear(t), scale: 1, rise: 0 }),
    out: (t) => ({ opacity: 1 - linear(t), scale: 1, rise: 0 })
  },
  pop: {
    inMs: 250,
    outMs: 150,
    // From 70% past its size and back, seen at once and fully by half way.
    in: (t) => ({ opacity: Math.min(1, 2 * t), scale: 0.7 + 0.3 * backOut(t), rise: 0 }),
    out: (t) => ({ opacity: 1 - cubicIn(t), scale: 1 - 0.2 * cubicIn(t), rise: 0 })
  },
  slideUp: {
    inMs: 300,
    outMs: 200,
    in: (t) => ({ opacity: Math.min(1, decelerate(t) * 1.5), scale: 1, rise: -SLIDE * (1 - decelerate(t)) }),
    out: (t) => ({ opacity: 1 - accelerate(t), scale: 1, rise: SLIDE * accelerate(t) })
  },
  slideDown: {
    inMs: 300,
    outMs: 200,
    in: (t) => ({ opacity: Math.min(1, decelerate(t) * 1.5), scale: 1, rise: SLIDE * (1 - decelerate(t)) }),
    out: (t) => ({ opacity: 1 - accelerate(t), scale: 1, rise: -SLIDE * accelerate(t) })
  }
}

/** A coming in or going out of `frames` frames, at frame `k` of it from 0: how far along, never quite 0 or 1. */
const along = (k: number, frames: number): number => (k + 1) / (frames + 1)

/** Frames for `ms` at `fps`, at most `most`. */
const framesOf = (ms: number, fps: number, most: number): number => Math.max(0, Math.min(Math.round((ms * fps) / 1000), Math.floor(most)))

const same = (a: CaptionMove, b: CaptionMove): boolean => a.opacity === b.opacity && a.scale === b.scale && a.rise === b.rise

/**
 * How caption `c` is drawn at `frame` of the sequence: the whole caption's
 * move and each word's; or null when nothing about it differs from a caption
 * standing still. A word not yet said in word mode is not drawn at all. Coming
 * in and going out each take at most a third of the caption, so a short one
 * is still read standing still.
 */
export function captionMoves(
  c: CaptionClip,
  style: { animation?: CaptionAnimation; animateBy?: CaptionAnimateBy },
  frame: number,
  fps: number
): { whole: CaptionMove; words: CaptionMove[] } | null {
  const by = style.animateBy ?? 'line'
  const animation = style.animation ?? 'none'
  if (animation === 'none' && by === 'line') return null
  const motion = animation === 'none' ? null : MOTIONS[animation]
  const into = frame - c.timelineStart
  const length = c.length
  const left = c.timelineStart + c.length - frame
  let whole = STILL
  if (motion) {
    const outFrames = framesOf(motion.outMs, fps, length / 3)
    const inFrames = framesOf(motion.inMs, fps, length / 3)
    if (left <= outFrames) whole = motion.out(along(outFrames - left, outFrames))
    else if (by === 'line' && into < inFrames) whole = motion.in(along(into, inFrames))
  }
  const words = c.words.map((w, i) => {
    if (by === 'line') return STILL
    const start = i === 0 ? 0 : w.start
    if (into < start) return { opacity: 0, scale: 1, rise: 0 }
    if (!motion) return STILL
    const next = i === c.words.length - 1 ? length : c.words[i + 1]!.start
    const inFrames = framesOf(motion.inMs, fps, Math.max(1, (next - start) * 2))
    return into - start < inFrames ? motion.in(along(into - start, inFrames)) : STILL
  })
  if (same(whole, STILL) && words.every((w) => same(w, STILL))) return null
  return { whole, words }
}
