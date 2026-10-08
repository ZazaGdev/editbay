import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'

/** A take is mono 16-bit PCM: two bytes a sample. */
export const BYTES_PER_SAMPLE = 2

/** How long a WAV's header is: where its samples start. */
export const WAV_HEADER_BYTES = 44

/** The most samples a WAV's header can say it holds, for a file still being written. */
export const OPEN_ENDED = 0xffffffff - 36

/** The 44 bytes that start a PCM WAV file holding `dataBytes` of 16-bit samples. */
export function wavHeader(sampleRate: number, channels: number, dataBytes: number): Buffer {
  const blockAlign = channels * BYTES_PER_SAMPLE
  const h = Buffer.alloc(WAV_HEADER_BYTES)
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(Math.min(0xffffffff, 36 + dataBytes), 4)
  h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii')
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(channels, 22)
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * blockAlign, 28)
  h.writeUInt16LE(blockAlign, 32)
  h.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34)
  h.write('data', 36, 'ascii')
  h.writeUInt32LE(Math.min(0xffffffff, dataBytes), 40)
  return h
}

/**
 * Make a mono WAV at `target` from the 16-bit samples in `from`, which start
 * `skip` bytes in: the first `drop` samples left out and `pad` samples of
 * silence put first. Streamed, so a long take never sits in memory, and
 * written beside the target first so that a half-written file never has
 * its name.
 */
export async function writeWav(
  target: string,
  from: string,
  opts: { sampleRate: number; samples: number; skip?: number; drop: number; pad: number }
): Promise<void> {
  const skip = opts.skip ?? 0
  const drop = Math.min(Math.max(0, Math.round(opts.drop)), opts.samples)
  const pad = Math.max(0, Math.round(opts.pad))
  const kept = opts.samples - drop
  const part = `${target}.part`
  async function* take(): AsyncGenerator<Buffer> {
    yield wavHeader(opts.sampleRate, 1, (pad + kept) * BYTES_PER_SAMPLE)
    const silence = Buffer.alloc(64 * 1024)
    for (let left = pad * BYTES_PER_SAMPLE; left > 0; left -= silence.length) {
      yield left >= silence.length ? silence : silence.subarray(0, left)
    }
    if (kept > 0) {
      const start = skip + drop * BYTES_PER_SAMPLE
      for await (const chunk of createReadStream(from, { start, end: skip + opts.samples * BYTES_PER_SAMPLE - 1 })) {
        yield chunk as Buffer
      }
    }
  }
  try {
    // Both ends watched for errors, and the file closed, before it is renamed.
    await pipeline(take, createWriteStream(part))
    await rename(part, target)
  } catch (err) {
    await rm(part, { force: true })
    throw err
  }
}
