import { describe, it, expect } from 'vitest'
import { estimateRemaining, formatRemaining, smoothRemaining } from '../../src/shared/progress'

describe('estimating the time left', () => {
  it('says nothing in the first moments, which are spent starting up', () => {
    expect(estimateRemaining(0.5, 1000)).toBeNull()
    expect(estimateRemaining(0.01, 60_000)).toBeNull()
    expect(estimateRemaining(0, 60_000)).toBeNull()
  })

  it('works the rest out at the pace so far', () => {
    // A quarter done in ten seconds leaves thirty.
    expect(estimateRemaining(0.25, 10_000)).toBeCloseTo(30)
    expect(estimateRemaining(0.5, 4000)).toBeCloseTo(4)
  })

  it('says nothing once the job is done', () => {
    expect(estimateRemaining(1, 10_000)).toBeNull()
  })

  it('refuses what is not a number', () => {
    expect(estimateRemaining(Number.NaN, 10_000)).toBeNull()
    expect(estimateRemaining(0.5, Number.NaN)).toBeNull()
  })
})

describe('smoothing the estimate', () => {
  it('takes the first estimate as it is', () => {
    expect(smoothRemaining(null, 40, 0)).toBe(40)
  })

  it('moves only part of the way towards a new estimate, from the old one counted down', () => {
    // The old 40 has had 1 second taken off; a new 20 pulls it 30% of the way.
    expect(smoothRemaining(40, 20, 1)).toBeCloseTo(0.7 * 39 + 0.3 * 20)
  })

  it('keeps counting down between estimates', () => {
    expect(smoothRemaining(10, null, 2)).toBe(8)
    expect(smoothRemaining(null, null, 2)).toBeNull()
  })

  it('never goes below zero', () => {
    expect(smoothRemaining(1, null, 5)).toBe(0)
    expect(smoothRemaining(1, 0, 5)).toBe(0)
  })
})

describe('saying the time left', () => {
  it('says nothing for the last few seconds', () => {
    expect(formatRemaining(null)).toBeNull()
    expect(formatRemaining(2)).toBeNull()
  })

  it('rounds seconds to fives', () => {
    expect(formatRemaining(3)).toBe('about 5 seconds left')
    expect(formatRemaining(23)).toBe('about 25 seconds left')
    expect(formatRemaining(41)).toBe('about 40 seconds left')
  })

  it('says minutes from a minute on', () => {
    expect(formatRemaining(58)).toBe('about a minute left')
    expect(formatRemaining(150)).toBe('about 3 minutes left')
  })

  it('says hours and minutes for a long one', () => {
    expect(formatRemaining(3600)).toBe('about 1 hour left')
    expect(formatRemaining(3600 + 60 * 25)).toBe('about 1 hour 25 minutes left')
    expect(formatRemaining(7200 + 60)).toBe('about 2 hours 1 minute left')
  })
})
