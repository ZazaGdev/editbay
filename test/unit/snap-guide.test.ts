import { describe, it, expect } from 'vitest'
import { SNAP_PX, snapFrame, snapFrameTo, snapMove, snapMoveTo, snapReach, snapTrim, snapTrimTo } from '../../src/shared/tracks'

/**
 * Plan 20, step 4: snapping says what it caught. It is silent today, so an
 * edge jumps and nothing on screen says what pulled it, which reads as a bug
 * until you work it out.
 *
 * Each of the three keeps its old answer exactly: the pair that says what was
 * caught is the same arithmetic, asked a second question.
 */

describe('a frame snapped to a target', () => {
  it('lands where it always did, and names what caught it', () => {
    const targets = [0, 100, 250]
    expect(snapFrameTo(96, targets, 8)).toEqual({ frame: 100, caught: 100 })
    expect(snapFrameTo(96, targets, 8).frame).toBe(snapFrame(96, targets, 8))
  })

  it('names nothing when nothing is in reach', () => {
    expect(snapFrameTo(50, [0, 100], 8)).toEqual({ frame: 50, caught: null })
  })

  it('names the nearer of two in reach', () => {
    expect(snapFrameTo(98, [90, 100], 10).caught).toBe(100)
    expect(snapFrameTo(92, [90, 100], 10).caught).toBe(90)
  })
})

describe('a clip moved onto a target', () => {
  it('names the edge that caught, which may be the end of the clip', () => {
    // 60 long, dropped at 38: its end at 98 catches 100, so it lands at 40.
    const moved = snapMoveTo(38, 60, [0, 100], 6)
    expect(moved.frame).toBe(40)
    expect(moved.caught).toBe(100)
    expect(moved.frame).toBe(snapMove(38, 60, [0, 100], 6))
  })

  it('names the start when the start is what caught', () => {
    const moved = snapMoveTo(96, 20, [100, 400], 6)
    expect(moved).toEqual({ frame: 100, caught: 100 })
  })

  it('names nothing when nothing is in reach', () => {
    expect(snapMoveTo(200, 60, [0, 500], 6)).toEqual({ frame: 200, caught: null })
  })

  it('names nothing when the start of the sequence is what held it, not a target', () => {
    // Its start at -3 catches 0 and is held there: 0 is a target, so it is named.
    expect(snapMoveTo(-3, 60, [0], 6)).toEqual({ frame: 0, caught: 0 })
    // Nothing in reach: it lands where it was put, as it always did, and
    // names nothing. Holding it inside the sequence is the caller's business.
    const far = snapMoveTo(-40, 60, [900], 6)
    expect(far.frame).toBe(snapMove(-40, 60, [900], 6))
    expect(far.caught).toBe(null)
  })
})

describe('a trim snapped to a cut', () => {
  const trim = { closesUp: false, edge: 'end' as const, startAt: 100, inAt: 0, outAt: 200, targets: [0, 260], within: 8 }

  it('lands where it always did, and names the cut it caught', () => {
    const at = snapTrimTo({ ...trim, frame: 155 })
    expect(at.frame).toBe(snapTrim({ ...trim, frame: 155 }))
    expect(at.caught).toBe(260)
  })

  it('names nothing when the edge caught nothing', () => {
    const at = snapTrimTo({ ...trim, frame: 100 })
    expect(at).toEqual({ frame: 100, caught: null })
    expect(at.frame).toBe(snapTrim({ ...trim, frame: 100 }))
  })

  it('names the cut on screen for a head trim that closes up, which moves the other way', () => {
    const closing = { closesUp: true, edge: 'start' as const, startAt: 100, inAt: 0, outAt: 200, targets: [140], within: 8 }
    // Its end sits at 100 + (200 - frame), so frame 158 puts it at 142, in reach of 140.
    const at = snapTrimTo({ ...closing, frame: 158 })
    expect(at.frame).toBe(snapTrim({ ...closing, frame: 158 }))
    expect(at.caught).toBe(140)
    expect(at.frame).toBe(160)
  })
})

describe('snapping turned off', () => {
  it('reaches as far as the snapping distance in frames while on, and nothing at all while off', () => {
    expect(snapReach(true, 2)).toBe(SNAP_PX / 2)
    const off = snapReach(false, 2)
    // Not even a target the edge is already on: nothing is caught, so no guide line is drawn.
    expect(snapFrameTo(100, [100], off)).toEqual({ frame: 100, caught: null })
    expect(snapMoveTo(97, 10, [100], off)).toEqual({ frame: 97, caught: null })
    expect(snapTrimTo({ closesUp: false, edge: 'end', frame: 99, startAt: 0, inAt: 0, outAt: 90, targets: [100], within: off })).toEqual({ frame: 99, caught: null })
  })
})
