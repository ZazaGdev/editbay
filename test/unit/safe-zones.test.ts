import { describe, it, expect } from 'vitest'
import { SAFE_ZONES, cleanSafeZoneChoice, safeFractions, safeMargins, titleSafeRect } from '../../src/shared/safe-zones'

describe('safe zones', () => {
  it("gives each app's margins", () => {
    expect(safeMargins('reels')).toEqual({ top: 269, bottom: 672, left: 65, right: 65 })
    expect(safeMargins('tiktok')).toEqual(SAFE_ZONES.tiktok.margins)
    expect(safeMargins('shorts')).toEqual(SAFE_ZONES.shorts.margins)
  })

  it('keeps clear of all three at once with the widest margin on each side', () => {
    expect(safeMargins('all')).toEqual({ top: 288, bottom: 672, left: 65, right: 192 })
  })

  it('has nothing for none', () => {
    expect(safeMargins('none')).toBeNull()
  })

  it('gives fractions of a tall frame, so they fit any vertical size', () => {
    const f = safeFractions('reels', 1080, 1920)!
    expect(f.top).toBeCloseTo(0.14, 2)
    expect(f.bottom).toBeCloseTo(0.35, 2)
    expect(f.left).toBeCloseTo(0.06, 2)
    expect(safeFractions('reels', 720, 1280)).toEqual(f)
  })

  it('has nothing for a frame that is not tall', () => {
    expect(safeFractions('tiktok', 1920, 1080)).toBeNull()
    expect(safeFractions('tiktok', 1080, 1080)).toBeNull()
  })

  it('reads a stored choice, and falls back to none', () => {
    expect(cleanSafeZoneChoice('shorts')).toBe('shorts')
    expect(cleanSafeZoneChoice('all')).toBe('all')
    expect(cleanSafeZoneChoice('instagram')).toBe('none')
    expect(cleanSafeZoneChoice(undefined)).toBe('none')
  })
})

describe('the title safe area a dragged box lines up with', () => {
  it("is the chosen app's safe zone on a tall frame", () => {
    const r = titleSafeRect('reels', 1080, 1920)
    expect(r.x).toBeCloseTo(65)
    expect(r.y).toBeCloseTo(269)
    expect(r.w).toBeCloseTo(950)
    expect(r.h).toBeCloseTo(979)
  })

  it('is the usual tenth in from each side with no app chosen, or on a wide frame', () => {
    const r = titleSafeRect('none', 1080, 1920)
    expect([r.x, r.y, r.w, r.h].map(Math.round)).toEqual([108, 192, 864, 1536])
    const wide = titleSafeRect('tiktok', 1920, 1080)
    expect(wide.x).toBeCloseTo(192)
    expect(wide.y).toBeCloseTo(108)
    expect(wide.w).toBeCloseTo(1536)
  })
})
