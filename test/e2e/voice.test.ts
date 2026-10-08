import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-voice-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { makeCleanCopy, makeVoiceCopy, voiceMeasureArgs } = await import('../../src/main/media/tracks')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { measureFfmpeg } = await import('../../src/main/ffmpeg/run')
const { parseLoudnorm } = await import('../../src/shared/render-plan')
const session = await import('../../src/main/project/session')

/**
 * Plan 56 through the real ffmpeg: a tone over hiss with its voice enhanced,
 * at each strength. It must come out as long as the track, in time with it,
 * and as loud, so turning it on changes the sound and not the balance.
 */

const fx = fixtureSet('voice-e2e')

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

const TONE = 'bandpass=f=1000:width_type=q:w=8,bandpass=f=1000:width_type=q:w=8'

async function levelDb(path: string, fromSec: number, forSec: number, filter: string): Promise<number> {
  const { stderr } = await capture(ffmpegPath, [
    '-hide_banner', '-ss', fromSec.toFixed(3), '-t', forSec.toFixed(3), '-i', path,
    '-af', `${filter},astats=metadata=0:reset=0`, '-f', 'null', '-'
  ])
  return Number(stderr.match(/Overall[\s\S]*?RMS level dB:\s*(-?[\d.]+)/)?.[1])
}

async function lengthSec(p: string): Promise<number> {
  const { stderr } = await capture(ffmpegPath, ['-hide_banner', '-i', p, '-f', 'null', '-'])
  return stderr.match(/time=(\d+):(\d+):([\d.]+)/g)!.pop()!.split(/[=:]/).slice(1).reduce((s, x) => s * 60 + Number(x), 0)
}

async function lufs(p: string): Promise<number> {
  return parseLoudnorm(await measureFfmpeg(voiceMeasureArgs(p, null)))!.i
}

describe('a track with its voice enhanced', () => {
  it('comes out as long as the track, in time with it, and as loud, at every strength', async () => {
    session.resetProject()
    const asset = await importFile(await fx.hissyWav(), ...quiet())
    expect(asset.status).toBe('ready')
    session.addAsset(asset)
    const m = session.getProject().media.find((x) => x.id === asset.id)!
    const before = await lufs(m.playablePath)
    const made = new Set<string>()
    for (const strength of ['light', 'normal', 'strong'] as const) {
      const path = await makeVoiceCopy(m, 0, strength, false)
      expect(path.startsWith(cacheRoot)).toBe(true)
      made.add(path)
      expect(Math.abs((await lengthSec(path)) - (await lengthSec(m.playablePath)))).toBeLessThan(0.05)
      expect(Math.abs((await lufs(path)) - before)).toBeLessThan(1)
      // The tone still starts at 2 s, to the hundredth: the limiter's look ahead is taken back out.
      const tone = await levelDb(path, 2.5, 1, TONE)
      expect(await levelDb(path, 1.9, 0.08, TONE)).toBeLessThan(tone - 12)
      expect(await levelDb(path, 2.02, 0.08, TONE)).toBeGreaterThan(tone - 3)
    }
    // One copy per strength, each made once.
    expect(made.size).toBe(3)
    expect(await makeVoiceCopy(m, 0, 'normal', false)).toBe([...made][1])
  })

  it('is made from the cleaned copy when Clean up noise is on too, with less hiss than without it', async () => {
    const m = session.getProject().media[0]!
    const cleaned = await makeCleanCopy(m, 0)
    const withCleaned = { ...m, cleaned: [{ track: 0, path: cleaned }] }
    const both = await makeVoiceCopy(withCleaned, 0, 'normal', true)
    const alone = await makeVoiceCopy(withCleaned, 0, 'normal', false)
    expect(both).not.toBe(alone)
    expect(both).toContain('clean')
    // Hiss alone, before the tone: the cleaned one is quieter there.
    expect(await levelDb(both, 0.8, 1, 'anull')).toBeLessThan((await levelDb(alone, 0.8, 1, 'anull')) - 3)
  })
})
