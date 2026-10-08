import { streamFfmpeg } from '../ffmpeg/run'
import { writeAtomic } from './cache'

/** Buckets per second of audio. 100 is finer than any timeline zoom needs. */
export const PEAKS_PER_SECOND = 100

/** The sample rate the audio is decoded at. Low, because only the envelope matters. */
const DECODE_RATE = 8000

const MAGIC = 0x50454b31 // "PEK1"

/**
 * Reduce mono 16-bit PCM to alternating min and max per bucket.
 * Output is [min0, max0, min1, max1, ...].
 */
export function peaksFromPcm(pcm: Int16Array, sampleRate: number): Int16Array {
  const folder = new PeakFolder(sampleRate, pcm.length / sampleRate)
  for (let i = 0; i < pcm.length; i++) folder.sample(pcm[i] ?? 0)
  return folder.finish()
}

/**
 * The same reduction, fed ffmpeg's output a chunk at a time as it arrives.
 *
 * Holding the decoded sound whole stopped at 64 MB, which at the decode rate is
 * a recording of about 70 minutes, and a long OBS stream is longer than that.
 * This keeps only the peaks, a few hundred bytes a second. A chunk can end
 * half way through a sample and part way through a bucket, so both carry over.
 */
export class PeakFolder {
  private readonly perBucket: number
  private out: Int16Array
  private buckets = 0
  private filled = 0
  private min = 0
  private max = 0
  /** The first byte of a sample the last chunk cut in half. */
  private odd: number | null = null

  constructor(sampleRate: number, expectedSec: number) {
    this.perBucket = Math.max(1, Math.round(sampleRate / PEAKS_PER_SECOND))
    // Sized for the length the probe gave, and grown should the sound run
    // longer. A length that is no length, or a damaged header's absurd one,
    // starts it small rather than empty or gigabytes long.
    const sec = Number.isFinite(expectedSec) && expectedSec > 0 ? Math.min(expectedSec, 6 * 3600) : 0
    this.out = new Int16Array(Math.max(2, Math.ceil(sec * PEAKS_PER_SECOND + 1) * 2))
  }

  push(chunk: Buffer): void {
    let at = 0
    if (this.odd !== null && chunk.length > 0) {
      this.sample(Buffer.from([this.odd, chunk[0] ?? 0]).readInt16LE(0))
      this.odd = null
      at = 1
    }
    for (; at + 1 < chunk.length; at += 2) this.sample(chunk.readInt16LE(at))
    if (at < chunk.length) this.odd = chunk[at] ?? 0
  }

  sample(s: number): void {
    if (s < this.min) this.min = s
    if (s > this.max) this.max = s
    if (++this.filled === this.perBucket) this.close()
  }

  finish(): Int16Array {
    if (this.filled > 0) this.close()
    return this.out.slice(0, this.buckets * 2)
  }

  private close(): void {
    if (this.buckets * 2 + 2 > this.out.length) {
      const grown = new Int16Array(this.out.length * 2)
      grown.set(this.out)
      this.out = grown
    }
    this.out[this.buckets * 2] = this.min
    this.out[this.buckets * 2 + 1] = this.max
    this.buckets++
    this.filled = 0
    this.min = 0
    this.max = 0
  }
}

export function encodePeaks(peaks: Int16Array, durationSec: number): Buffer {
  const header = Buffer.alloc(16)
  header.writeUInt32BE(MAGIC, 0)
  header.writeUInt32BE(PEAKS_PER_SECOND, 4)
  header.writeFloatBE(durationSec, 8)
  header.writeUInt32BE(peaks.length, 12)
  const body = Buffer.alloc(peaks.length * 2)
  for (let i = 0; i < peaks.length; i++) body.writeInt16LE(peaks[i] ?? 0, i * 2)
  return Buffer.concat([header, body])
}

export function decodePeaks(buf: Buffer): { peaksPerSecond: number; durationSec: number; peaks: Int16Array } {
  if (buf.length < 16 || buf.readUInt32BE(0) !== MAGIC) {
    throw new Error('not a peaks file')
  }
  const peaksPerSecond = buf.readUInt32BE(4)
  const durationSec = buf.readFloatBE(8)
  const length = buf.readUInt32BE(12)
  const peaks = new Int16Array(length)
  for (let i = 0; i < length; i++) peaks[i] = buf.readInt16LE(16 + i * 2)
  return { peaksPerSecond, durationSec, peaks }
}

/**
 * Decode one of a file's audio streams, its first unless `from.track` names
 * another, and write its peaks to the cache, through `from.filter` when given.
 * Writes an empty peaks file when the source has no audio, so every asset has one.
 */
export async function extractPeaks(
  input: string,
  output: string,
  durationSec: number,
  hasAudio: boolean,
  signal?: AbortSignal,
  from: { track?: number; filter?: string } = {}
): Promise<void> {
  if (!hasAudio) {
    await writeAtomic(output, encodePeaks(new Int16Array(0), durationSec))
    return
  }

  const folder = new PeakFolder(DECODE_RATE, durationSec)
  await streamFfmpeg([
    '-i',
    input,
    '-map',
    `0:a:${from.track ?? 0}`,
    ...(from.filter ? ['-af', from.filter] : []),
    '-ac',
    '1',
    '-ar',
    String(DECODE_RATE),
    '-f',
    's16le',
    'pipe:1'
  ], (chunk) => folder.push(chunk), signal)
  await writeAtomic(output, encodePeaks(folder.finish(), durationSec))
}
