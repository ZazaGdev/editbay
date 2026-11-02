import type { VoiceStrength } from './voice'

/**
 * Plan 106: the arithmetic of the preview's sound engine, which plays the
 * sequence's sound from decoded stretches started at exact samples of one
 * audio clock, so two clips that meet at a cut meet at the same sample.
 *
 * Everything here is in samples at the audio device's rate, counted from the
 * start of the sequence. Pure, so it is tested without a window.
 */

/** One clip's sound, as the engine plays it. */
export interface SoundVoice {
  /** The audio clip's id. */
  id: string
  /** Which recording, which of its sound tracks and which copy of it: the main process finds the file. */
  mediaId: string
  track: number
  denoise: boolean
  voice?: VoiceStrength
  /** One side played on both (task 1188). */
  side?: 'left' | 'right'
  /** Where it is heard in the sequence, in seconds, crossfades included. */
  startSec: number
  endSec: number
  /** Where its sound is at `startSec`, in seconds from the start of its file, as ffmpeg counts. */
  fileAtStart: number
  /** Its loudness for the engine, 0 to 1, before the master gain. */
  gain: number
  /** What its gain is multiplied by at a time of the sequence, where it fades. */
  fadeAt?: (sec: number) => number
}

/** A stretch of one voice, decoded and started as one piece. */
export interface SoundChunk {
  voiceId: string
  /** Which of the voice's stretches, from 0. */
  index: number
  /** The sample of the sequence it starts on. */
  at: number
  /** How many samples long it is. */
  frames: number
  /** Where in its file it starts, in seconds. */
  fileSec: number
}

/** How long each stretch is: short enough to decode quickly, long enough that few are in flight. */
export const CHUNK_SEC = 2

/** The samples of the sequence a voice covers, start included and end not. */
export function voiceSamples(v: SoundVoice, rate: number): { from: number; to: number } {
  return { from: Math.round(v.startSec * rate), to: Math.round(v.endSec * rate) }
}

/**
 * The stretches of a voice that overlap samples `from` to `to` of the
 * sequence. Each starts a whole number of stretches after the voice does, so
 * the same stretch is always cut the same way and decoded once.
 */
export function chunksBetween(v: SoundVoice, rate: number, from: number, to: number, chunkSec = CHUNK_SEC): SoundChunk[] {
  const span = voiceSamples(v, rate)
  const size = Math.max(1, Math.round(chunkSec * rate))
  const lo = Math.max(span.from, from)
  const hi = Math.min(span.to, to)
  if (hi <= lo) return []
  const out: SoundChunk[] = []
  for (let k = Math.floor((lo - span.from) / size); span.from + k * size < hi; k++) {
    const at = span.from + k * size
    const frames = Math.min(size, span.to - at)
    if (frames <= 0) break
    out.push({ voiceId: v.id, index: k, at, frames, fileSec: v.fileAtStart + (k * size) / rate })
  }
  return out
}

/** What a decoded stretch is kept under: the same sound from the same place of the same file is decoded once. */
export function chunkKey(v: SoundVoice, c: SoundChunk, rate: number): string {
  return [v.mediaId, v.track, v.denoise ? 'd' : '', v.voice ?? '', v.side ?? '', c.fileSec.toFixed(6), c.frames, rate].join('|')
}

/**
 * When a stretch starts on the audio clock, and how far into it, for a
 * sequence whose sample `origin` is heard at clock time `t0`. A stretch
 * whose start has already gone by, or goes by before `earliest`, starts at
 * `earliest` that far in; one wholly gone is null.
 */
export function startOf(c: SoundChunk, origin: number, t0: number, rate: number, earliest: number): { when: number; offset: number } | null {
  const when = t0 + (c.at - origin) / rate
  if (when >= earliest) return { when, offset: 0 }
  const offset = earliest - when
  if (offset >= c.frames / rate) return null
  return { when: earliest, offset }
}

/**
 * A voice's gain over a stretch of the clock, as values for a gain curve,
 * `perSec` of them a second: its own gain times its fade at each point.
 */
export function gainCurve(v: SoundVoice, fromSec: number, durSec: number, perSec = 100): Float32Array {
  const n = Math.max(2, Math.ceil(durSec * perSec) + 1)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = v.gain * (v.fadeAt ? v.fadeAt(fromSec + (durSec * i) / (n - 1)) : 1)
  return out
}

/** What makes a voice the same sound in the same place, so a playing one is kept across an edit that leaves it alone. */
export function voiceShape(v: SoundVoice): string {
  return [v.id, v.mediaId, v.track, v.denoise ? 'd' : '', v.voice ?? '', v.side ?? '', v.startSec.toFixed(6), v.endSec.toFixed(6), v.fileAtStart.toFixed(6)].join('|')
}
