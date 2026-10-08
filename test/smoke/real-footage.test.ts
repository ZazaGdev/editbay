import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The import pipeline against real footage.
 *
 * Automated tests use synthetic fixtures, which cannot reproduce what a phone
 * or a screen recorder actually writes. This suite runs the same pipeline over
 * files you point it at, and is the automated half of docs/smoke-checklist.md.
 *
 * Point it at files with either:
 *   - a file at test/smoke/media.local.txt, one path per line, or
 *   - the EDITBAY_SMOKE_MEDIA environment variable, paths separated by ";"
 *
 * Both are gitignored and machine specific. With neither, the suite skips.
 */

const LIST_FILE = join(process.cwd(), 'test', 'smoke', 'media.local.txt')

function mediaPaths(): string[] {
  const fromEnv = process.env.EDITBAY_SMOKE_MEDIA ?? ''
  const fromFile = existsSync(LIST_FILE) ? readFileSync(LIST_FILE, 'utf8') : ''
  return [...fromEnv.split(';'), ...fromFile.split(/\r?\n/)]
    .map((s) => s.trim())
    .filter((s) => s !== '' && !s.startsWith('#'))
}

const paths = mediaPaths()
const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-smoke-'))
vi.mock('electron', () => ({ app: { getPath: (): string => cacheRoot } }))

const { importFile } = await import('../../src/main/media/import')
const { probeFile } = await import('../../src/main/media/probe')
const { detectVfr } = await import('../../src/main/media/vfr')
const { decodePeaks } = await import('../../src/main/media/waveform')

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
})

describe.skipIf(paths.length === 0)('real footage', () => {
  it('has something to test', () => {
    expect(paths.length).toBeGreaterThan(0)
  })

  for (const path of paths) {
    const name = path.split(/[\\/]/).pop() ?? path

    describe(name, () => {
      it('imports all the way to ready', async () => {
        const asset = await importFile(
          path,
          () => {},
          () => {}
        )
        expect(asset.error ?? '').toBe('')
        expect(asset.status).toBe('ready')

        // Everything the editor needs must exist and be describable.
        expect(asset.durationSec).toBeGreaterThan(0)
        expect(asset.width).toBeGreaterThan(0)
        expect(asset.height).toBeGreaterThan(0)
        expect(asset.fps).toBeGreaterThan(0)
        expect((await stat(asset.playablePath)).size).toBeGreaterThan(0)
        expect((await stat(asset.filmstripPath)).size).toBeGreaterThan(500)

        const peaks = decodePeaks(await readFile(asset.peaksPath))
        expect(peaks.durationSec).toBeCloseTo(asset.durationSec, 0)
        if (asset.hasAudio) {
          expect(peaks.peaks.length).toBeGreaterThan(0)
        }

        // Log the decision so a human can sanity check the run.
        const decision = asset.conformed ? `conformed (${asset.conformReasons.join(', ')})` : 'used as-is'
        console.log(
          `  ${name}: ${asset.width}x${asset.height} ${asset.fps.toFixed(2)}fps ` +
            `${asset.durationSec.toFixed(1)}s ${asset.codec} ` +
            `${asset.hasAudio ? 'with audio' : 'silent'} -> ${decision}`
        )
      })

      it('describes the file the editor will actually play', async () => {
        const asset = await importFile(
          path,
          () => {},
          () => {}
        )
        const playable = await probeFile(asset.playablePath)

        // These three drive trimming and cropping. If the asset disagrees with
        // the file, every cut and every crop rectangle is wrong.
        expect(asset.width).toBe(playable.video.width)
        expect(asset.height).toBe(playable.video.height)
        expect(asset.durationSec).toBeCloseTo(playable.durationSec, 2)
      })

      it('leaves the editor with steady timing to work from', async () => {
        const asset = await importFile(
          path,
          () => {},
          () => {}
        )
        const playable = await probeFile(asset.playablePath)
        const stillVariable = await detectVfr(
          asset.playablePath,
          playable.video.nominalFps,
          playable.video.averageFps
        )
        // Either it was steady to begin with, or conforming made it steady.
        expect(stillVariable).toBe(false)
      })

      it('is cheap the second time', async () => {
        await importFile(
          path,
          () => {},
          () => {}
        )
        const stages: string[] = []
        const second = await importFile(
          path,
          (p) => stages.push(p.status),
          () => {}
        )
        expect(second.status).toBe('ready')
        expect(stages).not.toContain('conforming')
      })
    })
  }
})
