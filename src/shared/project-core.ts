/**
 * The constants a project is built on, the schema version, the first ids and the
 * eases, and the small sums every part of the document uses. It imports nothing
 * back from the modules beside it, so a constant here is ready whatever loads first.
 */

import type { Ease, SimpleEase } from './project'

/**
 * 2 added the workspace and paths relative to the project file. 3 moved the
 * clips and the shape onto sequences, several to a project. 4 gave clips
 * places and layers, several pictures of one recording in one frame. 5 let a
 * clip play any of its recording's audio tracks. 6 made every track free, V1
 * included, and put a recording's sound on audio tracks of its own, linked to
 * its picture. 7 gave each sequence captions made from its speech. 8 gave a
 * sequence markers. 9 put transitions on a clip's edges, and took away the
 * empty `effects` list that was never written to. 10 replaced a clip's one
 * move (`transform.zoom`) by zoom keyframes on the frames of its recording.
 * 11 gave a clip a speed (plan 105), and with it ends part way between
 * frames: 1.0 to 1.2 read such a file as their own and opened it out of step
 * or called it damaged, where at 11 they say it needs a newer app (audit
 * 2026-10-19).
 */
export const SCHEMA_VERSION = 11

/**
 * The id of the sequence a project starts with, and the one an older file's
 * single timeline becomes. Fixed, so opening the same old file twice gives
 * the same document.
 */
export const FIRST_SEQUENCE_ID = 'sequence-1'

/** The ids V1 and A1 have in a new sequence, and in one opened from an older file. */
export const V1_ID = 'v1'
export const A1_ID = 'a1'

/** The output shape a new project starts with. */
export const DEFAULT_PRESET_ID = 'vertical'

export const EASES: readonly Ease[] = ['smooth', 'linear', 'in', 'out', 'hold']

export const SIMPLE_EASES: readonly SimpleEase[] = ['smooth', 'linear', 'cut']

/** The id that names a clip's main picture, beside its layers' own ids. */
export const MAIN_PICTURE = 'main'

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

export function evenDown(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2)
}

export function evenNear(n: number): number {
  return Math.round(n / 2) * 2
}
