import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 93: the framing used last, given to a recording of the same size put
 * on a new project, with a notice and an Undo, and offered to one of another
 * size with Use and Dismiss.
 */

const fx = fixtureSet('ui-last-framing')
const root = await mkdtemp(join(tmpdir(), 'editbay-last-framing-'))
const WAIT = { timeout: 15_000 }
let app: ElectronApplication
let page: Page
let clean: string
let obs: string

beforeAll(async () => {
  ;[clean, obs] = [await fx.cleanClip(), await fx.obsClip(30)]
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** Bring a file in and put it at the end of V1, as Add to timeline does. */
async function add(path: string): Promise<void> {
  const [asset] = await page.evaluate((p) => window.api.importFiles([p]), path)
  const card = `[data-testid="asset"][data-asset-id="${asset!.id}"]`
  await page.waitForSelector(`${card}[data-status="ready"]`, { timeout: 120_000 })
  const before = await page.locator('[data-testid="clip"][data-kind="video"]').count()
  await page.locator(`${card} [data-testid="add-to-timeline"]`).click()
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === n, before + 1, WAIT)
}

/** The crop of the clip at `index` on V1. */
function cropX(index: number): Promise<number> {
  return page.evaluate(async (i) => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[i]!.transform.crop.x, index)
}

describe('the framing used last', () => {
  it('is remembered from a recording framed by hand', async () => {
    await add(clean)
    expect(await cropX(0)).toBeGreaterThan(0)
    await page.locator('[data-testid="clip"][data-kind="video"]').first().click()
    const box = page.locator('[data-testid="crop-x"]')
    await box.fill('0')
    await box.press('Enter')
    await expect.poll(() => cropX(0), WAIT).toBe(0)
    await expect.poll(async () => (await page.evaluate(() => window.api.appSettings())).lastFraming?.crop.x, WAIT).toBe(0)
  })

  it('is given to a recording of the same size in a new project, with an Undo', async () => {
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('ControlOrMeta+n')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0, undefined, WAIT)
    await add(clean)
    await page.waitForSelector('[data-testid="toast"][data-kind="lastFraming"]', WAIT)
    await expect.poll(() => cropX(0), WAIT).toBe(0)
    await page.locator('[data-testid="toast"][data-kind="lastFraming"] [data-testid="toast-undo"]').click()
    await expect.poll(() => cropX(0), WAIT).toBeGreaterThan(0)
  })

  it('is offered to a recording of another size, and given when Use is pressed', async () => {
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('ControlOrMeta+n')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0, undefined, WAIT)
    await add(obs)
    const offer = '[data-testid="toast"][data-kind="lastFramingOffer"]'
    await page.waitForSelector(offer, WAIT)
    // Offered, not given.
    const before = await cropX(0)
    await page.waitForTimeout(300)
    expect(await cropX(0)).toBe(before)
    expect(await page.locator(`${offer} [data-testid="toast-dismiss"]`).count()).toBe(1)
    await page.locator(`${offer} [data-testid="toast-action"]`).click()
    // Given, scaled to this recording: a wider one, so its crop is fitted to the view it was taken from.
    await expect.poll(() => cropX(0), WAIT).not.toBe(before)
  })
})
