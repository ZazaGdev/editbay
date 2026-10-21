import { describe, it, expect } from 'vitest'
import type { Timeline } from '../../src/shared/project'
import { setSpeed, speedRefusal } from '../../src/shared/speed-edit'
import { sourceAt, spanEnd } from '../../src/shared/tracks'
import { sequence, pic, snd } from '../shots'

/**
 * Speed on a shot whose sound leads in or runs on (audit 2026-10-19, fix
 * first 1): the sound keeps in step with its picture at both ends, or the
 * speed is refused naming the clip in the way, never set with the sound
 * pushed along on its own.
 */

/** The sound plays its picture's recording frame where the picture starts, and lasts at least as long. */
function inStep(t: Timeline, id: string): void {
  const p = pic(t, id)
  const s = snd(t, id)
  expect(sourceAt(s, p.timelineStart)).toBeCloseTo(p.sourceIn, 6)
  expect(spanEnd(s)).toBeGreaterThanOrEqual(spanEnd(p))
}

describe('speed on a J-cut or an L-cut', () => {
  it('slow motion on a shot whose sound leads in keeps the lead-in in step when there is room for it', () => {
    // A 0-100, its sound to 70; B 100-200, its sound from 85 (a 15-frame lead-in).
    const p = sequence({ id: 'A', at: 0, from: 30, to: 130, sound: [30, 0, 70] }, { id: 'B', at: 100, from: 30, to: 130, sound: [15, 85, 200] })
    const t = setSpeed(p, 'B', { speed: 0.5 })
    expect(t).not.toBe(p)
    expect(pic(t, 'B').timelineStart).toBe(100)
    expect(snd(t, 'B').timelineStart).toBe(70)
    expect(spanEnd(snd(t, 'B'))).toBe(spanEnd(pic(t, 'B')))
    inStep(t, 'B')
  })

  it('slow motion whose lead-in would run into the shot before it is refused, naming that shot', () => {
    const p = sequence({ id: 'A', at: 0, from: 30, to: 130, sound: [30, 0, 85] }, { id: 'B', at: 100, from: 30, to: 130, sound: [15, 85, 200] })
    expect(setSpeed(p, 'B', { speed: 0.5 })).toBe(p)
    expect(speedRefusal(p, 'B', 0.5)).toMatch(/A\.mp4 on A1/)
  })

  it('a time-lapse on a J-cut shot ends its sound where its picture ends, and is allowed', () => {
    const p = sequence({ id: 'A', at: 0, from: 30, to: 130, sound: [30, 0, 85] }, { id: 'B', at: 100, from: 30, to: 130, sound: [15, 85, 200] })
    expect(speedRefusal(p, 'B', 2)).toBeNull()
    const t = setSpeed(p, 'B', { speed: 2 })
    expect(spanEnd(pic(t, 'B'))).toBe(150)
    expect(spanEnd(snd(t, 'B'))).toBe(150)
    inStep(t, 'B')
  })

  it('slow motion on a shot whose sound runs on keeps the next shot and its sound in step, or is refused', () => {
    // A's sound runs 15 frames past its picture; B's sound starts after that.
    const room = sequence({ id: 'A', at: 0, from: 30, to: 130, sound: [30, 0, 115] }, { id: 'B', at: 100, from: 30, to: 130, sound: [60, 130, 200] })
    const t = setSpeed(room, 'A', { speed: 0.5 })
    expect(t).not.toBe(room)
    expect(spanEnd(snd(t, 'A'))).toBe(230)
    expect(pic(t, 'B').timelineStart).toBe(200)
    expect(snd(t, 'B').timelineStart).toBe(230)
    inStep(t, 'A')
    inStep(t, 'B')
    // With B's sound starting where A's sound ends, the longer tail would push it along.
    const tight = sequence({ id: 'A', at: 0, from: 30, to: 130, sound: [30, 0, 115] }, { id: 'B', at: 100, from: 45, to: 130, sound: [45, 115, 200] })
    expect(setSpeed(tight, 'A', { speed: 0.5 })).toBe(tight)
    expect(speedRefusal(tight, 'A', 0.5)).toMatch(/B\.mp4 on A1/)
  })

  it('a lead-in that would start before the sequence does is refused, not clamped out of step', () => {
    const p = sequence({ id: 'A', at: 10, from: 30, to: 130, sound: [20, 0, 110] })
    expect(setSpeed(p, 'A', { speed: 0.5 })).toBe(p)
    expect(speedRefusal(p, 'A', 0.5)).not.toBeNull()
  })
})
