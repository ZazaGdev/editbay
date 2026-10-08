import { describe, it, expect } from 'vitest'
import { ratesSuggestVfr, deltasIndicateVfr } from '../../src/main/media/vfr'

describe('ratesSuggestVfr', () => {
  it('passes a file whose rates agree', () => {
    expect(ratesSuggestVfr(30, 30)).toBe(false)
    expect(ratesSuggestVfr(29.97, 29.97)).toBe(false)
  })

  it('flags the 1000/1 nominal rate that recorders write for variable files', () => {
    expect(ratesSuggestVfr(1000, 29.97)).toBe(true)
  })

  it('flags rates that disagree by more than a rounding error', () => {
    expect(ratesSuggestVfr(60, 43.2)).toBe(true)
  })

  it('tolerates the tiny disagreement a truncated duration produces', () => {
    expect(ratesSuggestVfr(30, 29.996)).toBe(false)
  })

  it('flags a file with no usable average rate', () => {
    expect(ratesSuggestVfr(30, 0)).toBe(true)
  })
})

function evenly(count: number, step: number): number[] {
  return Array.from({ length: count }, (_, i) => i * step)
}

describe('deltasIndicateVfr', () => {
  it('accepts a perfectly even sequence', () => {
    expect(deltasIndicateVfr(evenly(300, 1 / 30))).toBe(false)
  })

  it('accepts millisecond container quantisation at 30fps', () => {
    const times = Array.from({ length: 300 }, (_, i) => Math.round((i / 30) * 1000) / 1000)
    expect(deltasIndicateVfr(times)).toBe(false)
  })

  it('flags a recording that drops frames', () => {
    const times: number[] = []
    let t = 0
    for (let i = 0; i < 300; i++) {
      times.push(t)
      t += i % 5 === 0 ? 2 / 30 : 1 / 30
    }
    expect(deltasIndicateVfr(times)).toBe(true)
  })

  it('flags a recording whose rate changes partway through', () => {
    const times = [...evenly(150, 1 / 60), ...evenly(150, 1 / 30).map((t) => t + 150 / 60)]
    expect(deltasIndicateVfr(times)).toBe(true)
  })

  it('ignores a single outlier, which is a seek artefact rather than variable timing', () => {
    const times = evenly(300, 1 / 30)
    times[200] = (times[200] ?? 0) + 0.004
    expect(deltasIndicateVfr(times)).toBe(false)
  })

  it('cannot decide from too few samples and says no', () => {
    expect(deltasIndicateVfr([0, 0.033, 0.066])).toBe(false)
  })

  it('sorts timestamps that arrive out of order because of B-frames', () => {
    const times = evenly(300, 1 / 30)
    const a = times[10] ?? 0
    const b = times[11] ?? 0
    times[10] = b
    times[11] = a
    expect(deltasIndicateVfr(times)).toBe(false)
  })
})
