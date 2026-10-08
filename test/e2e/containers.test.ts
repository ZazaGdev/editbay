import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-containers-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { importFile } = await import('../../src/main/media/import')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { probeFile } = await import('../../src/main/media/probe')

/**
 * Audit 2026-10-01: OBS can record to MPEG-TS or FLV, which the window's
 * player cannot open: such a file imported as ready and showed black. It is
 * now put into an MP4 as it is, its picture copied rather than encoded again.
 */

const work = await mkdtemp(join(tmpdir(), 'editbay-containers-'))
afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

async function recording(ext: string): Promise<string> {
  const file = join(work, `obs.${ext}`)
  await capture(ffmpegPath, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', file
  ])
  return file
}

describe('a recording in a kind of file the player cannot open', () => {
  for (const ext of ['ts', 'flv']) {
    it(`is put into an MP4 as it is, for .${ext}`, async () => {
      const source = await recording(ext)
      const asset = await importFile(source, ...quiet())
      expect(asset.status).toBe('ready')
      expect(asset.conformReasons).toEqual(['container'])
      expect(asset.playablePath.endsWith('.mp4')).toBe(true)
      const played = await probeFile(asset.playablePath)
      expect(played.container?.split(',')).toContain('mp4')
      expect(played.video.codec).toBe('h264')
      // Every frame there, and not encoded again: the same size of picture data, near enough.
      expect(Math.abs(played.durationSec - 2)).toBeLessThan(0.1)
      expect(played.audio?.codec).toBe('aac')
    })
  }

  it('leaves an MKV, which the player opens, as it is', async () => {
    const asset = await importFile(await recording('mkv'), ...quiet())
    expect(asset.conformed).toBe(false)
  })
})

describe('a recording whose pixels are not square (audit 2026-10-01)', () => {
  it('is converted to square pixels, as wide as it shows', async () => {
    const file = join(work, 'dv.mp4')
    await capture(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=720x480:r=30:d=1', '-vf', 'setsar=32/27', '-c:v', 'libx264', '-preset', 'ultrafast', file])
    const asset = await importFile(file, ...quiet())
    expect(asset.conformReasons).toEqual(['non-square-pixels'])
    expect([asset.width, asset.height]).toEqual([854, 480])
  })
})

describe('a playlist named like a video (audit 2026-10-01)', () => {
  it('is refused, never followed to where it points', async () => {
    const file = join(work, 'not-a-video.mp4')
    const { writeFile } = await import('node:fs/promises')
    // It names a file on another computer: read as a playlist, ffprobe would open it.
    await writeFile(file, ['#EXTM3U', '#EXT-X-TARGETDURATION:1', '#EXTINF:1,', '//127.0.0.1/share/x.ts', '#EXT-X-ENDLIST', ''].join(String.fromCharCode(10)))
    const asset = await importFile(file, ...quiet())
    expect(asset.status).toBe('failed')
  })
})
