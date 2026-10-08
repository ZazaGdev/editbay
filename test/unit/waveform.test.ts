import { describe, it, expect } from 'vitest'
import { peaksFromPcm, encodePeaks, decodePeaks, PeakFolder, PEAKS_PER_SECOND } from '../../src/main/media/waveform'

function sine(samples: number, sampleRate: number, hz: number, amplitude: number): Int16Array {
  const out = new Int16Array(samples)
  for (let i = 0; i < samples; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * amplitude)
  }
  return out
}

describe('peaksFromPcm', () => {
  const rate = 8000

  it('produces one min and one max per bucket', () => {
    const peaks = peaksFromPcm(sine(rate * 2, rate, 440, 20000), rate)
    expect(peaks.length).toBe(2 * PEAKS_PER_SECOND * 2)
  })

  it('captures the amplitude of a loud passage', () => {
    const peaks = peaksFromPcm(sine(rate, rate, 440, 20000), rate)
    expect(peaks[1]).toBeGreaterThan(15000)
    expect(peaks[0]).toBeLessThan(-15000)
  })

  it('reports silence as zero', () => {
    const peaks = peaksFromPcm(new Int16Array(rate), rate)
    expect(Array.from(peaks.slice(0, 10))).toEqual(new Array(10).fill(0))
  })

  it('distinguishes a quiet passage from a loud one, which is the whole point', () => {
    const half = rate
    const pcm = new Int16Array(half * 2)
    pcm.set(sine(half, rate, 440, 2000), 0)
    pcm.set(sine(half, rate, 440, 25000), half)
    const peaks = peaksFromPcm(pcm, rate)
    const firstMax = peaks[1] ?? 0
    const lastMax = peaks[peaks.length - 1] ?? 0
    expect(lastMax).toBeGreaterThan(firstMax * 5)
  })

  it('handles a final partial bucket without crashing', () => {
    const peaks = peaksFromPcm(sine(rate + 13, rate, 440, 20000), rate)
    expect(peaks.length).toBeGreaterThan(PEAKS_PER_SECOND * 2)
  })

  it('returns nothing for no samples', () => {
    expect(peaksFromPcm(new Int16Array(0), rate).length).toBe(0)
  })
})

describe('PeakFolder', () => {
  const rate = 8000

  /** The samples as ffmpeg writes them: 16-bit little endian. */
  function bytes(pcm: Int16Array): Buffer {
    const out = Buffer.alloc(pcm.length * 2)
    for (let i = 0; i < pcm.length; i++) out.writeInt16LE(pcm[i] ?? 0, i * 2)
    return out
  }

  it('gives the same peaks as the whole recording at once, whatever the chunks', () => {
    const pcm = new Int16Array(rate * 3 + 37)
    pcm.set(sine(rate, rate, 440, 3000), 0)
    pcm.set(sine(rate * 2 + 37, rate, 220, 26000), rate)
    const whole = bytes(pcm)
    // Odd sizes split samples in half and buckets part way, which is what a pipe does.
    for (const size of [1, 3, 79, 4097, whole.length]) {
      const folder = new PeakFolder(rate, 1)
      for (let at = 0; at < whole.length; at += size) folder.push(whole.subarray(at, at + size))
      expect(Array.from(folder.finish())).toEqual(Array.from(peaksFromPcm(pcm, rate)))
    }
  })

  it('keeps only the peaks, however long the recording', () => {
    // Two hours at the decode rate, in one second chunks: the old way held all
    // of it, 115 MB, and was stopped at 64 MB.
    const second = bytes(sine(rate, rate, 440, 20000))
    const folder = new PeakFolder(rate, 2 * 3600)
    for (let s = 0; s < 2 * 3600; s++) folder.push(second)
    expect(folder.finish().length).toBe(2 * 3600 * PEAKS_PER_SECOND * 2)
  })

  it('gives every peak whatever length it was told to expect', () => {
    const second = bytes(sine(rate, rate, 440, 20000))
    for (const told of [NaN, -1, 0, Infinity, 1e12]) {
      const folder = new PeakFolder(rate, told)
      for (let s = 0; s < 3; s++) folder.push(second)
      const peaks = folder.finish()
      expect(peaks.length).toBe(3 * PEAKS_PER_SECOND * 2)
      expect(peaks[peaks.length - 1]).toBeGreaterThan(15000)
    }
  })

  it('gives nothing for no sound', () => {
    expect(new PeakFolder(rate, 5).finish().length).toBe(0)
  })
})

describe('encodePeaks and decodePeaks', () => {
  it('round trip', () => {
    const peaks = peaksFromPcm(sine(8000, 8000, 440, 20000), 8000)
    const decoded = decodePeaks(encodePeaks(peaks, 1.0))
    expect(decoded.durationSec).toBeCloseTo(1.0)
    expect(Array.from(decoded.peaks)).toEqual(Array.from(peaks))
  })

  it('rejects a file that is not a peaks file', () => {
    expect(() => decodePeaks(Buffer.from('not a peaks file'))).toThrow(/peaks/i)
  })
})
