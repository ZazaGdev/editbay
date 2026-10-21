import { describe, it, expect } from 'vitest'
import { chunkKey, chunksBetween, gainCurve, startOf, voiceSamples, voiceShape, type SoundVoice } from '../../src/shared/sound-chunks'

/** Plan 106: the sound engine's sample arithmetic. */

const RATE = 48000

function voice(id: string, startSec: number, endSec: number, fileAtStart: number, extra: Partial<SoundVoice> = {}): SoundVoice {
  return { id, mediaId: 'm', track: 0, denoise: false, startSec, endSec, fileAtStart, gain: 1, ...extra }
}

describe('stretches of a voice', () => {
  it('cuts a voice into whole stretches from its own start, the last one short', () => {
    const v = voice('a', 1, 5.5, 10)
    const all = chunksBetween(v, RATE, 0, 10 * RATE)
    expect(all.map((c) => [c.index, c.at, c.frames, c.fileSec])).toEqual([
      [0, 48000, 96000, 10],
      [1, 144000, 96000, 12],
      [2, 240000, 24000, 14]
    ])
  })

  it('gives only the stretches over the samples asked for, cut the same way wherever the asking starts', () => {
    const v = voice('a', 1, 5.5, 10)
    const some = chunksBetween(v, RATE, 3 * RATE + 7, 3 * RATE + 100)
    expect(some.map((c) => c.index)).toEqual([1])
    expect(some[0]).toEqual(chunksBetween(v, RATE, 0, 10 * RATE)[1])
    expect(chunksBetween(v, RATE, 6 * RATE, 7 * RATE)).toEqual([])
  })

  it('has two clips that meet at a cut meet at the same sample', () => {
    const a = voice('a', 0, 0.5, 0)
    const b = voice('b', 0.5, 1, 0.7)
    const lastOfA = chunksBetween(a, RATE, 0, RATE).at(-1)!
    const firstOfB = chunksBetween(b, RATE, 0, RATE)[0]!
    expect(lastOfA.at + lastOfA.frames).toBe(firstOfB.at)
    expect(voiceSamples(a, RATE).to).toBe(voiceSamples(b, RATE).from)
  })

  it('keys a stretch by its sound and place, not by which clip asks', () => {
    const a = voice('a', 0, 1, 3)
    const b = voice('b', 5, 6, 3)
    const ca = chunksBetween(a, RATE, 0, RATE)[0]!
    const cb = chunksBetween(b, RATE, 0, 10 * RATE)[0]!
    expect(chunkKey(a, ca, RATE)).toBe(chunkKey(b, cb, RATE))
    expect(chunkKey(voice('a', 0, 1, 3, { track: 1 }), ca, RATE)).not.toBe(chunkKey(a, ca, RATE))
  })
})

describe('starting a stretch on the clock', () => {
  const c = chunksBetween(voice('a', 2, 4, 0), RATE, 0, 10 * RATE)[0]!

  it('starts it at its own sample of the clock', () => {
    // The sequence's second 1 heard at clock 10: second 2 at clock 11.
    expect(startOf(c, RATE, 10, RATE, 0)).toEqual({ when: 11, offset: 0 })
  })

  it('starts one already under way that far in, and none that has gone by', () => {
    expect(startOf(c, RATE, 10, RATE, 11.5)).toEqual({ when: 11.5, offset: 0.5 })
    expect(startOf(c, RATE, 10, RATE, 13.5)).toBeNull()
  })
})

describe('a voice that fades', () => {
  it('follows its fade times its own gain', () => {
    const v = voice('a', 0, 1, 0, { gain: 0.5, fadeAt: (sec) => sec })
    const curve = gainCurve(v, 0, 1, 10)
    expect(curve.length).toBe(11)
    expect(curve[0]).toBe(0)
    expect(curve[10]).toBeCloseTo(0.5, 6)
    expect(curve[5]).toBeCloseTo(0.25, 6)
  })

  it('is the same voice when only its loudness changes', () => {
    expect(voiceShape(voice('a', 0, 1, 0, { gain: 0.2 }))).toBe(voiceShape(voice('a', 0, 1, 0, { gain: 0.9 })))
    expect(voiceShape(voice('a', 0, 1, 0))).not.toBe(voiceShape(voice('a', 0, 1.1, 0)))
  })
})
