import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { answerSaveDialog, discardUnsavedWork } from './dialogs'

/**
 * Plan 18 step 3, driven through the real window: Shift+S cuts every track at
 * the playhead, and a range marked with In and Out is lifted by Delete or
 * taken out closing up by Shift+Delete.
 *
 * V1 holds the 4 second red clip (0 to 120) with its sound on A1, then the
 * 3 second green clip (120 to 210), which has none.
 */

const fx = fixtureSet('ranges-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-ranges-'))
const userData = join(root, 'user-data')
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  const [red, green] = [await fx.redClip(), await fx.greenClip()]
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  const assets = await page.evaluate((p) => window.api.importFiles(p), [red, green])
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length === 2, undefined, {
    timeout: 180_000
  })
  for (const [n, id] of [assets[0]!.id, assets[1]!.id].entries()) {
    await page.locator(`[data-testid="asset"][data-asset-id="${id}"] [data-testid="add-to-timeline"]`).click()
    await page.waitForFunction((want) => document.querySelectorAll('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').length === want, n + 1, WAIT)
  }
  await press('Home')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** A key pressed with nothing in particular focused, so it reaches the editor. */
async function press(key: string): Promise<void> {
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press(key)
}

/** Every track's clips, each as its start and its length. */
async function tracks(): Promise<{ v1: [number, number][]; a1: [number, number][] }> {
  return page.evaluate(async () => {
    const s = (await window.api.currentProject()).sequences[0]!
    const of = (clips: { timelineStart: number; sourceIn: number; sourceOut: number }[]): [number, number][] =>
      clips.map((c) => [c.timelineStart, c.sourceOut - c.sourceIn] as [number, number])
    return { v1: of(s.videoTracks[0]!.clips), a1: of(s.audioTracks[0]!.clips) }
  })
}

async function playhead(): Promise<number> {
  return Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
}

/** Put the playhead on a frame, a second a press and then a frame a press. */
async function goTo(frame: number): Promise<void> {
  await press('Home')
  for (let i = 0; i < Math.floor(frame / 30); i++) await page.keyboard.press('Shift+ArrowRight')
  for (let i = 0; i < frame % 30; i++) await page.keyboard.press('ArrowRight')
  await expect.poll(playhead, WAIT).toBe(frame)
}

describe('splitting every track', () => {
  it('cuts the picture and its sound at the playhead with one key', async () => {
    await goTo(60)
    await press('Shift+KeyS')
    await expect.poll(tracks, WAIT).toEqual({
      v1: [
        [0, 60],
        [60, 60],
        [120, 90]
      ],
      a1: [
        [0, 60],
        [60, 60]
      ]
    })
    await press('Control+z')
    await expect.poll(async () => (await tracks()).v1.length, WAIT).toBe(2)
  })

  it('cuts once when Shift+S is held down', async () => {
    await goTo(60)
    await press('Shift+KeyS')
    await expect.poll(async () => (await tracks()).v1.length, WAIT).toBe(3)
    // Windows repeats a held key. Each repeat would push an undo step that cuts nothing.
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 'S', shiftKey: true, repeat: true, bubbles: true })))
    }
    await page.waitForTimeout(300)
    expect((await tracks()).v1.length).toBe(3)
    // One undo puts it back: the repeats pushed no steps of their own.
    await press('Control+z')
    await expect.poll(async () => (await tracks()).v1.length, WAIT).toBe(2)
  })
})

describe('a marked range', () => {
  it('shows In and Out on the ruler, and how long the range is', async () => {
    await goTo(30)
    await press('Shift+KeyI')
    await goTo(89)
    await press('Shift+KeyO')
    // A mark is an edit, so the ruler shows it once the project has taken it.
    // Out is one frame past the playhead, so the frame you are on is in the range.
    await page.waitForSelector('[data-testid="marked-range"][data-from="30"][data-to="90"]', WAIT)
    expect(await page.getAttribute('[data-testid="range-shade"]', 'data-from')).toBe('30')
    expect(await page.locator('[data-testid="range-length"]').textContent()).toContain('00:00:02:00')
  })

  it('lifts the range with Delete, leaving a gap the same length', async () => {
    await goTo(30)
    await press('Shift+KeyI')
    await goTo(89)
    await press('Shift+KeyO')
    await press('Delete')
    await expect.poll(tracks, WAIT).toEqual({
      v1: [
        [0, 30],
        [90, 30],
        [120, 90]
      ],
      a1: [
        [0, 30],
        [90, 30]
      ]
    })
    // The marks are gone with it, and the playhead is where the range began.
    // Read off the window once it has the document main already has.
    await expect.poll(() => page.locator('[data-testid="marked-range"]').count(), WAIT).toBe(0)
    await expect.poll(playhead, WAIT).toBe(30)
    await press('Control+z')
    await expect.poll(async () => (await tracks()).v1.length, WAIT).toBe(2)
  })

  it('takes the range out with Shift+Delete, moving everything after it up', async () => {
    await goTo(30)
    await press('Shift+KeyI')
    await goTo(89)
    await press('Shift+KeyO')
    await press('Shift+Delete')
    await expect.poll(tracks, WAIT).toEqual({
      v1: [
        [0, 30],
        [30, 30],
        [60, 90]
      ],
      a1: [
        [0, 30],
        [30, 30]
      ]
    })
    await expect.poll(playhead, WAIT).toBe(30)
    await press('Control+z')
    await expect.poll(async () => (await tracks()).v1.length, WAIT).toBe(2)
  })

  it('clears the marks with Ctrl+Shift+X, and then Delete acts on the selection again', async () => {
    await goTo(30)
    await press('Shift+KeyI')
    await goTo(89)
    await press('Shift+KeyO')
    await page.waitForSelector('[data-testid="marked-range"]', WAIT)
    await press('Control+Shift+KeyX')
    await expect.poll(() => page.locator('[data-testid="marked-range"]').count(), WAIT).toBe(0)

    // Nothing selected and no range: Delete does nothing at all.
    await press('Escape')
    await press('Delete')
    await page.waitForTimeout(200)
    expect((await tracks()).v1.length).toBe(2)
  })

  it('puts back a mark pressed by mistake with one undo', async () => {
    await goTo(30)
    await press('Shift+KeyI')
    await goTo(89)
    await press('Shift+KeyO')
    await page.waitForSelector('[data-testid="marked-range"][data-from="30"][data-to="90"]', WAIT)
    // In pressed again over a range set with care.
    await goTo(60)
    await press('Shift+KeyI')
    await page.waitForSelector('[data-testid="marked-range"][data-from="60"]', WAIT)
    await press('Control+z')
    await page.waitForSelector('[data-testid="marked-range"][data-from="30"][data-to="90"]', WAIT)
    // Undoing the marks never touched the playhead: where you are is still not an edit.
    expect(await playhead()).toBe(60)
  })

  it('undoes only the last of edits pressed faster than the window hears back', async () => {
    const marks = (): Promise<unknown> => page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.marks ?? null)
    // From no marks at all, whatever the test before left.
    await press('Control+Shift+KeyX')
    await expect.poll(marks, WAIT).toBeNull()
    // Out and undo in the same breath as In, with nothing waited for between.
    await goTo(30)
    await page.keyboard.press('Shift+KeyI')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+KeyO')
    await page.keyboard.press('Control+z')
    await expect.poll(marks, WAIT).toEqual({ in: 30 })
    await page.waitForSelector('[data-testid="marked-range"][data-from="30"]', WAIT)
    await press('Control+Shift+KeyX')
    await expect.poll(marks, WAIT).toBeNull()
  })

  it('keeps the marks when the project is saved and opened again', async () => {
    await goTo(30)
    await press('Shift+KeyI')
    await goTo(89)
    await press('Shift+KeyO')
    await page.waitForSelector('[data-testid="marked-range"]', WAIT)
    const file = join(root, 'marked.editbay')
    await answerSaveDialog(app, file)
    await press('Control+Shift+KeyS')
    for (let i = 0; i < 100 && !(await stat(file).catch(() => null)); i++) await new Promise((r) => setTimeout(r, 100))
    await page.evaluate(() => window.api.newProject())
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0, undefined, WAIT)
    await page.evaluate((path) => window.api.openProject(path), file)
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').length === 2, undefined, WAIT)
    await page.waitForSelector('[data-testid="marked-range"]', WAIT)
    expect(await page.getAttribute('[data-testid="marked-range"]', 'data-from')).toBe('30')
    expect(await page.getAttribute('[data-testid="marked-range"]', 'data-to')).toBe('90')
  })
})
