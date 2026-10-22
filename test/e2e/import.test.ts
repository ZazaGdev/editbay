import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, stat, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from './fixtures'
import { probeFile, conformReasons } from '../../src/main/media/probe'
import { detectVfr, deltasIndicateVfr } from '../../src/main/media/vfr'
import { conformFile, targetFrameRate } from '../../src/main/media/conform'
import { extractPeaks, decodePeaks } from '../../src/main/media/waveform'
import { extractFilmstrip, filmstripArgs, filmstripLayout } from '../../src/main/media/thumbnails'
import { runFfmpeg } from '../../src/main/ffmpeg/run'
import { verifyFfmpeg, ffmpegPath } from '../../src/main/ffmpeg/locate'
import { capture } from '../../src/main/ffmpeg/spawn'

const fx = fixtureSet('media')
let work: string

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'editbay-media-'))
})

afterAll(async () => {
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

describe('the bundled ffmpeg', () => {
  it('has everything the app needs', async () => {
    const caps = await verifyFfmpeg()
    expect(caps.encoders.has('libx264')).toBe(true)
    expect(caps.encoders.has('aac')).toBe(true)
    expect(caps.version).toMatch(/ffmpeg version/i)
  })
})

describe('a clean file', () => {
  it('is used untouched', async () => {
    const path = await fx.cleanClip()
    const probe = await probeFile(path)
    expect(probe.video.codec).toBe('h264')
    expect(probe.audio?.channels).toBe(2)

    const isVfr = await detectVfr(path, probe.video.nominalFps, probe.video.averageFps)
    expect(isVfr).toBe(false)
    expect(conformReasons(probe, isVfr)).toEqual([])
  })

  it('produces peaks that show the sine tone', async () => {
    const path = await fx.cleanClip()
    const probe = await probeFile(path)
    const out = join(work, 'clean-peaks.bin')
    await extractPeaks(path, out, probe.durationSec, true)
    const { peaks, durationSec } = decodePeaks(await readFile(out))
    expect(durationSec).toBeCloseTo(probe.durationSec, 1)
    expect(peaks.length).toBeGreaterThan(0)
    expect(Math.max(...Array.from(peaks))).toBeGreaterThan(1000)
  })

  it('produces a filmstrip', async () => {
    const path = await fx.cleanClip()
    const probe = await probeFile(path)
    const out = join(work, 'clean-strip.jpg')
    await extractFilmstrip(path, out, probe.durationSec)
    expect((await stat(out)).size).toBeGreaterThan(1000)
  })
})

describe('a filmstrip made from keyframes only', () => {
  /** A picture made by ffmpeg, as grey pixels. */
  async function pixels(path: string): Promise<Buffer> {
    return (await capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])).stdout
  }

  /** A filmstrip of `path`, decoding every frame or only the keyframes. */
  async function strip(path: string, name: string, keyframesOnly: boolean): Promise<Buffer> {
    const probe = await probeFile(path)
    const out = join(work, name)
    await runFfmpeg(filmstripArgs(path, out, filmstripLayout(probe.durationSec), keyframesOnly))
    return pixels(out)
  }

  function meanDifference(a: Buffer, b: Buffer): number {
    expect(a.length).toBe(b.length)
    let sum = 0
    for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0))
    return sum / a.length
  }

  it('shows the keyframe before each tile, the last tile too', async () => {
    // Four seconds give four tiles a second apart, and the clip has a keyframe
    // every second, as a conformed copy has. Every frame decoded, each tile is
    // the frame just before the half second; from keyframes, it is the one on
    // the second before that, so the strip should be exactly those four frames.
    // Without its last keyframe passed on, the fourth tile would be black.
    const path = await fx.keyedClip()
    const keys = await strip(path, 'keyed-keys.jpg', true)
    const expected = join(work, 'keyed-expected.jpg')
    await runFfmpeg(['-i', path, '-vf', "select='not(mod(n,30))',scale=160:-2,tile=2x2", '-frames:v', '1', '-q:v', '4', '-y', expected])
    expect(meanDifference(keys, await pixels(expected))).toBeLessThan(1)
  })

  it('would repeat one picture where keyframes are further apart than the tiles', async () => {
    // The clean clip has a single keyframe, so every tile would be its first
    // frame. This is why tiles close together still decode every frame.
    const path = await fx.cleanClip()
    const every = await strip(path, 'clean-every.jpg', false)
    const keys = await strip(path, 'clean-keys.jpg', true)
    expect(meanDifference(every, keys)).toBeGreaterThan(5)
  })
})

describe('a variable frame rate file', () => {
  it('is invisible to the frame rates ffprobe reports', async () => {
    const path = await fx.vfrClip()
    const probe = await probeFile(path)
    // Both rates read as a clean 30/1 on a file whose frames are plainly
    // irregular. This is why the packet timestamps have the final say.
    expect(probe.video.nominalFps).toBe(30)
    expect(probe.video.averageFps).toBe(30)
  })

  it('is caught by the packet timestamps', async () => {
    const path = await fx.vfrClip()
    const probe = await probeFile(path)
    expect(await detectVfr(path, probe.video.nominalFps, probe.video.averageFps)).toBe(true)
    expect(conformReasons(probe, true)).toContain('variable-frame-rate')
  })

  it('conforms to constant timing that the app can trust', async () => {
    const path = await fx.vfrClip()
    const probe = await probeFile(path)
    const out = join(work, 'vfr-conformed.mp4')
    const caps = await verifyFfmpeg()

    await conformFile({ probe, output: out, hasZscale: caps.hasZscale })

    const after = await probeFile(out)
    expect(after.video.codec).toBe('h264')
    expect(after.video.width).toBe(probe.video.width)
    expect(after.video.height).toBe(probe.video.height)
    expect(await detectVfr(out, after.video.nominalFps, after.video.averageFps)).toBe(false)
    expect(after.video.nominalFps).toBeCloseTo(targetFrameRate(probe), 1)
  })
})

describe('a long recording', () => {
  it('gets its whole waveform, past the 70 minutes the decoded sound once stopped at', async () => {
    // 75 minutes of tone, small enough to make quickly: mono, low rate, low bitrate.
    const path = join(work, 'long.m4a')
    const minutes = 75
    await capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=8000:duration=${minutes * 60}`,
      '-c:a', 'aac', '-b:a', '16k', '-y', path])
    const out = join(work, 'long-peaks.bin')
    await extractPeaks(path, out, minutes * 60, true)
    const { peaks } = decodePeaks(await readFile(out))
    expect(peaks.length / 2).toBeGreaterThanOrEqual(minutes * 60 * 100 - 100)
    // Sound in the last full second, not a waveform cut short.
    expect(Math.max(...Array.from(peaks.slice(-400, -200)))).toBeGreaterThan(1000)
    // Longer for the Intel Mac build, whose ffmpeg runs through Rosetta on GitHub's Macs (task 1388).
  }, 300_000)
})

describe('a file with no audio', () => {
  it('imports and gets an empty peaks file rather than failing', async () => {
    const path = await fx.silentClip()
    const probe = await probeFile(path)
    expect(probe.audio).toBeNull()

    const out = join(work, 'silent-peaks.bin')
    await extractPeaks(path, out, probe.durationSec, false)
    const { peaks, durationSec } = decodePeaks(await readFile(out))
    expect(peaks.length).toBe(0)
    expect(durationSec).toBeCloseTo(probe.durationSec, 1)
  })

  it('conforms without an audio track rather than erroring on the missing map', async () => {
    const path = await fx.silentClip()
    const probe = await probeFile(path)
    const out = join(work, 'silent-conformed.mp4')
    const caps = await verifyFfmpeg()
    await conformFile({ probe, output: out, hasZscale: caps.hasZscale })
    const after = await probeFile(out)
    expect(after.video.codec).toBe('h264')
    expect(after.audio).toBeNull()
  })
})

describe('detectVfr on a clip too short to judge', () => {
  it('falls back to the reported rates rather than guessing', async () => {
    // Fewer samples than the detector needs, so the rates are all it has.
    expect(deltasIndicateVfr([0, 0.033, 0.066])).toBe(false)
    const path = await fx.oversizedClip()
    const probe = await probeFile(path)
    // 10 frames, under the sample floor, and the rates agree, so: not variable.
    expect(await detectVfr(path, probe.video.nominalFps, probe.video.averageFps)).toBe(false)
  })
})

describe('a probe for an import that was cancelled', () => {
  // A cancel must reach ffprobe too: a probe hung on a damaged file or a share
  // that stopped answering would otherwise hold up every import behind it.
  it('stops reading the file', async () => {
    const path = await fx.cleanClip()
    await expect(probeFile(path, AbortSignal.abort())).rejects.toThrow('cancelled')
  })

  it('stops reading its timestamps', async () => {
    const path = await fx.vfrClip()
    await expect(detectVfr(path, 30, 30, AbortSignal.abort())).rejects.toThrow('cancelled')
  })
})

describe('chapters in a recording', () => {
  /** A copy of the clean clip with two chapters written into it, as OBS writes them. */
  async function withChapters(): Promise<string> {
    const source = await fx.cleanClip()
    const meta = join(work, 'chapters.txt')
    await writeFile(
      meta,
      [
        ';FFMETADATA1',
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        'START=1000',
        'END=2500',
        'title=the good bit',
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        'START=2500',
        'END=4000',
        'title=frag out'
      ].join('\n')
    )
    const out = join(work, 'chaptered.mp4')
    await capture(ffmpegPath, ['-y', '-i', source, '-i', meta, '-map_metadata', '1', '-codec', 'copy', out])
    return out
  }

  it('is read off the file, at its time and with its title', async () => {
    const probe = await probeFile(await withChapters())
    expect(probe.chapters.map((c) => c.title)).toEqual(['the good bit', 'frag out'])
    // ffmpeg pulls the first chapter back to the start of the file when it
    // writes them, so only the second says what it was asked for. That is
    // ffmpeg's doing on the way in, not the reading's on the way out.
    expect(probe.chapters[1]!.atSec).toBeCloseTo(2.5, 3)
    expect(probe.chapters[0]!.atSec).toBeLessThan(probe.chapters[1]!.atSec)
  })

  it('is none for a recording without any, which is not a fault', async () => {
    expect((await probeFile(await fx.cleanClip())).chapters).toEqual([])
  })
})
