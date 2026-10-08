import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { SOURCES } from '../../src/main/speech/engine'
import { discardUnsavedWork } from './dialogs'

/**
 * A transcript with no captions made, in the real app: the export, or Save
 * only the transcript, listens to the speech itself, with the stand-in for
 * whisper-cli that says it heard "Hello there everyone." Nothing is put on
 * the caption track. V1 holds a 4 second clip of solid red with its sound.
 */

const fx = fixtureSet('transcript-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-transcript-ui-'))
const userData = join(root, 'user-data')
const fake = join(process.cwd(), 'test', 'fixtures', 'fake-whisper.mjs')
let app: ElectronApplication
let page: Page
let out = ''
let counter = 0

beforeAll(async () => {
  const clean = await fx.redClip()
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: process.cwd(),
    env: { ...process.env, EDITBAY_SPEECH_FAKE: fake }
  })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), clean)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 180_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]', WAIT)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** Open the Export window on a folder of its own for this test, which the folder dialog stub hands back. */
async function openExportOnNewFolder(): Promise<void> {
  out = await mkdtemp(join(root, `out${++counter}-`))
  await app.evaluate(async ({ dialog }, d) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] })
  }, out)
  await page.locator('[data-testid="open-export"]').click()
  await page.waitForSelector('[data-testid="export-panel"]', WAIT)
  await page.locator('[data-testid="export-folder"]').click()
  await page.waitForFunction((dir) => document.querySelector('[data-testid="export-folder"]')?.getAttribute('title') === dir, out)
}

async function closeExport(): Promise<void> {
  await page.locator('[data-testid="export-panel-close"]').click()
  await page.waitForSelector('[data-testid="export-panel"]', { state: 'detached', timeout: 15_000 })
}

/** The text files in the folder this test exports to. */
async function texts(): Promise<string[]> {
  return (await readdir(out)).filter((f) => f.endsWith('.txt'))
}

describe('a transcript without captions', () => {
  it('saves only the transcript, listened to, and puts no captions on the timeline', async () => {
    await openExportOnNewFolder()
    await page.locator('[data-testid="export-save-transcript"]').click()
    await expect.poll(texts, { timeout: 30_000 }).toHaveLength(1)
    expect(await readFile(join(out, (await texts())[0]!), 'utf8')).toBe('Hello there everyone.\n')
    // No video, and nothing on the caption track.
    expect((await readdir(out)).filter((f) => f.endsWith('.mp4'))).toEqual([])
    expect(await page.locator('[data-testid="caption"]').count()).toBe(0)
    await page.waitForSelector('[data-testid="export-save-transcript"]:not([disabled])', WAIT)
    // Said over the Export window, not under its scrim, with Show in folder
    // clickable there: tried, not clicked, so no folder opens on the machine.
    const told = page.locator('[data-testid="toast"][data-kind="transcript"]', { hasText: 'Saved the transcript' })
    await told.waitFor(WAIT)
    await told.locator('[data-testid="toast-action"]').click({ trial: true, timeout: 2000 })
    await closeExport()
  })

  it('has the export listen for the transcript beside the video, and says it will', async () => {
    await openExportOnNewFolder()
    const box = page.locator('[data-testid="export-transcript-file"]')
    expect(await box.isDisabled()).toBe(false)
    await box.check()
    await page.waitForSelector('[data-testid="export-transcript-listens"]', WAIT)
    const will = page.locator('[data-testid="export-will-write"]')
    await expect.poll(() => will.getAttribute('data-count'), WAIT).toBe('2')
    expect(await will.textContent()).toMatch(/\.txt/)
    await page.waitForFunction(() => !(document.querySelector('[data-testid="export-start"]') as HTMLButtonElement | null)?.disabled)
    await page.locator('[data-testid="export-start"]').click()
    await page.waitForSelector('[data-testid="export-done"]', { timeout: 120_000 })
    const files = (await readdir(out)).sort()
    expect(files.filter((f) => f.endsWith('.mp4'))).toHaveLength(1)
    expect(await texts()).toEqual([files.find((f) => f.endsWith('.mp4'))!.replace(/\.mp4$/, '.txt')])
    expect(await readFile(join(out, (await texts())[0]!), 'utf8')).toBe('Hello there everyone.\n')
    expect(await page.locator('[data-testid="caption"]').count()).toBe(0)
    await box.uncheck()
    await closeExport()
  })

  it('offers the speech model download when it is not on this computer, and will not export until it is', async () => {
    // Sources of its own, which are not downloaded into this test's settings folder.
    await app.evaluate((_electron, v) => void (process.env.EDITBAY_SPEECH_SOURCES = v), JSON.stringify(SOURCES))
    try {
      await openExportOnNewFolder()
      await page.locator('[data-testid="export-transcript-file"]').check()
      await page.waitForSelector('[data-testid="export-speech-download"]', WAIT)
      expect(await page.locator('[data-testid="export-start"]').isDisabled()).toBe(true)
      await page.locator('[data-testid="export-transcript-file"]').uncheck()
      await expect.poll(() => page.locator('[data-testid="export-speech-download"]').count(), WAIT).toBe(0)
      await closeExport()
    } finally {
      await app.evaluate(() => void delete process.env.EDITBAY_SPEECH_SOURCES)
    }
  })
})
