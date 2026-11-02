import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath, ffprobePath } from '../../src/main/ffmpeg/locate'
import { chooseExportFolder, closeExport, discardUnsavedWork, openExport } from './dialogs'

/**
 * Plan 105: a clip's speed, set in the Inspector, on the timeline and in the
 * exported file. A 10 s clip at 4x is 2.5 s, its sound silent; at 0.5x it is
 * 20 s; at 2x its sound is heard; and undo puts it back.
 */

const fx = fixtureSet('ui-speed')
const root = await mkdtemp(join(tmpdir(), 'editbay-speed-'))
let app: ElectronApplication
let page: Page
let exports = 0

beforeAll(async () => {
  const clip = await fx.solidClip('teal', 440, 10)
  app = await electron.launch({
    args: ['.', `--user-data-dir=${join(root, 'user-data')}`],
    cwd: process.cwd(),
    env: { ...process.env, EDITBAY_UNDER_TEST: '1', EDITBAY_TEST_WINDOW: 'hidden' }
  })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), clip)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').click()
  await page.waitForSelector('[data-testid="clip"]')
  await page.locator('[data-testid="clip"]').click()
  await page.waitForSelector('[data-testid="speed-section"]')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true }).catch(() => {})
  await fx.cleanup()
})

/** The picture's length on the timeline, in frames. */
async function pictureFrames(): Promise<number> {
  return Number(await page.locator('[data-testid="clip"]').first().getAttribute('data-length-frames'))
}

/** Wait until the picture on the timeline is `frames` long. */
async function lasts(frames: number): Promise<void> {
  await page.waitForFunction((n) => document.querySelector('[data-testid="clip"]')?.getAttribute('data-length-frames') === String(n), frames, { timeout: 10_000 })
}

/** Choose a speed from the Speed section's list. */
async function choose(value: string): Promise<void> {
  await page.locator('[data-testid="clip-speed-choice"]').click()
  await page.locator(`[data-testid="select-list"][data-for="clip-speed-choice"] [data-testid="select-option"][data-value="${value}"]`).click()
}

/** Export the sequence into a folder of its own, and the file it wrote. */
async function exported(): Promise<string> {
  const dir = join(root, `export-${++exports}`)
  await mkdir(dir, { recursive: true })
  await app.evaluate(async ({ dialog }, d) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] })
  }, dir)
  await openExport(page)
  await chooseExportFolder(page, dir)
  await page.locator('[data-testid="export-start"]').click()
  await page.waitForSelector('[data-testid="export-done"]', { timeout: 300_000 })
  expect(await page.locator('[data-testid="export-error"]').count()).toBe(0)
  await closeExport(page)
  const [file] = await readdir(dir)
  return join(dir, file!)
}

/** A file's length in seconds, by ffprobe. */
async function durationOf(file: string): Promise<number> {
  const out = await capture(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  return Number(out.stdout.toString().trim())
}

/** The loudest the file's sound gets, in dB: about -91 for silence. */
async function loudestOf(file: string): Promise<number> {
  const out = await capture(ffmpegPath, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
  const found = out.stderr.toString().match(/max_volume:\s*(-?[\d.]+) dB/)
  return found ? Number(found[1]) : -Infinity
}

describe('a clip at a speed', () => {
  it('at 4x lasts 2.5 s on the timeline, shows its speed, and exports 2.5 s with no sound', async () => {
    expect(await pictureFrames()).toBe(300)
    await choose('4')
    await lasts(75)
    expect(await page.locator('[data-testid="clip-speed"]').first().textContent()).toBe('4x')
    expect(await page.locator('[data-testid="sound-clip"]').first().getAttribute('data-length-frames')).toBe('75')
    expect(await page.locator('[data-testid="clip-speed-keep-sound"]').count()).toBe(1)
    // The preview plays its picture four times as fast.
    await page.locator('[data-testid="play-pause"]').click()
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll<HTMLVideoElement>('[data-testid="track-video"]')).some((v) => !v.paused && v.playbackRate >= 3.9),
      undefined,
      { timeout: 10_000 }
    )
    await page.locator('[data-testid="play-pause"]').click()
    const file = await exported()
    expect(await durationOf(file)).toBeCloseTo(2.5, 1)
    expect(await loudestOf(file)).toBeLessThan(-60)
  }, 360_000)

  it('undo puts it back to its own length', async () => {
    await page.locator('[data-testid="clip"]').first().click()
    await page.keyboard.press('ControlOrMeta+z')
    await lasts(300)
    expect(await page.locator('[data-testid="clip-speed"]').count()).toBe(0)
  })

  it('a typed 0.5x lasts 20 s, blends its frames, and exports 20 s', async () => {
    await page.locator('[data-testid="clip"]').first().click()
    const box = page.locator('[data-testid="clip-speed-typed"]')
    await box.fill('0.5')
    await box.press('Enter')
    await lasts(600)
    expect(await page.locator('[data-testid="clip-speed-smooth"]').count()).toBe(1)
    const file = await exported()
    expect(await durationOf(file)).toBeCloseTo(20, 0)
    // At 0.5x the sound is heard, slowed with its pitch kept.
    expect(await loudestOf(file)).toBeGreaterThan(-30)
  }, 360_000)

  it('at 2x its sound is heard', async () => {
    await page.locator('[data-testid="clip"]').first().click()
    await choose('2')
    await lasts(150)
    const file = await exported()
    expect(await durationOf(file)).toBeCloseTo(5, 1)
    expect(await loudestOf(file)).toBeGreaterThan(-30)
  }, 360_000)
})
