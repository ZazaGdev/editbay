import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fixtureSet } from '../e2e/fixtures'
import type { EditList } from '../../src/shared/edit-list'

/**
 * Plan 74: a project written by `npm run cli -- build` opens in Editbay, its
 * sources go through the app's own import, and the cut, the corner picture,
 * the zoom and the markers are where the edit list put them.
 */

const run = promisify(execFile)
const fx = fixtureSet('cli-build')
const root = await mkdtemp(join(tmpdir(), 'editbay-cli-build-'))
const CLI = join(process.cwd(), 'out', 'cli', 'editbay-cli.cjs')
let obs: string
let camera: string

beforeAll(async () => {
  ;[obs, camera] = [await fx.obsClip(), await fx.cleanClip()]
  await run(process.execPath, [join(process.cwd(), 'scripts', 'build-cli.mjs')])
}, 180_000)

afterAll(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

async function cli(...args: string[]): Promise<{ code: number; out: Record<string, unknown> }> {
  try {
    const { stdout } = await run(process.execPath, [CLI, ...args])
    return { code: 0, out: JSON.parse(stdout) as Record<string, unknown> }
  } catch (err) {
    const e = err as { code: number; stdout: string }
    return { code: e.code, out: JSON.parse(e.stdout) as Record<string, unknown> }
  }
}

async function launch(userData: string, project: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, project],
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForSelector('main')
  return { app, page }
}

async function closeAndWait(app: ElectronApplication): Promise<void> {
  // Opening rebuilt the sources, a change to save: the question is answered Don't save.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
  const closed = app.waitForEvent('close', { timeout: 30_000 })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close()
  })
  await closed
}

type Spanned = { sourceIn: number; sourceOut: number; timelineStart: number }
const spans = (clips: Spanned[]): number[][] => clips.map((c) => [c.sourceIn, c.sourceOut, c.timelineStart])

/** What the project built below must hold once Editbay has imported every source, and that it plays. */
async function opensAsListed(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const clips = [...document.querySelectorAll('[data-testid="clip"]')]
      return clips.length === 4 && clips.every((c) => c.getAttribute('data-rebuilding') === 'no' && c.getAttribute('data-offline') === 'no')
    },
    undefined,
    { timeout: 180_000 }
  )
  expect(await page.locator('[data-testid="missing-media"]').count()).toBe(0)

  const opened = await page.evaluate(() => window.api.currentProject())
  for (const m of opened.media) {
    expect(existsSync(m.playablePath)).toBe(true)
    expect(existsSync(m.peaksPath)).toBe(true)
    expect(existsSync(m.filmstripPath)).toBe(true)
  }
  expect(opened.media.find((m) => m.id === 'screen')!.trackFiles).toHaveLength(1)

  const s = opened.sequences[0]!
  // At 30 fps, 1 s to 1.5 s out. The recording runs a frame past 3 s, which the last piece keeps.
  const end = s.videoTracks[0]!.clips[1]!.sourceOut
  expect(end).toBeGreaterThanOrEqual(90)
  expect(spans(s.videoTracks[0]!.clips)).toEqual([
    [0, 30, 0],
    [45, end, 30]
  ])
  expect(spans(s.audioTracks[0]!.clips)).toEqual(spans(s.videoTracks[0]!.clips))
  // The camera, 15 frames ahead, in the bottom left corner.
  expect(spans(s.videoTracks[1]!.clips)).toEqual([
    [15, 45, 0],
    [60, end + 15, 30]
  ])
  const place = s.videoTracks[1]!.clips[0]!.transform.place
  expect(place.x).toBeCloseTo(0, 5)
  expect(place.y + place.h).toBeCloseTo(1, 5)
  // The zoom eases in over half a second from 1.8 s and out by 2.9 s, on the recording's frames.
  expect(s.videoTracks[0]!.clips[1]!.transform.keys!.map((k) => k.at)).toEqual([54, 69, 72, 87])
  expect(s.markers.map((m) => [m.frame, m.name])).toEqual([
    [15, 'Start'],
    [30, 'Retake: "take one"'],
    [39, 'Zoom: the blue side']
  ])
  expect(await page.locator('[data-testid="marker"]').count()).toBe(3)

  await page.keyboard.press('Space')
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead')) > 20, undefined, { timeout: 20_000 })
  await page.keyboard.press('Space')
}

describe('a project built from an edit list', () => {
  it('opens with every source imported, and the cut, corner, zoom and markers as listed', async () => {
    const files = await mkdtemp(join(root, 'files-'))
    // A 3 s OBS-shaped recording, with a 4 s camera that started half a second before it.
    const list: EditList = {
      version: 1,
      shape: 'landscape',
      sources: [
        { id: 'screen', path: obs, offsetSec: 0 },
        { id: 'camera', path: camera, offsetSec: -0.5 }
      ],
      main: 'screen',
      sound: 'screen',
      corner: { source: 'camera', at: 'bottom-left' },
      cuts: [{ fromSec: 1, toSec: 1.5, why: 'retake', words: 'take one', mark: true }],
      zooms: [{ fromSec: 1.8, toSec: 2.9, rect: { x: 0.6, y: 0.1, w: 0.3, h: 0.3 }, how: 'smooth', why: 'the blue side', mark: true }],
      markers: [{ atSec: 0.5, label: 'Start' }]
    }
    const listPath = join(files, 'cut.json')
    await writeFile(listPath, JSON.stringify(list, null, 2))
    const target = join(files, 'cut.editbay')

    const built = await cli('build', listPath, '--out', target)
    expect(built.code).toBe(0)
    expect(built.out.ok).toBe(true)
    expect(existsSync(target)).toBe(true)
    // The cut's words are in the report, as the edit list says they are for.
    expect(built.out.cuts).toEqual([{ reel: 0, fromSec: 1, toSec: 1.5, why: 'retake', words: 'take one' }])
    // Never over a file that is there.
    const again = await cli('build', listPath, '--out', target)
    expect(again.code).toBe(1)
    expect(again.out.error).toMatch(/already exists/)

    const { app, page } = await launch(join(files, 'user-data'), target)
    try {
      await opensAsListed(page)
    } finally {
      await closeAndWait(app)
    }
  }, 400_000)

  it('refuses an edit list it cannot honour, naming the entry', async () => {
    const files = await mkdtemp(join(root, 'files-'))
    const list = { version: 1, shape: 'landscape', sources: [{ id: 'screen', path: obs, offsetSec: 0 }], main: 'screen', sound: 'screen', cuts: [], zooms: [], markers: [{ atSec: 9, label: 'Too late' }] }
    const listPath = join(files, 'late.json')
    await writeFile(listPath, JSON.stringify(list))
    const built = await cli('build', listPath, '--out', join(files, 'late.editbay'))
    expect(built.code).toBe(1)
    expect(built.out.error).toMatch(/markers\[0\]: is at 9 s, after the main source ends/)
    expect(existsSync(join(files, 'late.editbay'))).toBe(false)
  }, 60_000)
})
