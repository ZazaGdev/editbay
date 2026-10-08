import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discardUnsavedWork } from './dialogs'

/**
 * A shortcut on a mouse button: the middle one, or either side button,
 * recorded in the shortcuts window as a key is, and run from anywhere in the
 * editor. The left and right buttons still click.
 */

const root = await mkdtemp(join(tmpdir(), 'editbay-mouse-keys-'))
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 300_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/** A press of a mouse button by its number, which is how a side button has to be made: Playwright has none. */
async function pressButton(button: number, at = 'main'): Promise<void> {
  await page.evaluate(
    ({ button, at }) => {
      const target = document.querySelector(at)!
      const common = { bubbles: true, cancelable: true, button, buttons: 1 << button, pointerType: 'mouse' }
      target.dispatchEvent(new PointerEvent('pointerdown', common))
      target.dispatchEvent(new MouseEvent('mousedown', common))
      target.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0 }))
      target.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 }))
    },
    { button, at }
  )
}

const combos = (id: string): Promise<string[]> =>
  page.getAttribute(`[data-testid="shortcut-${id}"]`, 'data-combos').then((c) => (c ?? '').split(' ').filter(Boolean))

describe('a shortcut on a mouse button', () => {
  it('is recorded from a side button, and says which', async () => {
    await page.locator('[data-testid="open-shortcuts"]').click()
    await page.waitForSelector('[data-testid="shortcuts-dialog"]')
    await page.locator('[data-testid="shortcut-add-addText"]').click()
    await page.waitForSelector('[data-testid="shortcut-recording"]')
    await pressButton(3, '[data-testid="shortcuts-dialog"]')
    await expect.poll(() => combos('addText')).toEqual(['KeyT', 'MouseBack'])
    expect(await page.locator('[data-testid="shortcut-addText"]').textContent()).toContain('Mouse back button')
  })

  it('is recorded from the middle button', async () => {
    await page.locator('[data-testid="shortcut-add-addMarker"]').click()
    await page.waitForSelector('[data-testid="shortcut-recording"]')
    const box = (await page.locator('[data-testid="shortcuts-dialog"]').boundingBox())!
    await page.mouse.move(box.x + 20, box.y + 20)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.up({ button: 'middle' })
    await expect.poll(() => combos('addMarker')).toEqual(['KeyM', 'MouseMiddle'])
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="shortcuts-dialog"]', { state: 'detached' })
  })

  it('runs what it is put on, from anywhere in the editor', async () => {
    await page.keyboard.press('Control+n')
    await pressButton(3)
    await page.waitForSelector('[data-testid="clip"]', { timeout: 10_000 })
    const box = (await page.locator('[data-testid="timeline-scroll"]').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 10)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.up({ button: 'middle' })
    await expect
      .poll(async () => page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.markers.length))
      .toBe(1)
  })
})
