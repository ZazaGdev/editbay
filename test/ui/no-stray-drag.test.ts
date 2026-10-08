import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Item 18: a press on a control inside text that was selected dragged a
 * see-through copy of the panel instead of moving the control. One clip on V1,
 * its sound on A1, the sound selected so the Inspector shows its volume.
 */

const fx = fixtureSet('ui-no-stray-drag')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-no-stray-drag-'))
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  const clip = await fx.cleanClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), clip)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="sound-clip"]', WAIT)
  await page.locator('[data-testid="sound-clip"]').first().click()
  await page.waitForSelector('[data-testid="linked-sound-level"]', WAIT)
  await page.evaluate(() => {
    ;(window as unknown as { drags: number }).drags = 0
    window.addEventListener('dragstart', (e) => {
      if (!e.defaultPrevented) (window as unknown as { drags: number }).drags += 1
    })
  })
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

const drags = (): Promise<number> => page.evaluate(() => (window as unknown as { drags: number }).drags)
const selected = (): Promise<string> => page.evaluate(() => window.getSelection()?.toString() ?? '')

describe('a press on a control inside selected text', () => {
  it('moves the slider, and drags no copy of the panel', async () => {
    const slider = page.locator('[data-testid="linked-sound-level"]')
    const before = Number(await slider.getAttribute('data-value'))
    // All of the Inspector selected, as a stray drag across it or a double click can leave it.
    await slider.evaluate((el) => {
      let p: HTMLElement | null = el as HTMLElement
      while (p && p.getBoundingClientRect().height < 300) p = p.parentElement
      const r = document.createRange()
      r.selectNodeContents(p!)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(r)
    })
    const box = (await slider.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * 0.3 + i * 8, box.y + box.height / 2)
    await page.mouse.up()
    expect(await drags()).toBe(0)
    await expect.poll(async () => Number(await slider.getAttribute('data-value')), WAIT).not.toBe(before)
    expect(await selected()).toBe('')
    await page.keyboard.press('Control+z')
  })

  it('selects nothing when the pointer is dragged across the Inspector\'s labels', async () => {
    const label = page.locator('[data-testid="linked-sound-level"]')
    const box = (await label.boundingBox())!
    // From left of the slider, over the labels, to below it.
    await page.mouse.move(box.x - 120, box.y - 30)
    await page.mouse.down()
    await page.mouse.move(box.x - 60, box.y + 40, { steps: 6 })
    await page.mouse.up()
    expect(await selected()).toBe('')
    expect(await drags()).toBe(0)
  })

  it('still lets the text in a box be selected', async () => {
    const typed = page.locator('[data-testid="linked-sound-level-typed"]')
    await typed.click({ clickCount: 3 })
    const span = await typed.evaluate((el) => {
      const input = el as HTMLInputElement
      return (input.selectionEnd ?? 0) - (input.selectionStart ?? 0)
    })
    expect(span).toBeGreaterThan(0)
    await page.keyboard.press('Escape')
  })
})
