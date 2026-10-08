/**
 * Lining up two recordings of the same moment by their sound (plan 74): a
 * phone's camera against the screen recording, each with its own microphone.
 * Pure, so the matching is tested on envelopes whose offset is known.
 *
 * Each recording is reduced to a loudness envelope, its level in decibels a
 * tenth of a second at a time, from the peaks the waveform already stores.
 * Two microphones hear the same talking at different levels and with
 * different noise under it, but the rise and fall of the talking is the same
 * in both. The offset is where the two envelopes correlate best, and the
 * correlation there says how sure that is.
 */

/** Steps of the envelope a second: fine enough to see words start and stop, coarse enough to search every offset of a long recording. */
export const SYNC_STEPS_PER_SECOND = 10

/** Below this the level counts as silence, so hiss and a quiet room read the same. */
const FLOOR_DB = -60

/** A 16-bit sample at full scale. */
const FULL_SCALE = 32768

/** The least two recordings must share to be matched, in seconds. */
export const SYNC_LEAST_SECONDS = 10

/** How well the best offset must correlate, from 0 to 1, to be trusted. */
export const SYNC_LEAST_CONFIDENCE = 0.6

/** How far ahead of any other offset more than a second away the best must be. */
const SYNC_LEAST_MARGIN = 0.1

/**
 * A recording's loudness, in dB from `FLOOR_DB` to 0, a step at a time, from
 * the peaks the waveform stores: a minimum and a maximum `peaksPerSecond`
 * times a second.
 */
export function loudnessEnvelope(peaks: Int16Array, peaksPerSecond: number, stepsPerSecond = SYNC_STEPS_PER_SECOND): number[] {
  const buckets = Math.floor(peaks.length / 2)
  const per = peaksPerSecond / stepsPerSecond
  const steps = Math.floor(buckets / per)
  const out: number[] = []
  for (let s = 0; s < steps; s++) {
    let loudest = 0
    for (let b = Math.floor(s * per); b < Math.floor((s + 1) * per); b++) {
      loudest = Math.max(loudest, Math.abs(peaks[b * 2] ?? 0), Math.abs(peaks[b * 2 + 1] ?? 0))
    }
    out.push(Math.max(FLOOR_DB, 20 * Math.log10(Math.max(loudest, 1) / FULL_SCALE)))
  }
  return out
}

export interface SoundMatch {
  ok: boolean
  /**
   * Where the second recording's 0 s sits on the first one's clock, as an
   * edit list's `offsetSec` says it: 2.35 when it started 2.35 s in.
   */
  offsetSec: number
  /** How well the two correlate there, from 0 to 1. */
  confidence: number
  /** Why it was refused, when it was. */
  reason?: string
}

/** The correlation of `a` from `lag` on with `b`, over where they overlap, or 0 where either is flat. */
function correlation(a: readonly number[], b: readonly number[], lag: number): number {
  const from = Math.max(0, -lag)
  const to = Math.min(b.length, a.length - lag)
  const n = to - from
  if (n <= 1) return 0
  let sa = 0
  let sb = 0
  for (let i = from; i < to; i++) {
    sa += a[i + lag]!
    sb += b[i]!
  }
  const ma = sa / n
  const mb = sb / n
  let ab = 0
  let aa = 0
  let bb = 0
  for (let i = from; i < to; i++) {
    const x = a[i + lag]! - ma
    const y = b[i]! - mb
    ab += x * y
    aa += x * x
    bb += y * y
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0
}

/**
 * The offset of recording `b` against recording `a`, from their envelopes at
 * `stepsPerSecond`: every offset at which they share at least half the
 * shorter one, and never less than `SYNC_LEAST_SECONDS`, is tried. Refused
 * when they are too short, when the best match is weak, or when another
 * offset matches nearly as well, which is what silence or a steady hum gives.
 */
export function matchBySound(a: readonly number[], b: readonly number[], stepsPerSecond = SYNC_STEPS_PER_SECOND): SoundMatch {
  const least = SYNC_LEAST_SECONDS * stepsPerSecond
  const shorter = Math.min(a.length, b.length)
  if (shorter < least) {
    return { ok: false, offsetSec: 0, confidence: 0, reason: `a recording is too short to match: each needs at least ${SYNC_LEAST_SECONDS} s of sound` }
  }
  const overlap = Math.max(least, Math.floor(shorter / 2))
  // b[i] is heard at a[i + lag]; the lags tried keep `overlap` steps in common.
  const lowest = overlap - b.length
  const highest = a.length - overlap
  const scores: number[] = []
  let best = lowest
  for (let lag = lowest; lag <= highest; lag++) {
    const r = correlation(a, b, lag)
    scores.push(r)
    if (r > scores[best - lowest]!) best = lag
  }
  const confidence = Math.max(0, scores[best - lowest]!)
  const away = stepsPerSecond
  let elsewhere = 0
  scores.forEach((r, i) => {
    if (Math.abs(i + lowest - best) > away) elsewhere = Math.max(elsewhere, r)
  })
  const offsetSec = best / stepsPerSecond
  const rounded = Number(confidence.toFixed(3))
  if (confidence < SYNC_LEAST_CONFIDENCE) {
    return { ok: false, offsetSec, confidence: rounded, reason: `the sound matches only weakly (${rounded} at ${offsetSec} s, at least ${SYNC_LEAST_CONFIDENCE} is needed): these may not be recordings of the same moment` }
  }
  if (confidence - elsewhere < SYNC_LEAST_MARGIN) {
    return { ok: false, offsetSec, confidence: rounded, reason: `the match is unclear: another offset more than a second away matches nearly as well (${elsewhere.toFixed(3)} against ${rounded})` }
  }
  return { ok: true, offsetSec, confidence: rounded }
}

/**
 * The offset found by `matchBySound` made finer, from envelopes at a higher
 * rate: only the offsets within `withinSec` of it are tried, so a long
 * recording costs no more than a short one. The correlation there is given
 * as found; the refusals were made on the coarse match.
 */
export function refineMatch(a: readonly number[], b: readonly number[], stepsPerSecond: number, aroundSec: number, withinSec: number): { offsetSec: number; confidence: number } {
  const centre = Math.round(aroundSec * stepsPerSecond)
  const reach = Math.max(1, Math.round(withinSec * stepsPerSecond))
  let best = centre
  let bestR = correlation(a, b, centre)
  for (let lag = centre - reach; lag <= centre + reach; lag++) {
    const r = correlation(a, b, lag)
    if (r > bestR) {
      best = lag
      bestR = r
    }
  }
  return { offsetSec: best / stepsPerSecond, confidence: Number(Math.max(0, bestR).toFixed(3)) }
}
