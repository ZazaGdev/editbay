/**
 * Enhance voice: a sound clip's track played through a chain that makes a
 * voice sound produced, rumble cut, mud taken down, presence lifted, level
 * evened out and sibilance tamed, at one of three strengths. The chain is
 * run once by ffmpeg into a copy, which the preview plays and the export
 * reads, so the two sound the same. See plan 56.
 */

export type VoiceStrength = 'light' | 'normal' | 'strong'

export const VOICE_STRENGTHS: readonly VoiceStrength[] = ['light', 'normal', 'strong']

/**
 * Part of every copy's name. A chain changed later makes new copies rather
 * than reusing ones made the old way, which a saved project would otherwise
 * go on playing.
 */
export const VOICE_VERSION = 'v1'

/**
 * The chains, in the order a voice is usually treated: the rumble under any
 * voice cut, the boxy middle taken down, the presence that makes words clear
 * lifted, the level evened out, then the hiss of an S taken down, which the
 * lift and the compressor both make louder.
 */
const CHAINS: Record<VoiceStrength, string> = {
  light:
    'highpass=f=80,equalizer=f=250:t=q:w=1:g=-1.5,equalizer=f=4000:t=q:w=0.8:g=1.5,' +
    'acompressor=threshold=-20dB:ratio=2:attack=10:release=150:knee=6dB,deesser=i=0.2',
  normal:
    'highpass=f=80,equalizer=f=250:t=q:w=1:g=-2.5,equalizer=f=4000:t=q:w=0.8:g=2.5,highshelf=f=10000:g=1,' +
    'acompressor=threshold=-24dB:ratio=3:attack=10:release=150:knee=6dB,deesser=i=0.35',
  strong:
    'highpass=f=100,equalizer=f=250:t=q:w=1:g=-3.5,equalizer=f=4000:t=q:w=0.8:g=3.5,highshelf=f=10000:g=2,' +
    'acompressor=threshold=-28dB:ratio=4:attack=5:release=120:knee=6dB,deesser=i=0.5'
}

/** The filters a strength runs, before its level is put back. */
export function voiceChain(strength: VoiceStrength): string {
  return CHAINS[strength]
}

/**
 * The last step of every copy: its peaks kept under -1 dB, a little under
 * full scale, with the limiter's look ahead taken back out so the copy stays
 * in time with the track it was made from.
 */
export const VOICE_LIMIT = 'alimiter=limit=0.891:level=false:latency=true'

/** Whether something read from a file is one of the strengths. */
export function isVoiceStrength(x: unknown): x is VoiceStrength {
  return x === 'light' || x === 'normal' || x === 'strong'
}

/**
 * What a copy was made from and how: its strength, from the cleaned copy
 * when Clean up noise is on too, and the chain's version. One copy per
 * recipe and track, shared by every clip asking for the same.
 */
export function voiceRecipe(strength: VoiceStrength, clean: boolean): string {
  return `${VOICE_VERSION}-${clean ? 'clean-' : ''}${strength}`
}

/** The most the level is lifted, however much quieter the chain left it. */
export const MAX_VOICE_LIFT_DB = 12
/** A track quieter than this, in LUFS, is taken as silence and given no lift, as the export's levelling does. */
export const VOICE_FLOOR_LUFS = -50

/**
 * How many dB the chain's output is turned up to sound as loud as the track
 * it was made from: turning Enhance on changes how a voice sounds, not how
 * loud it sits against the music. Nothing for a silent track, or when either
 * could not be measured; never a cut, and never more than the cap.
 */
export function voiceLift(trackLufs: number | null, chainLufs: number | null): number {
  if (trackLufs === null || chainLufs === null || !Number.isFinite(trackLufs) || !Number.isFinite(chainLufs)) return 0
  if (trackLufs < VOICE_FLOOR_LUFS) return 0
  const lift = Math.round((trackLufs - chainLufs) * 100) / 100
  return Math.max(0, Math.min(MAX_VOICE_LIFT_DB, lift))
}
