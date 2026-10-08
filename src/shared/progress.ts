/**
 * How long a long job has left, worked out from how far it has got and how
 * long that took. Pure, so the arithmetic is tested and the window and main
 * can both use it.
 *
 * An estimate made too early is noise: the first seconds of an export or a
 * conversion are spent starting ffmpeg, not encoding. So nothing is said
 * until a little of the job is done, and each new estimate is blended with
 * the last, which has itself been counting down, so the number moves smoothly.
 */

/** Below this much done, or this soon after starting, no estimate is given. */
const TOO_EARLY_FRACTION = 0.02
const TOO_EARLY_MS = 2000
/** How much of a new estimate is taken each time; the rest is the old one, counted down. */
const BLEND = 0.3

/** Seconds left, from the fraction done and the milliseconds taken, or null when it is too early to say. */
export function estimateRemaining(fraction: number, elapsedMs: number): number | null {
  if (!(fraction > TOO_EARLY_FRACTION) || !(elapsedMs >= TOO_EARLY_MS) || fraction >= 1) return null
  return (elapsedMs * (1 - fraction)) / fraction / 1000
}

/**
 * A new estimate blended with the last one, which has had `sinceSec` seconds
 * taken off since it was made. Never below zero.
 */
export function smoothRemaining(previous: number | null, next: number | null, sinceSec: number): number | null {
  if (next === null) return previous === null ? null : Math.max(0, previous - sinceSec)
  if (previous === null) return Math.max(0, next)
  return Math.max(0, (1 - BLEND) * (previous - sinceSec) + BLEND * next)
}

/** Time left in words, or null when there is too little left to be worth saying. */
export function formatRemaining(seconds: number | null): string | null {
  if (seconds === null || !(seconds >= 3)) return null
  if (seconds < 55) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds left`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes === 1 ? 'about a minute left' : `about ${minutes} minutes left`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const h = hours === 1 ? '1 hour' : `${hours} hours`
  return rest === 0 ? `about ${h} left` : `about ${h} ${rest} ${rest === 1 ? 'minute' : 'minutes'} left`
}
