import { describe, it, expect } from 'vitest'
import { loudnessEnvelope, matchBySound, refineMatch, SYNC_STEPS_PER_SECOND } from '../../src/shared/sync-by-sound'

/**
 * Plan 74. Lining up two recordings of the same moment by their sound, as
 * `npm run cli -- sync` does: a camera's microphone against the screen
 * recording's. Pure, so it is checked against envelopes made here, whose
 * offset is known.
 */

/** A seeded random number generator, so a failure can be run again. */
function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** Something like talking: bursts of sound of random length and loudness, with quiet between. */
function talking(seconds: number, seed: number): number[] {
  const next = random(seed)
  const out: number[] = []
  while (out.length < seconds * SYNC_STEPS_PER_SECOND) {
    const loud = next() < 0.6
    const length = Math.round((0.1 + next() * 0.8) * SYNC_STEPS_PER_SECOND)
    const level = loud ? 0.3 + next() * 0.7 : next() * 0.05
    for (let i = 0; i < length; i++) out.push(level * (0.8 + next() * 0.4))
  }
  return out.slice(0, seconds * SYNC_STEPS_PER_SECOND)
}

/** The same sound heard by another microphone: quieter, a little noisier. */
function heardElsewhere(env: readonly number[], seed: number): number[] {
  const next = random(seed)
  return env.map((v) => v * 0.5 + next() * 0.03)
}

/** Peaks as the waveform stores them, min and max per hundredth of a second, from an envelope at the step rate. */
function peaksOf(env: readonly number[]): Int16Array {
  const per = 100 / SYNC_STEPS_PER_SECOND
  const out = new Int16Array(env.length * per * 2)
  env.forEach((v, i) => {
    for (let k = 0; k < per; k++) {
      out[(i * per + k) * 2] = Math.round(-v * 30000)
      out[(i * per + k) * 2 + 1] = Math.round(v * 30000)
    }
  })
  return out
}

describe('the loudness envelope', () => {
  it('has one step for every tenth of a second of peaks', () => {
    expect(loudnessEnvelope(peaksOf(talking(10, 1)), 100)).toHaveLength(10 * SYNC_STEPS_PER_SECOND)
  })

  it('is louder where the peaks are', () => {
    const env = loudnessEnvelope(peaksOf([0.01, 0.5, 1]), 100)
    expect(env[0]!).toBeLessThan(env[1]!)
    expect(env[1]!).toBeLessThan(env[2]!)
  })
})

describe('matching two recordings by their sound', () => {
  it('finds a recording that started later, within one step', () => {
    const main = talking(120, 7)
    // The camera started 12.3 s into the main recording, and ran 60 s.
    const shift = Math.round(12.3 * SYNC_STEPS_PER_SECOND)
    const camera = heardElsewhere(main.slice(shift, shift + 60 * SYNC_STEPS_PER_SECOND), 8)
    const m = matchBySound(main, camera)
    expect(m.ok).toBe(true)
    expect(Math.abs(m.offsetSec - 12.3)).toBeLessThanOrEqual(1 / SYNC_STEPS_PER_SECOND)
    expect(m.confidence).toBeGreaterThan(0.8)
  })

  it('finds a recording that started earlier, as a negative offset', () => {
    const camera = talking(120, 11)
    const shift = Math.round(4.5 * SYNC_STEPS_PER_SECOND)
    // The main recording began 4.5 s into the camera's.
    const main = heardElsewhere(camera.slice(shift), 12)
    const m = matchBySound(main, camera)
    expect(m.ok).toBe(true)
    expect(Math.abs(m.offsetSec - -4.5)).toBeLessThanOrEqual(1 / SYNC_STEPS_PER_SECOND)
  })

  it('refuses two recordings of different things, with a reason', () => {
    const m = matchBySound(talking(90, 21), talking(90, 22))
    expect(m.ok).toBe(false)
    expect(m.reason).toMatch(/weak|unclear/)
  })

  it('refuses noise against noise', () => {
    const a = random(31)
    const b = random(32)
    const m = matchBySound(
      Array.from({ length: 900 }, () => a()),
      Array.from({ length: 900 }, () => b())
    )
    expect(m.ok).toBe(false)
  })

  it('refuses recordings too short to match', () => {
    const main = talking(3, 41)
    const m = matchBySound(main, main.slice(5))
    expect(m.ok).toBe(false)
    expect(m.reason).toMatch(/short/)
  })

  it('makes the offset finer from envelopes at a higher rate', () => {
    // Talking at a hundred steps a second, the camera starting 12.34 s in.
    const fine = talking(1200, 61).map((v, i, all) => all[Math.floor(i / 10) * 10]! * (0.9 + 0.1 * ((i * 7) % 10) / 10))
    const main = fine.slice(0, 12000)
    const camera = heardElsewhere(main.slice(1234, 1234 + 6000), 62)
    expect(refineMatch(main, camera, 100, 12.3, 0.2).offsetSec).toBeCloseTo(12.34, 5)
  })

  it('refuses silence, which matches anything', () => {
    const m = matchBySound(new Array(600).fill(0), talking(60, 51))
    expect(m.ok).toBe(false)
  })
})
