import { describe, it, expect } from 'vitest'
import { peaksForRange, quietestSecond, waveHeight, waveTiles } from '../../src/shared/peaks'

/** Full-scale audio for `seconds`, at 100 buckets per second. */
function loud(seconds: number, peaksPerSecond = 100): Int16Array {
  const out = new Int16Array(seconds * peaksPerSecond * 2)
  for (let i = 0; i < out.length; i += 2) {
    out[i] = -30000
    out[i + 1] = 30000
  }
  return out
}

describe('peaksForRange', () => {
  it('returns one column per requested pixel', () => {
    expect(peaksForRange(loud(4), 100, 0, 4, 200)).toHaveLength(200)
    expect(peaksForRange(loud(4), 100, 0, 4, 7)).toHaveLength(7)
  })

  it('normalises to between minus one and one', () => {
    for (const c of peaksForRange(loud(2), 100, 0, 2, 50)) {
      expect(c.max).toBeGreaterThan(0.8)
      expect(c.max).toBeLessThanOrEqual(1)
      expect(c.min).toBeLessThan(-0.8)
      expect(c.min).toBeGreaterThanOrEqual(-1)
    }
  })

  it('reads only the requested slice of time', () => {
    const peaks = new Int16Array(400 * 2)
    // Loud only from the second half onward, which is seconds 2 to 4.
    for (let i = 200 * 2; i < peaks.length; i += 2) {
      peaks[i] = -30000
      peaks[i + 1] = 30000
    }
    const first = peaksForRange(peaks, 100, 0, 2, 10)
    const second = peaksForRange(peaks, 100, 2, 4, 10)
    expect(Math.max(...first.map((c) => c.max))).toBe(0)
    expect(Math.min(...second.map((c) => c.max))).toBeGreaterThan(0.8)
  })

  it('gives silence for an empty peaks file', () => {
    const cols = peaksForRange(new Int16Array(0), 100, 0, 4, 20)
    expect(cols).toHaveLength(20)
    expect(cols.every((c) => c.min === 0 && c.max === 0)).toBe(true)
  })

  it('gives silence past the end of the data rather than reading nonsense', () => {
    const cols = peaksForRange(loud(1), 100, 5, 9, 20)
    expect(cols.every((c) => c.min === 0 && c.max === 0)).toBe(true)
  })

  it('handles a zoom so deep that one bucket spans many columns', () => {
    const cols = peaksForRange(loud(4), 100, 1.0, 1.02, 40)
    expect(cols).toHaveLength(40)
    expect(cols.every((c) => c.max > 0.8)).toBe(true)
  })

  it('returns nothing for a non-positive column count', () => {
    expect(peaksForRange(loud(4), 100, 0, 4, 0)).toEqual([])
    expect(peaksForRange(loud(4), 100, 0, 4, -3)).toEqual([])
  })

  it('returns silence for an inverted range rather than throwing', () => {
    const cols = peaksForRange(loud(4), 100, 3, 1, 10)
    expect(cols).toHaveLength(10)
    expect(cols.every((c) => c.min === 0 && c.max === 0)).toBe(true)
  })

  it('survives a nonsense bucket rate', () => {
    expect(peaksForRange(loud(4), 0, 0, 4, 5).every((c) => c.max === 0)).toBe(true)
  })
})

describe('how high a level is drawn', () => {
  it('draws nothing for silence and the full height for full scale', () => {
    expect(waveHeight(0)).toBe(0)
    expect(waveHeight(1)).toBe(1)
  })

  it('draws quiet material as a wave rather than a line', () => {
    // Game audio around -30 dB: a fortieth of the way up on a straight scale,
    // which rounds to a flat line on a track forty pixels tall.
    const quiet = 0.032
    expect(quiet * 20).toBeLessThan(1)
    expect(waveHeight(quiet)).toBeGreaterThan(0.3)
    // Many times taller than the level itself, which is the whole point.
    expect(waveHeight(quiet)).toBeGreaterThan(quiet * 8)
  })

  it('still draws louder material taller, so the shape is kept', () => {
    expect(waveHeight(0.5)).toBeGreaterThan(waveHeight(0.1))
    expect(waveHeight(0.1)).toBeGreaterThan(waveHeight(0.02))
  })

  it('reads a negative level as how far it is from the middle', () => {
    expect(waveHeight(-0.5)).toBe(waveHeight(0.5))
  })

  it('stops at the floor, so silence stays flat', () => {
    expect(waveHeight(0.002)).toBe(0)
    expect(waveHeight(0.01)).toBeGreaterThan(0)
  })

  it('never goes over the full height, whatever it is handed', () => {
    expect(waveHeight(9)).toBe(1)
  })
})

describe('waveTiles', () => {
  it('cuts a wide waveform into tiles that cover it end to end, none wider than asked', () => {
    const tiles = waveTiles(72000.5, 2048)
    expect(tiles[0]).toEqual({ left: 0, width: 2048 })
    expect(tiles.every((t) => t.width <= 2048 && Number.isInteger(t.left))).toBe(true)
    for (let i = 1; i < tiles.length; i++) expect(tiles[i]!.left).toBe(tiles[i - 1]!.left + tiles[i - 1]!.width)
    const last = tiles[tiles.length - 1]!
    expect(last.left + last.width).toBe(72000.5)
  })

  it('keeps a narrow waveform in one tile, and an empty one in none', () => {
    expect(waveTiles(300, 2048)).toEqual([{ left: 0, width: 300 }])
    expect(waveTiles(0, 2048)).toEqual([])
    expect(waveTiles(Number.NaN, 2048)).toEqual([])
  })
})

describe('the quietest second of a waveform', () => {
  /** Ten peaks a second, at these levels, one level a second. */
  const wave = (levels: number[]): Int16Array => {
    const p = new Int16Array(levels.length * 10 * 2)
    levels.forEach((l, s) => {
      for (let b = s * 10; b < (s + 1) * 10; b++) {
        p[b * 2] = -l
        p[b * 2 + 1] = l
      }
    })
    return p
  }

  it('is where the loudest peak is lowest, the first of two that tie', () => {
    expect(quietestSecond(wave([9000, 300, 8000, 300, 7000]), 10)).toBe(1)
  })

  it('passes over digital silence, which has no noise to learn', () => {
    expect(quietestSecond(wave([0, 9000, 400, 0]), 10)).toBe(2)
    expect(quietestSecond(wave([0, 0]), 10)).toBeNull()
  })

  it('is nothing for less than a second', () => {
    expect(quietestSecond(new Int16Array(10), 10)).toBeNull()
  })
})

describe('the wave zoomed in past one bucket to a pixel', () => {
  it('runs smoothly from one bucket to the next rather than in flat steps', () => {
    // Two buckets, quiet then loud, drawn 20 columns wide.
    const peaks = new Int16Array([-1000, 1000, -30000, 30000])
    const cols = peaksForRange(peaks, 100, 0, 0.02, 20)
    const tops = cols.map((c) => c.max)
    // Rising all the way across the middle, never jumping from one level to the other.
    for (let i = 6; i < 14; i++) expect(tops[i + 1]!).toBeGreaterThan(tops[i]!)
    expect(tops[0]!).toBeCloseTo(1000 / 32767, 3)
    expect(tops[19]!).toBeCloseTo(30000 / 32767, 3)
  })

  it('reads silence past the end of the data', () => {
    const peaks = new Int16Array([-1000, 1000])
    const cols = peaksForRange(peaks, 100, 0.01, 0.02, 10)
    expect(cols.every((c) => c.min === 0 && c.max === 0)).toBe(true)
  })
})
