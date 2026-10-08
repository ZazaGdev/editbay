import { describe, it, expect, afterAll } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wavHeader, writeWav } from '../../src/main/voiceover/wav'
import { appendTake, beginTake, cancelTake, finishTake, recordingPath } from '../../src/main/voiceover/takes'
import { runFfprobe } from '../../src/main/ffmpeg/run'

const root = await mkdtemp(join(tmpdir(), 'editbay-wav-'))

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 16-bit samples as the bytes a take is made of. */
function pcm(...samples: number[]): Buffer {
  const b = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => b.writeInt16LE(s, i * 2))
  return b
}

/** The samples of a WAV this module wrote, after its 44-byte header. */
async function samplesOf(path: string): Promise<number[]> {
  const b = await readFile(path)
  const out: number[] = []
  for (let i = 44; i + 1 < b.length; i += 2) out.push(b.readInt16LE(i))
  return out
}

describe('a take\'s WAV header', () => {
  it('describes mono 16-bit PCM at the rate given, byte for byte', () => {
    const h = wavHeader(48000, 1, 96000)
    expect(h.length).toBe(44)
    expect(h.toString('ascii', 0, 4)).toBe('RIFF')
    expect(h.readUInt32LE(4)).toBe(36 + 96000)
    expect(h.toString('ascii', 8, 16)).toBe('WAVEfmt ')
    expect(h.readUInt32LE(16)).toBe(16)
    expect(h.readUInt16LE(20)).toBe(1)
    expect(h.readUInt16LE(22)).toBe(1)
    expect(h.readUInt32LE(24)).toBe(48000)
    expect(h.readUInt32LE(28)).toBe(96000)
    expect(h.readUInt16LE(32)).toBe(2)
    expect(h.readUInt16LE(34)).toBe(16)
    expect(h.toString('ascii', 36, 40)).toBe('data')
    expect(h.readUInt32LE(40)).toBe(96000)
  })
})

describe('making a take\'s WAV from its raw samples', () => {
  it('leaves off the samples before the frame where recording began', async () => {
    const raw = join(root, 'drop.raw')
    await writeFile(raw, pcm(1, 2, 3, 4, 5))
    const wav = join(root, 'drop.wav')
    await writeWav(wav, raw, { sampleRate: 48000, samples: 5, drop: 2, pad: 0 })
    expect(await samplesOf(wav)).toEqual([3, 4, 5])
    expect((await readFile(wav)).readUInt32LE(40)).toBe(6)
  })

  it('reads the samples after a header when told where they start', async () => {
    const raw = join(root, 'headed.wav')
    await writeFile(raw, Buffer.concat([Buffer.alloc(44, 7), pcm(1, 2, 3)]))
    const wav = join(root, 'headed-out.wav')
    await writeWav(wav, raw, { sampleRate: 48000, samples: 3, skip: 44, drop: 1, pad: 0 })
    expect(await samplesOf(wav)).toEqual([2, 3])
  })

  it('puts silence first when the take began after that frame', async () => {
    const raw = join(root, 'pad.raw')
    await writeFile(raw, pcm(7, 8))
    const wav = join(root, 'pad.wav')
    await writeWav(wav, raw, { sampleRate: 48000, samples: 2, drop: 0, pad: 3 })
    expect(await samplesOf(wav)).toEqual([0, 0, 0, 7, 8])
  })

  it('writes a file ffprobe reads as the right rate and length, and nothing half written under its name', async () => {
    const raw = join(root, 'second.raw')
    const second = Buffer.alloc(48000 * 2)
    for (let i = 0; i < 48000; i++) second.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 48000)), i * 2)
    await writeFile(raw, second)
    const wav = join(root, 'second.wav')
    await writeWav(wav, raw, { sampleRate: 48000, samples: 48000, drop: 4800, pad: 0 })
    const out = await runFfprobe([
      '-v', 'error', '-show_entries', 'stream=sample_rate,channels,codec_name:format=duration', '-of', 'json', wav
    ])
    const info = JSON.parse(out) as { streams: { sample_rate: string; channels: number; codec_name: string }[]; format: { duration: string } }
    expect(info.streams[0]).toMatchObject({ sample_rate: '48000', channels: 1, codec_name: 'pcm_s16le' })
    expect(Number(info.format.duration)).toBeCloseTo(0.9, 3)
    expect((await readdir(root)).some((f) => f.endsWith('.part'))).toBe(false)
  })
})

describe('recording a take', () => {
  it('saves its samples as they come and makes the WAV when it stops, leaving no raw file', async () => {
    const folder = join(root, 'project', 'Voice overs')
    const path = await beginTake(folder, 'Voice over 2026-09-22 14-03-05.wav', 48000)
    expect(path).toBe(join(folder, 'Voice over 2026-09-22 14-03-05.wav'))
    await appendTake(pcm(1, 2, 3))
    // A chunk cut through a sample keeps only whole samples.
    await appendTake(new Uint8Array([...pcm(4), 9]))
    expect(await finishTake({ drop: 1, pad: 0 })).toBe(path)
    expect(await samplesOf(path)).toEqual([2, 3, 4])
    expect(await readdir(folder)).toEqual(['Voice over 2026-09-22 14-03-05.wav'])
  })

  it('names a second take of the same second apart from the first', async () => {
    const folder = join(root, 'project', 'Voice overs')
    const path = await beginTake(folder, 'Voice over 2026-09-22 14-03-05.wav', 48000)
    expect(path).toBe(join(folder, 'Voice over 2026-09-22 14-03-05 (2).wav'))
    await appendTake(pcm(5))
    await finishTake({ drop: 0, pad: 0 })
  })

  it('throws a take away with no file left, and does nothing when none is recording', async () => {
    const folder = join(root, 'cancelled')
    await beginTake(folder, 'Voice over.wav', 48000)
    await appendTake(pcm(1, 2))
    await cancelTake()
    expect(await readdir(folder)).toEqual([])
    expect(await finishTake({ drop: 0, pad: 0 })).toBeNull()
    await appendTake(pcm(1))
    await cancelTake()
  })
})

describe('a take that goes wrong', () => {
  it('is a WAV that plays while it records, so a crash leaves something to open', async () => {
    const folder = join(root, 'crash')
    const path = await beginTake(folder, 'Voice over.wav', 48000)
    await appendTake(pcm(1, 2, 3))
    const recording = await readFile(recordingPath(path))
    expect(recording.toString('ascii', 0, 4) + recording.toString('ascii', 8, 12)).toBe('RIFFWAVE')
    expect(recording.readUInt32LE(24)).toBe(48000)
    await cancelTake()
    expect(await readdir(folder)).toEqual([])
  })

  it('gives nothing, and leaves no file, when it stops before the frame where recording began', async () => {
    const folder = join(root, 'short')
    await beginTake(folder, 'Voice over.wav', 48000)
    await appendTake(pcm(1, 2, 3))
    expect(await finishTake({ drop: 5, pad: 0 })).toBeNull()
    expect(await readdir(folder)).toEqual([])
  })

  it('keeps what was recorded, and says where, when its WAV cannot be made', async () => {
    const folder = join(root, 'unwritable')
    const path = await beginTake(folder, 'Voice over.wav', 48000)
    await appendTake(pcm(1, 2, 3))
    // Something already has the WAV's name, and cannot be replaced.
    await mkdir(path)
    await expect(finishTake({ drop: 0, pad: 0 })).rejects.toThrow('What was recorded is kept as Voice over (recording).wav')
    expect((await readdir(folder)).sort()).toEqual(['Voice over (recording).wav', 'Voice over.wav'])
    expect(await readdir(folder)).not.toContain('Voice over.wav.part')
  })
})
