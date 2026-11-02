import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'
import type { EditList } from '../../src/shared/edit-list'

/**
 * Task 139: an edit list's `endDipToBlackSec`. Built by `npm run cli --
 * build`, the cut opens in Editbay with a Dip to black on the out edge of its
 * last clip, shown on the timeline as any transition is, and an exported
 * frame darkens through it to black at the end.
 */

const run = promisify(execFile)
const fx = fixtureSet('cli-ending')
const root = await mkdtemp(join(tmpdir(), 'editbay-cli-ending-'))
const CLI = join(process.cwd(), 'out', 'cli', 'editbay-cli.cjs')
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  await run(process.execPath, [join(process.cwd(), 'scripts', 'build-cli.mjs')])
}, 180_000)

afterAll(async () => {
  if (app) await discardUnsavedWork(app).catch(() => undefined)
  await app?.close().catch(() => undefined)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** How red the middle of the frame on `frame` is, as an exported frame writes it. */
async function redAt(frame: number): Promise<number> {
  const saved = await page.evaluate(async (r) => {
    const p = await window.api.currentProject()
    return window.api.saveFrame({ sequenceId: p.sequences[0]!.id, frame: r.frame, outputDir: r.dir })
  }, { frame, dir: join(root, 'frames') })
  expect(saved.error).toBeUndefined()
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', saved.path!, '-vf', 'crop=1:1:iw/2:ih/2,format=rgb24', '-f', 'rawvideo', 'pipe:1'])
  return stdout[0]!
}

describe('a dip to black at the end, built from an edit list', () => {
  it('opens as a Dip to black on the last clip, and the export darkens to black through it', async () => {
    const main = await fx.solidClip('red', 440, 8)
    // 8 s with 1 s taken out: a 7 s cut, 210 frames, dipping over its last 60.
    const list: EditList = {
      version: 1,
      shape: 'landscape',
      sources: [{ id: 'main', path: main, offsetSec: 0 }],
      main: 'main',
      sound: 'main',
      cuts: [{ fromSec: 1, toSec: 2, why: 'pause' }],
      zooms: [],
      markers: [],
      endDipToBlackSec: 2
    }
    const listPath = join(root, 'ending.json')
    await writeFile(listPath, JSON.stringify(list, null, 2))
    const target = join(root, 'ending.editbay')
    const { stdout } = await run(process.execPath, [CLI, 'build', listPath, '--out', target])
    expect((JSON.parse(stdout) as { ok: boolean }).ok).toBe(true)

    app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`, target], cwd: process.cwd(), env: { ...process.env } as Record<string, string> })
    page = await app.firstWindow()
    await page.waitForSelector('main')
    await page.waitForFunction(
      () => {
        const clips = [...document.querySelectorAll('[data-testid="clip"]')]
        return clips.length === 2 && clips.every((c) => c.getAttribute('data-rebuilding') === 'no' && c.getAttribute('data-offline') === 'no')
      },
      undefined,
      { timeout: 180_000 }
    )
    // On the timeline as a transition put there by hand would be.
    const shown = await page
      .locator('[data-testid="clip-transition"]')
      .evaluateAll((els) => els.map((e) => [e.getAttribute('data-side'), e.getAttribute('data-kind'), e.getAttribute('data-from'), e.getAttribute('data-to')]))
    expect(shown).toContainEqual(['out', 'toBlack', '150', '210'])

    const before = await redAt(120)
    const halfway = await redAt(180)
    const last = await redAt(209)
    expect(before, 'red before the dip').toBeGreaterThan(200)
    expect(halfway, 'darker halfway through').toBeLessThan(before * 0.75)
    expect(halfway, 'not black yet halfway').toBeGreaterThan(20)
    expect(last, 'black on the last frame').toBeLessThan(20)
  }, 400_000)
})
