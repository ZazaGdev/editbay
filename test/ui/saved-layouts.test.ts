import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 68: a clip's framing saved under a name, applied to another clip in
 * one click, kept with the app's settings after a restart, and updated,
 * renamed and deleted (with Undo) from its right click menu.
 */

const fx = fixtureSet('ui-saved-layouts')
const root = await mkdtemp(join(tmpdir(), 'editbay-layouts-'))
const userData = join(root, 'user-data')
const WAIT = { timeout: 15_000 }
let app: ElectronApplication
let page: Page

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}

beforeAll(async () => {
  const obs = await fx.obsClip(30)
  await launch()
  await page.evaluate((p) => window.api.importFiles([p]), obs)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  for (let i = 1; i <= 2; i++) {
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === n, i, WAIT)
  }
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

async function selectClip(index: number): Promise<void> {
  const clip = page.locator('[data-testid="clip"][data-kind="video"]').nth(index)
  const box = (await clip.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect.poll(() => clip.getAttribute('data-selected'), WAIT).toBe('yes')
}

type Framed = { layout: string; crop: unknown; layers: { crop: unknown; place: unknown }[] }
async function framed(index: number): Promise<Framed> {
  return page.evaluate(async (i) => {
    const c = (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[i]!
    return { layout: c.layout, crop: c.transform.crop, layers: c.layers.map((l) => ({ crop: l.crop, place: l.place })) }
  }, index)
}
const names = (): Promise<string[]> =>
  page.locator('[data-testid="saved-layout"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-name') ?? ''))

async function menuOn(name: string): Promise<void> {
  await page.locator(`[data-testid="saved-layout"][data-name="${name}"]`).click({ button: 'right' })
  await page.waitForSelector('[data-testid="saved-layout-menu"]')
}

describe('saved layouts', () => {
  it('has none at first, and says what they are for', async () => {
    await selectClip(0)
    await page.waitForSelector('[data-testid="saved-layouts-empty"]', WAIT)
    expect(await names()).toEqual([])
  })

  it("saves a clip's framing under a name", async () => {
    await page.click('[data-testid="layout-split"]')
    await page.click('[data-testid="layout-swap"]')
    await page.waitForSelector('[data-testid="clip-pictures"][data-count="2"]', WAIT)
    await page.click('[data-testid="save-layout"]')
    expect(await page.inputValue('[data-testid="layout-name"]')).toBe('Layout 1')
    await page.fill('[data-testid="layout-name"]', 'Game + facecam')
    await page.press('[data-testid="layout-name"]', 'Enter')
    await expect.poll(names, WAIT).toEqual(['Game + facecam'])
    expect(await page.locator('[data-testid="layout-name-form"]').count()).toBe(0)
    await page.locator('[data-testid="saved-layouts"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(process.env.EDITBAY_SHOTS ?? root, 'saved-layouts.png') })
  })

  it('gives another clip that framing in one click, as one undo step', async () => {
    await selectClip(1)
    expect((await framed(1)).layout).not.toBe('split')
    await page.click('[data-testid="saved-layout"][data-name="Game + facecam"]')
    await expect.poll(async () => (await framed(1)).layout, WAIT).toBe('split')
    expect(await framed(1)).toEqual(await framed(0))
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => (await framed(1)).layout, WAIT).not.toBe('split')
  })

  it('says it will update a layout saved under a name already there', async () => {
    await page.click('[data-testid="save-layout"]')
    await page.fill('[data-testid="layout-name"]', 'game + FACECAM')
    await page.waitForSelector('[data-testid="layout-name-note"]')
    expect(await page.textContent('[data-testid="layout-name-save"]')).toBe('Update')
    await page.click('[data-testid="layout-name-cancel"]')
    expect(await names()).toEqual(['Game + facecam'])
  })

  it('updates, renames, and deletes with an Undo, from its right click', async () => {
    // Clip 1 is a single picture again: updating the layout from it makes the layout one picture.
    await menuOn('Game + facecam')
    await page.click('[data-testid="saved-layout-update"]')
    await expect
      .poll(async () => (await page.evaluate(() => window.api.appSettings())).savedLayouts[0]!.framing.layout, WAIT)
      .not.toBe('split')

    await menuOn('Game + facecam')
    await page.click('[data-testid="saved-layout-rename"]')
    await page.fill('[data-testid="layout-name"]', 'Talking head')
    await page.click('[data-testid="layout-name-save"]')
    await expect.poll(names, WAIT).toEqual(['Talking head'])

    await menuOn('Talking head')
    await page.click('[data-testid="saved-layout-delete"]')
    await expect.poll(names, WAIT).toEqual([])
    await page.click('[data-testid="toast-action"]')
    await expect.poll(names, WAIT).toEqual(['Talking head'])
  })

  // Bugs and notes 2, note 6: saved layouts in the shape list.
  it('saves the current framing from the shape list, and lists it there with its shape', async () => {
    await selectClip(0)
    await page.selectOption('[data-testid="export-preset"]', 'save-setup')
    expect(await page.inputValue('[data-testid="export-preset"]')).toBe('vertical')
    await page.fill('[data-testid="setup-name"]', 'Split setup')
    await page.press('[data-testid="setup-name"]', 'Enter')
    await expect.poll(names, WAIT).toEqual(['Talking head', 'Split setup'])
    const labels = await page.locator('[data-testid="export-preset"] optgroup option').allTextContents()
    expect(labels).toEqual(['Talking head (Vertical)', 'Split setup (Vertical)', 'Save current as...'])
  })

  it('sets the shape and every recording clip framing in one pick, and one undo puts both back', async () => {
    await page.selectOption('[data-testid="export-preset"]', 'landscape')
    await page.waitForFunction(() => (document.querySelector('[data-testid="export-preset"]') as HTMLSelectElement).value === 'landscape')
    expect((await framed(1)).layout).not.toBe('split')
    const value = await page
      .locator('[data-testid="export-preset"] option', { hasText: 'Split setup' })
      .getAttribute('value')
    await page.selectOption('[data-testid="export-preset"]', value!)
    await page.waitForFunction(() => (document.querySelector('[data-testid="export-preset"]') as HTMLSelectElement).value === 'vertical', undefined, WAIT)
    await expect.poll(async () => (await framed(1)).layout, WAIT).toBe('split')
    expect(await framed(1)).toEqual(await framed(0))
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForFunction(() => (document.querySelector('[data-testid="export-preset"]') as HTMLSelectElement).value === 'landscape', undefined, WAIT)
    expect((await framed(1)).layout).not.toBe('split')
  })

  it('is still there after the app is restarted, and a new project starts on the shape chosen last', async () => {
    await page.selectOption('[data-testid="export-preset"]', 'square')
    await expect.poll(async () => (await page.evaluate(() => window.api.appSettings())).lastShape, WAIT).toBe('square')
    await app.close()
    await launch()
    const kept = await page.evaluate(() => window.api.appSettings())
    expect(kept.savedLayouts.map((l) => l.name)).toEqual(['Talking head', 'Split setup'])
    expect(await page.inputValue('[data-testid="export-preset"]')).toBe('square')
    expect(await page.evaluate(async () => (await window.api.currentProject()).sequences.map((s) => s.name))).toEqual(['Square'])
  })
})
