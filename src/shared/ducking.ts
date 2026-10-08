import type { Timeline } from './project'
import { clipPeakAt, walker, type Stretch } from './silences'
import { peaksKey } from './sound'
import { isMuted, spanEnd } from './tracks'
import type { PeaksData } from './types'

/**
 * Ducking: a track marked to duck comes down wherever anything on the other
 * tracks is heard, the music under the voice.
 *
 * Where the voice is comes from the waveforms, as stretches of the sequence,
 * and how far down a ducked sound is at a moment comes from those stretches
 * alone. The preview multiplies a player's volume by `duckGainAt`, and the
 * export writes `duckExpression`, the same curve, into ffmpeg's `volume`
 * filter, so the two cannot disagree about when the music moves or how far.
 * A compressor keyed by the voice as it plays could not promise that.
 */

/** How far a ducked sound comes down, in dB. */
export const DUCK_DB = -12
/** Louder than this counts as voice: the level Remove silences starts from. */
export const DUCK_VOICE_DB = -40
/** Voice this close together is one stretch, so the music does not come up between words. */
export const DUCK_BRIDGE_SEC = 0.5
/** How long it takes to come down, ending where the voice starts, so the first word is clear. */
export const DUCK_ATTACK_SEC = 0.15
/** How long it takes to come back up, from where the voice stops. */
export const DUCK_RELEASE_SEC = 0.5

/** A 16-bit sample at full scale. */
const FULL_SCALE = 32768

/**
 * The stretches of the sequence where something is heard on a track that does
 * not duck, in frames, `to` not included; nothing when no track ducks. A
 * muted track or clip is neither voice nor ducked, and a waveform not loaded
 * yet is silence. Solo is left out: it is a way of listening, and the export
 * does not have it.
 */
export function voiceStretches(t: Timeline, peaks: ReadonlyMap<string, PeaksData>): Stretch[] {
  const ducking = t.audioTracks.some((r) => r.duck === true && !isMuted(r))
  if (!ducking) return []
  const voices = t.audioTracks.filter((r) => r.duck !== true && !isMuted(r))
  const end = voices.reduce((m, r) => r.clips.reduce((n, c) => Math.max(n, spanEnd(c)), m), 0)
  const loudest = FULL_SCALE * Math.pow(10, DUCK_VOICE_DB / 20)
  const at = voices.map((r) => walker(r.clips))
  const heard = (frame: number): boolean =>
    at.some((clipAt) => {
      const c = clipAt(frame)
      if (!c || c.muted) return false
      const data = peaks.get(peaksKey(c.mediaId, c.track))
      return data !== undefined && clipPeakAt(data, c, frame, t.fps) * c.gain >= loudest
    })

  const found: Stretch[] = []
  let run = -1
  for (let f = 0; f <= end; f++) {
    // Every walker is asked about every frame in order, as it needs.
    const loud = f < end && heard(f)
    if (loud && run < 0) run = f
    if (!loud && run >= 0) {
      found.push({ from: run, to: f })
      run = -1
    }
  }
  const bridge = Math.round(DUCK_BRIDGE_SEC * t.fps)
  return found.reduce<Stretch[]>((out, s) => {
    const last = out[out.length - 1]
    if (last && s.from - last.to < bridge) last.to = s.to
    else out.push({ ...s })
    return out
  }, [])
}

/** How far down a ducked sound is at the loudest of the duck, as a multiplier. */
const DOWN = Math.pow(10, DUCK_DB / 20)

/** A stretch as the edges of its curve, in seconds: starting down, down, starting up, up. */
function edges(s: Stretch, fps: number): { rise: number; fall: number } {
  return { rise: s.from / fps - DUCK_ATTACK_SEC, fall: s.to / fps + DUCK_RELEASE_SEC }
}

const clip01 = (x: number): number => Math.min(1, Math.max(0, x))

/**
 * A ducked sound's level at `sec` of the sequence, as a multiplier of its own:
 * 1 clear of the voice, `DUCK_DB` down within it, eased in a straight line
 * down before each stretch and up after it. Where two stretches' curves
 * overlap, the lower level wins.
 */
export function duckGainAt(stretches: readonly Stretch[], fps: number, sec: number): number {
  let most = 0
  for (const s of stretches) {
    const { rise, fall } = edges(s, fps)
    if (sec <= rise || sec >= fall) continue
    most = Math.max(most, Math.min(clip01((sec - rise) / DUCK_ATTACK_SEC), clip01((fall - sec) / DUCK_RELEASE_SEC)))
  }
  return 1 - (1 - DOWN) * most
}

/** A number as ffmpeg is given it: no more digits than it can use. */
function num(n: number): string {
  return String(Number(n.toFixed(6)))
}

/**
 * The larger of every term, as `max` taken in pairs down a balanced tree:
 * one `max` inside another for each term, as a chain would nest them, runs
 * out of room in ffmpeg's expression reader at about ninety, which a talking
 * head reaches in ten minutes. Balanced, four hundred nest nine deep.
 */
function maxOf(terms: string[]): string {
  if (terms.length === 1) return terms[0]!
  const half = Math.ceil(terms.length / 2)
  return `max(${maxOf(terms.slice(0, half))},${maxOf(terms.slice(half))})`
}

/**
 * `duckGainAt` as an ffmpeg expression in `t`, the time of a chain that starts
 * `fromSec` into the sequence, for a `volume` filter evaluated per frame; or
 * null when no stretch's curve reaches the stretch of it the sound is heard
 * over, `within`, by default all of `fromSec` to `toSec`. Only the stretches
 * near it are named, which keeps each sound's expression short.
 */
export function duckExpression(
  stretches: readonly Stretch[],
  fps: number,
  fromSec: number,
  toSec: number,
  within: { fromSec: number; toSec: number } = { fromSec, toSec }
): string | null {
  const near = stretches.map((s) => edges(s, fps)).filter((e) => e.rise < within.toSec && e.fall > within.fromSec)
  if (near.length === 0) return null
  const time = fromSec === 0 ? 't' : `(t+${num(fromSec)})`
  const terms = near.map(
    (e) => `min(clip((${time}-${num(e.rise)})/${num(DUCK_ATTACK_SEC)},0,1),clip((${num(e.fall)}-${time})/${num(DUCK_RELEASE_SEC)},0,1))`
  )
  return `1-${(1 - DOWN).toFixed(6)}*${maxOf(terms)}`
}
