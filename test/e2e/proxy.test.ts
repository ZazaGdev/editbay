import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-proxy-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { makeProxy } = await import('../../src/main/media/proxy')
const { capture, captureText } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath, ffprobePath } = await import('../../src/main/ffmpeg/locate')
const session = await import('../../src/main/project/session')

/**
 * Plan 67 through the real ffmpeg: a recording's lighter copy is smaller,
 * starts its picture and its sound exactly where the recording does, and is
 * made once.
 */

const fx = fixtureSet('proxy-e2e')

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/** Each stream's kind, size and start time, as ffprobe gives them. */
async function streams(path: string): Promise<{ kind: string; width?: number; height?: number; start: number }[]> {
  const out = await captureText(ffprobePath, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,start_time', '-of', 'json', path])
  const json = JSON.parse(out) as { streams: { codec_type: string; width?: number; height?: number; start_time: string }[] }
  return json.streams.map((s) => ({ kind: s.codec_type, ...(s.width ? { width: s.width, height: s.height } : {}), start: Number(s.start_time) }))
}

/**
 * A recording shaped like OBS's, in Matroska or MP4: AAC sound, a 1080p picture, and
 * silence but for a beep starting at exactly 1.000 s.
 */
async function beepingRecording(ext: 'mkv' | 'mp4'): Promise<string> {
  const path = join(fx.dir, `beeping.${ext}`)
  await capture(ffmpegPath, [
    '-hide_banner', '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=gray:s=1920x1080:r=30:d=3',
    '-f', 'lavfi', '-i', "aevalsrc='if(between(t,1,1.2),0.5*sin(2*PI*1000*t),0)':s=48000:d=3",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', path
  ])
  return path
}

/** When the first sound after silence starts, in the file's own time, as a player hears it. */
async function soundStarts(path: string): Promise<number> {
  const { stderr } = await capture(ffmpegPath, ['-hide_banner', '-i', path, '-map', '0:a:0', '-af', 'silencedetect=n=-40dB:d=0.5', '-f', 'null', '-'])
  return Number(/silence_end: (-?[\d.]+)/.exec(stderr)?.[1])
}

describe("a recording's lighter copy", () => {
  it('is 540 high, starts picture and sound where the recording does, and is made once', async () => {
    session.resetProject()
    const asset = await importFile(await fx.obsClip(30), ...quiet())
    expect(asset.status).toBe('ready')
    session.addAsset(asset)
    const m = session.getProject().media.find((x) => x.id === asset.id)!
    const copy = await makeProxy(m)
    expect(copy).not.toBeNull()
    expect(copy!.startsWith(cacheRoot)).toBe(true)

    const [own, light] = [await streams(m.playablePath), await streams(copy!)]
    const video = light.find((s) => s.kind === 'video')!
    expect(video.height).toBe(540)
    expect(video.width).toBe(Math.round((540 * m.width) / m.height / 2) * 2)
    // The picture starts where the recording's does. The sound's start time is written differently
    // in Matroska and MP4, so it is checked by when a sound is heard, in the test below.
    expect(video.start).toBeCloseTo(own.find((s) => s.kind === 'video')!.start, 3)
    expect((await stat(copy!)).size).toBeLessThan((await stat(m.playablePath)).size)

    // Asked again, the same file, not made again.
    const made = (await stat(copy!)).mtimeMs
    expect(await makeProxy(m)).toBe(copy)
    expect((await stat(copy!)).mtimeMs).toBe(made)
  })

  it.each(['mkv', 'mp4'] as const)('plays its sound at the same moment as the recording does, to the millisecond, from %s', async (ext) => {
    session.resetProject()
    const asset = await importFile(await beepingRecording(ext), ...quiet())
    expect(asset.status).toBe('ready')
    session.addAsset(asset)
    const m = session.getProject().media.find((x) => x.id === asset.id)!
    const copy = (await makeProxy(m))!
    const own = await soundStarts(m.playablePath)
    expect(own).toBeCloseTo(1, 1)
    expect(Math.abs((await soundStarts(copy)) - own)).toBeLessThan(0.002)
  })

  it('is not made for a recording no bigger than it would be', async () => {
    session.resetProject()
    const asset = await importFile(await fx.cleanClip(), ...quiet())
    session.addAsset(asset)
    const m = session.getProject().media.find((x) => x.id === asset.id)!
    expect(await makeProxy(m)).toBeNull()
  })
})
