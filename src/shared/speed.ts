/**
 * A clip's speed (plan 105): a time-lapse at 4x, slow motion at 0.5x. Its
 * recording is played that many times as fast, so its length on the timeline
 * is its recording's frames divided by its speed. A picture and its linked
 * sound always share one speed.
 *
 * The frames of the recording a clip covers stay `sourceIn` and `sourceOut`.
 * At a speed of its own they may fall part way between two frames, so every
 * frame of the timeline maps to exactly one place in the recording and a split
 * or a trim lands exactly where it was asked to. The edit that sets a speed is
 * in `speed-edit.ts`.
 */

import { speedOf } from './tracks'
import type { Clip, SoundClip } from './project'

/** The speeds offered in a list, slowest first. Any other from `MIN_SPEED` to `MAX_SPEED` may be typed. */
export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8] as const

export const MIN_SPEED = 0.1
export const MAX_SPEED = 16

/** The speeds a sound is heard at with nothing asked: outside them it is silent unless kept. */
export const HEARD_FROM = 0.5
export const HEARD_TO = 2

/**
 * A speed fit to store, to two decimal places and inside the limits, or
 * undefined for 1 and for anything that is not a speed at all.
 */
export function cleanSpeed(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const s = Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, raw)) * 100) / 100
  return s === 1 ? undefined : s
}

/** A speed as it is shown: `4x`, `0.5x`, `1.25x`. */
export function speedLabel(speed: number): string {
  return `${Number(speed.toFixed(2))}x`
}

/** Whether a speed is one a sound is heard at with nothing asked, where its pitch is kept. */
export function heardAt(speed: number): boolean {
  return speed >= HEARD_FROM && speed <= HEARD_TO
}

/** Whether a sound clip is heard at its speed: always from 0.5x to 2x, and outside that only when kept on purpose. */
export function soundHeard(c: SoundClip): boolean {
  return heardAt(speedOf(c)) || c.keepSound === true
}

/** Whether a picture slowed down blends its frames into each other: below 1x, unless plain frames are asked for. */
export function blendsFrames(c: Clip): boolean {
  return speedOf(c) < 1 && c.plainFrames !== true
}

/** What a speed edit changes: the speed, keeping sound outside 0.5x to 2x, and plain frames in slow motion. */
export interface SpeedChange {
  speed?: number
  keepSound?: boolean
  plainFrames?: boolean
}
