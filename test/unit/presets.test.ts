import { describe, it, expect } from 'vitest'
import { PRESETS, presetById, outputSizeFor, HANDOFF_CAP } from '../../src/shared/presets'

describe('the preset list', () => {
  it('offers the shapes the app exists to produce', () => {
    const ids = PRESETS.map((p) => p.id)
    expect(ids).toContain('vertical')
    expect(ids).toContain('landscape')
    expect(ids).toContain('square')
    expect(ids).toContain('handoff')
  })

  it('has a unique id for each', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length)
  })

  it('writes vertical at the size the platforms want', () => {
    const p = presetById('vertical')
    expect(p.width).toBe(1080)
    expect(p.height).toBe(1920)
  })

  it('marks the handoff preset as one file per clip', () => {
    // Its output size follows each clip's crop, and segments of differing sizes
    // cannot be copy-joined.
    expect(presetById('handoff').joinable).toBe(false)
    expect(presetById('handoff').width).toBeNull()
  })

  it('lets every fixed size preset be joined', () => {
    for (const p of PRESETS.filter((x) => x.width !== null)) {
      expect(p.joinable).toBe(true)
    }
  })

  it('uses only even dimensions, because H.264 requires them', () => {
    for (const p of PRESETS) {
      if (p.width !== null) expect(p.width % 2).toBe(0)
      if (p.height !== null) expect(p.height % 2).toBe(0)
    }
  })

  it('refuses an unknown id rather than guessing', () => {
    expect(() => presetById('nope')).toThrow(/unknown preset/i)
  })
})

describe('outputSizeFor', () => {
  it('uses the preset size whatever the crop is', () => {
    expect(outputSizeFor(presetById('vertical'), { w: 600, h: 400 })).toEqual({ width: 1080, height: 1920 })
    expect(outputSizeFor(presetById('square'), { w: 4000, h: 10 })).toEqual({ width: 1080, height: 1080 })
  })

  it('keeps the cropped region for the handoff preset', () => {
    expect(outputSizeFor(presetById('handoff'), { w: 1200, h: 2100 })).toEqual({ width: 1200, height: 2100 })
  })

  it('scales a handoff crop down to the 4K ceiling', () => {
    const size = outputSizeFor(presetById('handoff'), { w: 6000, h: 3000 })
    expect(Math.max(size.width, size.height)).toBe(HANDOFF_CAP)
    expect(size.width / size.height).toBeCloseTo(2, 2)
  })

  it('always returns even dimensions', () => {
    const size = outputSizeFor(presetById('handoff'), { w: 1001, h: 777 })
    expect(size.width % 2).toBe(0)
    expect(size.height % 2).toBe(0)
  })

  it('never returns nothing', () => {
    const size = outputSizeFor(presetById('handoff'), { w: 0, h: 0 })
    expect(size.width).toBeGreaterThan(0)
    expect(size.height).toBeGreaterThan(0)
  })
})
