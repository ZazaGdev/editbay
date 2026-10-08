import type { VoiceStrength } from './voice'

/**
 * Plan 81 (bugs and notes 2, note 31): breaths softened and mouth clicks
 * taken out of a voice. Both belong to a recording's track rather than to one
 * clip, since a mic has the same breaths all the way through, and are run
 * with Clean up noise and Enhance voice in one ffmpeg pass into a copy the
 * preview plays and the export reads, in the order a voice is treated:
 * clicks, then noise, then breaths, then the enhance.
 */

/** How far breaths are turned down: about 10 dB, or about 20. */
export type BreathAmount = 'gentle' | 'strong'

export const BREATH_AMOUNTS: readonly BreathAmount[] = ['gentle', 'strong']

/** What is done to one track of a recording. Absent fields are off. */
export interface VoiceCare {
  track: number
  breaths?: BreathAmount
  clicks?: true
}

/** Whether anything is on. */
export function caresFor(c: VoiceCare | undefined): c is VoiceCare {
  return c !== undefined && (c.breaths !== undefined || c.clicks === true)
}

/** A track's care, from what a recording keeps, or undefined when none is on. */
export function careOf(m: { care?: VoiceCare[] }, track: number): VoiceCare | undefined {
  const c = m.care?.find((x) => x.track === track)
  return caresFor(c) ? c : undefined
}

/**
 * Part of every treated copy's name. A chain changed later makes new copies
 * rather than reusing ones made the old way.
 */
export const CARE_VERSION = 'c1'

/**
 * The name of a treated copy: everything that went into it, so each mix of
 * switches has its own copy, shared by every clip asking for the same.
 */
export function careRecipe(care: VoiceCare, clean: boolean, voice: VoiceStrength | undefined): string {
  return [CARE_VERSION, care.clicks ? 'clicks' : '', clean ? 'clean' : '', care.breaths ?? '', voice ?? ''].filter((x) => x !== '').join('-')
}

/**
 * Clicks out: `adeclick`, which finds samples its model of the sound around
 * them cannot predict and fills them in from either side. A 20 ms window
 * rather than the 55 ms meant for records, since speech changes faster; a
 * threshold of 4 rather than 2, so a hard "t" or "p" is less often taken for
 * a click; and a click's pieces joined into one repair, as a lip smack is.
 */
export const CLICKS_CHAIN = 'adeclick=w=20:o=75:a=2:t=4:b=5'

/** How far down each amount leaves a breath, as the gate's floor. */
const RANGE: Record<BreathAmount, number> = { gentle: 0.316, strong: 0.1 }

/** The band a voice has most of its energy in and a breath little: what the gate listens to. */
export const VOICE_BAND = 'highpass=f=100,lowpass=f=900'

/** How far under the voice band's own loudness the gate opens, in dB. */
export const BREATH_BELOW_DB = 20

/** How far ahead of the voice the gate listens, in seconds, so it opens just before a word rather than on it. */
export const BREATH_LOOKAHEAD_SEC = 0.02

/**
 * The gate's threshold, as the linear level `sidechaingate` takes, from the
 * voice band's measured loudness in LUFS: 20 dB under it, kept between a
 * whisper and half of full scale. A track that could not be measured, or is
 * silent, gets a threshold that suits a normal voice.
 */
export function breathThreshold(voiceBandLufs: number | null): number {
  const level = voiceBandLufs === null || !Number.isFinite(voiceBandLufs) || voiceBandLufs < -70 ? -30 : voiceBandLufs
  const t = Math.pow(10, (level - BREATH_BELOW_DB) / 20)
  return Math.round(Math.min(0.5, Math.max(0.0005, t)) * 1e6) / 1e6
}

/**
 * Breaths down, as a filter graph from `[in]` to `[out]`: the voice turned
 * down to the amount's floor wherever its voice band is quieter than the
 * threshold, gently (ratio 6, a soft knee), opening in 5 ms and closing over
 * 150 ms so a short gap inside a word does not close it. The voice runs a
 * moment behind what the gate listens to and is brought back into time after.
 */
export function breathsGraph(amount: BreathAmount, threshold: number, input: string, output: string): string {
  const d = Math.round(BREATH_LOOKAHEAD_SEC * 1000)
  return (
    `${input}asplit=2[breath_voice][breath_key];` +
    `[breath_key]${VOICE_BAND}[breath_band];` +
    `[breath_voice]adelay=delays=${d}:all=1[breath_late];` +
    `[breath_late][breath_band]sidechaingate=threshold=${threshold}:range=${RANGE[amount]}:ratio=6:attack=5:release=150:knee=2.8:detection=rms,` +
    `atrim=start=${BREATH_LOOKAHEAD_SEC},asetpts=PTS-STARTPTS${output}`
  )
}

/** Whether something read from a file is a breath amount. */
export function isBreathAmount(x: unknown): x is BreathAmount {
  return x === 'gentle' || x === 'strong'
}

/** A recording's care as a file stores it, tidied: damaged entries dropped, one per track, only what is on. */
export function cleanCare(raw: unknown): VoiceCare[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const byTrack = new Map<number, VoiceCare>()
  for (const x of raw) {
    const c = x as Partial<Record<keyof VoiceCare, unknown>> | null
    if (typeof c !== 'object' || c === null || typeof c.track !== 'number' || !Number.isInteger(c.track) || c.track < 0) continue
    const care: VoiceCare = {
      track: c.track,
      ...(isBreathAmount(c.breaths) ? { breaths: c.breaths } : {}),
      ...(c.clicks === true ? { clicks: true as const } : {})
    }
    if (caresFor(care)) byTrack.set(care.track, care)
  }
  return byTrack.size > 0 ? [...byTrack.values()].sort((a, b) => a.track - b.track) : undefined
}
