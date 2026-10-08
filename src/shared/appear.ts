/**
 * How a text or a picture comes in and goes out: a fade, or a pop that grows
 * it from nothing with a small overshoot and settles. Worked out here once, so
 * the preview draws exactly what the export writes: the preview calls
 * `appearAt` for each frame, and the export hands ffmpeg `appearExpressions`,
 * the same sums written for its filters.
 */

export type AppearKind = 'fade' | 'pop'

export interface Appear {
  kind: AppearKind
  /** How long it takes, in frames at the project rate. */
  length: number
}

export const APPEAR_KINDS: { id: AppearKind; label: string }[] = [
  { id: 'fade', label: 'Fade' },
  { id: 'pop', label: 'Pop' }
]

/** The length a new one starts with, in seconds. */
export const DEFAULT_APPEAR_SECONDS = 0.5
/** The longest one may be, in seconds: past this it is a mistake, not a choice. */
export const MAX_APPEAR_SECONDS = 10

/** How far past its size a pop grows before it settles: the "back" of an ease out back. */
const BACK = 1.70158

/** The largest a pop makes a picture, as a share of its size: its overshoot, with room to spare. */
export const POP_ROOM = 1.12

/** A kept one tidied, or undefined for anything that is not one. */
export function cleanAppear(raw: unknown): Appear | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (r.kind !== 'fade' && r.kind !== 'pop') return undefined
  if (typeof r.length !== 'number' || !Number.isFinite(r.length)) return undefined
  const length = Math.round(r.length)
  return length >= 1 ? { kind: r.kind, length } : undefined
}

/** One no longer than its clip, which is as long as it can take. */
function within(a: Appear | undefined, length: number): Appear | undefined {
  return a && length >= 1 ? { kind: a.kind, length: Math.min(a.length, length) } : undefined
}

/** The size of a pop at `p`, 0 at its start and 1 once settled, going a little past 1 on the way. */
export function popScale(p: number): number {
  const q = Math.min(1, Math.max(0, p)) - 1
  return 1 + (BACK + 1) * q * q * q + BACK * q * q
}

/**
 * How far through its coming in and going out a clip is, at `frame` of its
 * own (0 on its first frame), for a clip `length` frames long. Coming in, 0 on
 * its first frame to 1 once done; going out, 1 until it starts and falling
 * towards 0 at the clip's end. The same arithmetic as ffmpeg's `fade`, which
 * the export uses, so the two agree on every frame.
 */
function progress(frame: number, length: number, enter: Appear | undefined, exit: Appear | undefined): { inP: number; outP: number } {
  return {
    inP: enter ? Math.min(1, Math.max(0, frame / enter.length)) : 1,
    outP: exit ? Math.min(1, Math.max(0, (length - frame) / exit.length)) : 1
  }
}

/** How see-through and how large a clip is drawn at `frame` of its own: alpha 0 to 1, scale about its centre. */
export function appearAt(
  frame: number,
  length: number,
  enter: Appear | undefined,
  exit: Appear | undefined
): { alpha: number; scale: number } {
  enter = within(enter, length)
  exit = within(exit, length)
  const { inP, outP } = progress(frame, length, enter, exit)
  let alpha = 1
  let scale = 1
  if (enter?.kind === 'fade') alpha *= inP
  if (enter?.kind === 'pop') scale *= popScale(inP)
  if (exit?.kind === 'fade') alpha *= outP
  if (exit?.kind === 'pop') scale *= popScale(outP)
  return { alpha, scale }
}

/**
 * The same, as ffmpeg expressions of `t`, the seconds since the clip's first
 * frame: the scale for a `scale` filter evaluated on every frame, and the
 * fades as `fade` filters on the picture's alpha. Null parts are not needed.
 */
export function appearExpressions(
  length: number,
  fps: number,
  enter: Appear | undefined,
  exit: Appear | undefined
): { scale: string | null; fades: string[] } {
  enter = within(enter, length)
  exit = within(exit, length)
  const num = (x: number): string => String(Math.round(x * 1e6) / 1e6)
  const frame = `(t*${num(fps)})`
  const pop = (p: string): string => `(1+${num(BACK + 1)}*pow(${p}-1,3)+${num(BACK)}*pow(${p}-1,2))`
  const pops: string[] = []
  if (enter?.kind === 'pop') pops.push(pop(`clip(${frame}/${enter.length},0,1)`))
  if (exit?.kind === 'pop') pops.push(pop(`clip((${length}-${frame})/${exit.length},0,1)`))
  const fades: string[] = []
  const sec = (frames: number): string => num(frames / fps)
  if (enter?.kind === 'fade') fades.push(`fade=t=in:st=0:d=${sec(enter.length)}:alpha=1`)
  if (exit?.kind === 'fade') fades.push(`fade=t=out:st=${sec(length - exit.length)}:d=${sec(exit.length)}:alpha=1`)
  return { scale: pops.length > 0 ? pops.join('*') : null, fades }
}
