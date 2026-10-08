import { describe, it, expect } from 'vitest'
import { appearAt, appearExpressions, cleanAppear, popScale, type Appear } from '../../src/shared/appear'

/** An ffmpeg expression of `t`, as this file writes them, worked out: numbers, t, + - * /, brackets, pow and clip. */
function evaluate(source: string, t: number): number {
  let i = 0
  const peek = (): string => source[i] ?? ''
  const take = (c: string): void => {
    if (source[i] !== c) throw new Error(`expected ${c} at ${i} in ${source}`)
    i++
  }
  const primary = (): number => {
    if (peek() === '(') {
      i++
      const v = sum()
      take(')')
      return v
    }
    if (peek() === '-') {
      i++
      return -primary()
    }
    const num = source.slice(i).match(/^\d+(\.\d+)?/)
    if (num) {
      i += num[0].length
      return Number(num[0])
    }
    const name = source.slice(i).match(/^[a-z]+/)
    if (!name) throw new Error(`cannot read ${source.slice(i)}`)
    i += name[0].length
    if (name[0] === 't') return t
    take('(')
    const args = [sum()]
    while (peek() === ',') {
      i++
      args.push(sum())
    }
    take(')')
    const [a = 0, b = 0, c = 0] = args
    if (name[0] === 'pow') return Math.pow(a, b)
    if (name[0] === 'clip') return Math.min(c, Math.max(b, a))
    throw new Error(`no function ${name[0]}`)
  }
  const product = (): number => {
    let v = primary()
    while (peek() === '*' || peek() === '/') {
      const op = source[i++]
      const r = primary()
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  const sum = (): number => {
    let v = product()
    while (peek() === '+' || peek() === '-') {
      const op = source[i++]
      const r = product()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  const v = sum()
  if (i !== source.length) throw new Error(`left over: ${source.slice(i)}`)
  return v
}

/** What ffmpeg's `fade` makes of a frame at `t` seconds: the alpha it keeps, 0 to 1. */
function fadeAt(filter: string, t: number): number {
  const m = filter.match(/^fade=t=(in|out):st=([\d.]+):d=([\d.]+):alpha=1$/)
  if (!m) throw new Error(`not a fade: ${filter}`)
  const [, dir, st, d] = m
  const p = Math.min(1, Math.max(0, (t - Number(st)) / Number(d)))
  return dir === 'in' ? p : 1 - p
}

const fade = (length: number): Appear => ({ kind: 'fade', length })
const pop = (length: number): Appear => ({ kind: 'pop', length })

describe('coming in and going out', () => {
  it('fades in from nothing over its length, and out to nothing at the clip end', () => {
    expect(appearAt(0, 100, fade(10), undefined)).toEqual({ alpha: 0, scale: 1 })
    expect(appearAt(5, 100, fade(10), undefined).alpha).toBeCloseTo(0.5)
    expect(appearAt(10, 100, fade(10), undefined)).toEqual({ alpha: 1, scale: 1 })
    expect(appearAt(90, 100, undefined, fade(10)).alpha).toBe(1)
    expect(appearAt(95, 100, undefined, fade(10)).alpha).toBeCloseTo(0.5)
    expect(appearAt(99, 100, undefined, fade(10)).alpha).toBeCloseTo(0.1)
  })

  it('pops in from nothing, grows a little past its size, and settles', () => {
    expect(popScale(0)).toBeCloseTo(0)
    expect(popScale(1)).toBe(1)
    const sizes = Array.from({ length: 11 }, (_, i) => popScale(i / 10))
    expect(Math.max(...sizes)).toBeGreaterThan(1.05)
    expect(Math.max(...sizes)).toBeLessThan(1.12)
    expect(appearAt(0, 100, pop(10), undefined).scale).toBeCloseTo(0)
    expect(appearAt(50, 100, pop(10), pop(10))).toEqual({ alpha: 1, scale: 1 })
  })

  it('never takes longer than the clip', () => {
    expect(appearAt(4, 8, fade(30), undefined).alpha).toBeCloseTo(0.5)
    expect(appearExpressions(8, 30, undefined, fade(30)).fades).toEqual(['fade=t=out:st=0:d=0.266667:alpha=1'])
  })

  it('is written for ffmpeg as the same sums, on every frame of the clip', () => {
    const fps = 30
    const length = 90
    for (const [enter, exit] of [
      [pop(15), fade(12)],
      [fade(20), pop(9)],
      [pop(30), pop(30)],
      [fade(45), fade(45)]
    ] as [Appear, Appear][]) {
      const { scale, fades } = appearExpressions(length, fps, enter, exit)
      for (let f = 0; f < length; f++) {
        const t = f / fps
        const want = appearAt(f, length, enter, exit)
        expect(scale === null ? 1 : evaluate(scale, t)).toBeCloseTo(want.scale, 5)
        expect(fades.reduce((a, x) => a * fadeAt(x, t), 1)).toBeCloseTo(want.alpha, 5)
      }
    }
  })

  it('keeps only what it can use from a file', () => {
    expect(cleanAppear({ kind: 'pop', length: 14.6 })).toEqual({ kind: 'pop', length: 15 })
    expect(cleanAppear({ kind: 'spin', length: 10 })).toBeUndefined()
    expect(cleanAppear({ kind: 'fade', length: 0 })).toBeUndefined()
    expect(cleanAppear({ kind: 'fade' })).toBeUndefined()
    expect(cleanAppear(null)).toBeUndefined()
  })
})
