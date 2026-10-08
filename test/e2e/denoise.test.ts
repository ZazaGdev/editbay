import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-denoise-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { makeCleanCopy } = await import('../../src/main/media/tracks')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const session = await import('../../src/main/project/session')

/**
 * Plan 51 through the real ffmpeg: a tone over hiss, cleaned. The hiss is
 * measured where there is nothing else, and the tone by its pitch.
 */

const fx = fixtureSet('denoise-e2e')

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/** How loud a stretch of a file is, in dB, through a filter first. */
async function levelDb(path: string, fromSec: number, forSec: number, filter: string): Promise<number> {
  const { stderr } = await capture(ffmpegPath, [
    '-hide_banner', '-ss', fromSec.toFixed(3), '-t', forSec.toFixed(3), '-i', path,
    '-af', `${filter},astats=metadata=0:reset=0`, '-f', 'null', '-'
  ])
  return Number(stderr.match(/Overall[\s\S]*?RMS level dB:\s*(-?[\d.]+)/)?.[1])
}

const TONE = 'bandpass=f=1000:width_type=q:w=8,bandpass=f=1000:width_type=q:w=8'
const ALL = 'anull'

describe('a track cleaned of noise', () => {
  it('has its hiss taken down by several decibels, and its tone left within a decibel', async () => {
    session.resetProject()
    const asset = await importFile(await fx.hissyWav(), ...quiet())
    expect(asset.status).toBe('ready')
    session.addAsset(asset)
    const m = session.getProject().media.find((x) => x.id === asset.id)!
    const cleaned = await makeCleanCopy(m, 0)
    expect(cleaned.startsWith(cacheRoot)).toBe(true)

    // Hiss alone, well clear of the tone and of the filter's first moments.
    const hissBefore = await levelDb(m.playablePath, 0.8, 1, ALL)
    const hissAfter = await levelDb(cleaned, 0.8, 1, ALL)
    expect(hissBefore - hissAfter).toBeGreaterThan(6)
    // The tone, by its pitch, in the middle of it.
    const toneBefore = await levelDb(m.playablePath, 2.5, 1, TONE)
    const toneAfter = await levelDb(cleaned, 2.5, 1, TONE)
    expect(Math.abs(toneBefore - toneAfter)).toBeLessThan(1)

    // In time with the track it cleans: the tone still starts at 2 s, to the hundredth.
    expect(await levelDb(cleaned, 1.9, 0.08, TONE)).toBeLessThan(toneAfter - 20)
    expect(await levelDb(cleaned, 2.02, 0.08, TONE)).toBeGreaterThan(toneAfter - 3)
    const length = async (p: string): Promise<number> =>
      Number((await capture(ffmpegPath, ['-hide_banner', '-i', p, '-f', 'null', '-'])).stderr.match(/time=(\d+):(\d+):([\d.]+)/g)!.pop()!.split(/[=:]/).slice(1).reduce((s, x) => s * 60 + Number(x), 0))
    expect(Math.abs((await length(cleaned)) - (await length(m.playablePath)))).toBeLessThan(0.05)

    // Made once: asked again, the same file.
    expect(await makeCleanCopy(m, 0)).toBe(cleaned)
  })
})
