import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Bugs and notes, item 17: a press on one of a clip's effect marks selects the
 * clip and opens the Inspector section the mark is about, even one folded by
 * hand, since the press asks for it by name.
 */

const fx = fixtureSet('ui-effect-marks')
const root = await mkdtemp(join(tmpdir(), 'editbay-effect-marks-'))
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  const clip = await fx.cleanClip()
  app = await electron.launch({
    args: ['.', `--user-data-dir=${join(root, 'user-data')}`],
    cwd: process.cwd()
  })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), clip)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').click()
  await page.waitForSelector('[data-testid="clip"]')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true }).catch(() => {})
  await fx.cleanup()
})

const look = '[data-inspector-group][data-group="Look"]'

describe('an effect mark on a clip', () => {
  it('selects the clip and opens the section it is about, though folded by hand', async () => {
    // A look put on the clip from its Look section, which is then folded by
    // hand, and nothing left selected.
    // Zoomed in, so the clip is wide enough for its mark clear of the trim handle.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    for (let i = 0; i < 4; i++) await page.keyboard.press('Equal')
    await page.locator('[data-testid="clip"]').first().click()
    await page.locator(`${look} [data-testid="look-select"]`).selectOption('mono')
    const mark = page.locator('[data-testid="clip"] [data-testid="clip-mark-effect"][data-effect="look"]')
    await mark.waitFor({ timeout: 10_000 })
    await page.locator(`${look} [data-testid="inspector-group-toggle"]`).click()
    await expect.poll(() => page.locator(look).getAttribute('data-folded'), { timeout: 5000 }).toBe('yes')
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('[data-testid="clip"][data-selected="yes"]').count(), { timeout: 5000 }).toBe(0)

    await mark.click()
    await expect.poll(() => page.locator('[data-testid="clip"][data-selected="yes"]').count(), { timeout: 5000 }).toBe(1)
    await expect.poll(() => page.locator(look).getAttribute('data-folded'), { timeout: 5000 }).toBe('no')
  })
})
