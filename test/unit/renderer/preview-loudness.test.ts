import { describe, it, expect, afterEach } from 'vitest'
import { PreviewLoudness } from '../../../src/renderer/preview/loudness'

/**
 * A clip set above 100% was never heard above 100%: a media element's volume
 * stops at 1, so the preview lowered every other clip instead, and a clip
 * that was the only one heard sounded exactly as it did at 100%.
 *
 * What matters here as much as the raising is what happens when it cannot be
 * done. An element routed into an audio context that is not running is
 * silent, so a preview that goes quiet is a far worse fault than one that is
 * merely not loud enough. Every refusal has to leave the players alone.
 */

interface FakeNode {
  gain: { value: number }
  connect: (to: unknown) => void
  connectedTo: unknown
}

class FakeContext {
  state: 'running' | 'suspended' = 'running'
  destination = { name: 'destination' }
  closed = false
  resumed = 0
  /** Every element handed a source node, in order, including the repeats that throw. */
  readonly sourced: unknown[] = []
  /** Throws for an element already routed, as a real one does. */
  refuseSecondSource = true

  createGain(): FakeNode {
    return { gain: { value: 1 }, connect(to: unknown) { this.connectedTo = to }, connectedTo: null }
  }

  /** Every time one was asked for, refused or not: a second ask for the same element is a fault. */
  attempts = 0

  /** Each source node made, by the element it was made for, and whether it is still connected. */
  readonly nodes = new Map<unknown, { connected: boolean }>()

  createMediaElementSource(el: unknown): { connect: (to: unknown) => void; disconnect: () => void } {
    this.attempts += 1
    if (this.refuseSecondSource && this.sourced.includes(el)) throw new Error('already connected')
    this.sourced.push(el)
    const state = { connected: false }
    this.nodes.set(el, state)
    return {
      connect: () => {
        state.connected = true
      },
      disconnect: () => {
        state.connected = false
      }
    }
  }

  async resume(): Promise<void> {
    this.resumed += 1
    // A real one comes back running a tick later, not in the same breath.
    await Promise.resolve()
    this.state = 'running'
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

const made: FakeContext[] = []

/** Put a fake AudioContext in place, or one that refuses to be made at all. */
function useFakeAudio(opts: { refuse?: boolean; startSuspended?: boolean } = {}): void {
  ;(globalThis as { AudioContext?: unknown }).AudioContext = function (this: unknown) {
    if (opts.refuse) throw new Error('no audio here')
    const ctx = new FakeContext()
    if (opts.startSuspended) ctx.state = 'suspended'
    made.push(ctx)
    return ctx
  } as unknown as typeof AudioContext
}

afterEach(() => {
  made.length = 0
  delete (globalThis as { AudioContext?: unknown }).AudioContext
})

/** Stand-ins for the preview's players. */
function players(n: number): HTMLMediaElement[] {
  return Array.from({ length: n }, (_, i) => ({ id: `player-${i}` }) as unknown as HTMLMediaElement)
}

describe('playing the preview louder than an element allows', () => {
  it('builds nothing while the mix fits inside what an element takes', () => {
    useFakeAudio()
    const loudness = new PreviewLoudness()
    loudness.want(1, players(2))
    expect(made).toHaveLength(0)
    expect(loudness.routing).toBe(false)
  })

  it('routes the players through one gain once a clip asks to be louder', () => {
    useFakeAudio()
    const loudness = new PreviewLoudness()
    const els = players(3)
    loudness.want(4, els)
    expect(made).toHaveLength(1)
    expect(made[0]!.sourced).toEqual(els)
    expect(loudness.routing).toBe(true)
  })

  it('sets the gain to exactly what was asked, so a clip is heard at its own loudness', () => {
    useFakeAudio()
    const loudness = new PreviewLoudness()
    const els = players(1)
    loudness.want(4, els)
    // Every element plays at its gain divided by the loudest; this is the divide put back.
    loudness.want(2.5, els)
    expect(made).toHaveLength(1)
  })

  it('routes each player once, however often the clips change', () => {
    useFakeAudio()
    const loudness = new PreviewLoudness()
    const els = players(2)
    loudness.want(4, els)
    loudness.want(4, els)
    loudness.want(3, els)
    expect(made[0]!.sourced).toHaveLength(2)
    // Asked for once each. Asking twice for the same element throws in a real one.
    expect(made[0]!.attempts).toBe(2)
  })

  it('takes in a player added later', () => {
    useFakeAudio()
    const loudness = new PreviewLoudness()
    const first = players(1)
    loudness.want(4, first)
    const both = [...first, ...players(1)]
    loudness.want(4, both)
    expect(made[0]!.sourced).toHaveLength(2)
  })

  it('routes nothing into a context that is not running, which would silence it', () => {
    useFakeAudio({ startSuspended: true })
    const loudness = new PreviewLoudness()
    const els = players(2)
    loudness.want(4, els)
    expect(made).toHaveLength(1)
    expect(made[0]!.sourced).toEqual([])
    expect(loudness.routing).toBe(false)
    // It asked to be started, which needs a gesture.
    expect(made[0]!.resumed).toBeGreaterThan(0)
  })

  it('routes once playback starts it, which is the gesture it was waiting for', async () => {
    useFakeAudio({ startSuspended: true })
    const loudness = new PreviewLoudness()
    const els = players(2)
    loudness.want(4, els)
    expect(made[0]!.sourced).toEqual([])
    made[0]!.state = 'running'
    loudness.resume(els)
    expect(made[0]!.sourced).toEqual(els)
  })

  it('leaves the players alone when the browser will not make a context at all', () => {
    useFakeAudio({ refuse: true })
    const loudness = new PreviewLoudness()
    expect(() => loudness.want(4, players(2))).not.toThrow()
    expect(loudness.routing).toBe(false)
  })

  it('tries only once after it is refused', () => {
    let tried = 0
    ;(globalThis as { AudioContext?: unknown }).AudioContext = function () {
      tried += 1
      throw new Error('no audio here')
    } as unknown as typeof AudioContext
    const loudness = new PreviewLoudness()
    loudness.want(4, players(1))
    loudness.want(4, players(1))
    loudness.want(4, players(1))
    expect(tried).toBe(1)
  })

  it('carries on when one player refuses a source node, rather than throwing', () => {
    useFakeAudio()
    const loudness = new PreviewLoudness()
    const el = players(1)[0]!
    const other = new PreviewLoudness()
    loudness.want(4, [el])
    // A second router over the same element: the real one throws there.
    expect(() => other.want(4, [el])).not.toThrow()
  })

  it('refuses a gain that is not a number', () => {
    useFakeAudio()
    const loudness = new PreviewLoudness()
    loudness.want(Number.NaN, players(1))
    expect(made).toHaveLength(0)
  })

  it('takes a player off the gain when it goes, and leaves the others on it', () => {
    useFakeAudio()
    const loudness = new PreviewLoudness()
    const [gone, kept] = players(2)
    loudness.want(4, [gone!, kept!])
    expect(made[0]!.nodes.get(gone)!.connected).toBe(true)
    // Its track removed: nothing of the context holds on to it any longer.
    loudness.release(gone!)
    expect(made[0]!.nodes.get(gone)!.connected).toBe(false)
    expect(made[0]!.nodes.get(kept)!.connected).toBe(true)
    expect(loudness.routing).toBe(true)
    // Told twice, as when a lane and then the preview both let go, it is no fault.
    expect(() => loudness.release(gone!)).not.toThrow()
    loudness.release(kept!)
    expect(loudness.routing).toBe(false)
  })

  it('closes its context when the preview goes', () => {
    useFakeAudio()
    const loudness = new PreviewLoudness()
    loudness.want(4, players(1))
    loudness.close()
    expect(made[0]!.closed).toBe(true)
    expect(loudness.routing).toBe(false)
  })
})
