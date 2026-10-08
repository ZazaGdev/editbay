import { describe, it, expect, vi, afterEach } from 'vitest'
import { setMediaTime } from '../../../src/renderer/preview/lanes'

/** A player whose seek never lands: it stays seeking, and never says it has. */
class StuckPlayer {
  readyState = 4
  seeking = true
  private time = 0
  private readonly listeners = new Map<string, (() => void)[]>()
  get currentTime(): number {
    return this.time
  }
  set currentTime(t: number) {
    this.time = t
  }
  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn()
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('a seek that never lands', () => {
  it('holds later places back only for a moment, then goes to them anyway', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const el = new StuckPlayer()
    const media = el as unknown as HTMLMediaElement
    setMediaTime(media, 1)
    // Waiting on the seek already under way, as a fast drag should.
    expect(el.currentTime).toBe(0)
    vi.advanceTimersByTime(600)
    setMediaTime(media, 2)
    expect(el.currentTime).toBe(2)
  })

  it('forgets the place it held back when the file fails, so a late landing does not jump there', () => {
    const el = new StuckPlayer()
    const media = el as unknown as HTMLMediaElement
    setMediaTime(media, 5)
    el.fire('error')
    el.seeking = false
    el.fire('seeked')
    expect(el.currentTime).toBe(0)
  })
})
