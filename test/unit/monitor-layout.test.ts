import { describe, it, expect } from 'vitest'
import { SIDE_GAP, SIDE_INSET, monitorLayout, showsBoth } from '../../src/shared/monitor-layout'

/**
 * Plan 16 step 2: where the Source and Output views go in the monitor, side
 * by side for a vertical frame, or one alone.
 */

const VERTICAL = { width: 1080, height: 1920 }

describe('whether the monitor shows both views', () => {
  it('does for a frame taller than wide on a monitor at least as wide as tall, when asked to', () => {
    expect(showsBoth({ width: 900, height: 500 }, VERTICAL, true)).toBe(true)
    expect(showsBoth({ width: 500, height: 500 }, { width: 1080, height: 1350 }, true)).toBe(true)
  })

  it('does not when not asked to, for a landscape or square frame, on a tall monitor, with no frame, or before the monitor has a size', () => {
    expect(showsBoth({ width: 900, height: 500 }, VERTICAL, false)).toBe(false)
    expect(showsBoth({ width: 900, height: 500 }, { width: 1920, height: 1080 }, true)).toBe(false)
    expect(showsBoth({ width: 900, height: 500 }, { width: 1080, height: 1080 }, true)).toBe(false)
    expect(showsBoth({ width: 400, height: 600 }, VERTICAL, true)).toBe(false)
    expect(showsBoth({ width: 900, height: 500 }, null, true)).toBe(false)
    expect(showsBoth({ width: 0, height: 0 }, VERTICAL, true)).toBe(false)
  })
})

describe('where each view goes', () => {
  it('puts the Output on the right at the height of the monitor, a few pixels in, and the Source in the rest, a gap between', () => {
    const l = monitorLayout({ width: 900, height: 500 }, 'source', VERTICAL, true)
    // 492 high, 4 pixels in from the top and bottom, at 9:16 is 276.75 wide, taken as 276, and 4 in from the right.
    expect(SIDE_INSET).toBe(4)
    expect(l.program).toEqual({ x: 620, y: 4, width: 276, height: 492 })
    expect(l.source).toEqual({ x: 0, y: 0, width: 620 - SIDE_GAP, height: 500 })
    // Which view the keys act on changes nothing here.
    expect(monitorLayout({ width: 900, height: 500 }, 'program', VERTICAL, true)).toEqual(l)
  })

  it('never gives the Output more than half the width', () => {
    const l = monitorLayout({ width: 600, height: 590 }, 'program', { width: 1080, height: 1350 }, true)
    // Half of 600, less the 4 kept clear at the right.
    expect(l.program).toEqual({ x: 300, y: 4, width: 296, height: 582 })
    expect(l.source).toEqual({ x: 0, y: 0, width: 300 - SIDE_GAP, height: 590 })
  })

  it('gives one view the whole monitor otherwise, the one the keys act on', () => {
    const whole = { x: 0, y: 0, width: 900, height: 500 }
    expect(monitorLayout({ width: 900, height: 500 }, 'source', VERTICAL, false)).toEqual({ source: whole, program: null })
    expect(monitorLayout({ width: 900, height: 500 }, 'program', { width: 1920, height: 1080 }, true)).toEqual({ source: null, program: whole })
  })
})
