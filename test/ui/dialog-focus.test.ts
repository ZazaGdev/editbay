import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 51: a dialog is modal to the keyboard as well as to the mouse. Focus
 * goes into it when it opens, Tab goes round inside it rather than on into
 * the dimmed editor, and closing it hands focus back to what had it.
 */

const root = await mkdtemp(join(tmpdir(), 'editbay-dialog-focus-'))
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/** The test id of what has focus, and whether it is inside the dialog with this test id. */
async function focus(dialog: string): Promise<{ inside: boolean; testid: string | null; tag: string }> {
  return page.evaluate((id) => {
    const at = document.activeElement
    const box = document.querySelector(`[data-testid="${id}"]`)
    return {
      inside: box !== null && at !== null && box.contains(at),
      testid: at?.getAttribute('data-testid') ?? null,
      tag: at?.tagName ?? ''
    }
  }, dialog)
}

describe('a dialog and the keyboard', () => {
  it('says it is modal, takes focus when it opens, and keeps Tab inside it both ways', async () => {
    await page.click('[data-testid="open-export"]')
    await page.waitForSelector('[data-testid="export-panel"]')
    expect(await page.getAttribute('[data-testid="export-panel"]', 'aria-modal')).toBe('true')
    await expect.poll(async () => (await focus('export-panel')).inside).toBe(true)
    // Further round than it has controls, so Tab has to wrap to stay inside.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      expect((await focus('export-panel')).inside).toBe(true)
    }
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Shift+Tab')
      expect((await focus('export-panel')).inside).toBe(true)
    }
  })

  it('gives focus back to what opened it when it closes', async () => {
    // Arranged here, not left from the test above: opened from the keyboard,
    // so its button keeps focus. One clicked with the mouse gives it up.
    if ((await page.locator('[data-testid="export-panel"]').count()) > 0) {
      await page.keyboard.press('Escape')
      await page.waitForSelector('[data-testid="export-panel"]', { state: 'detached' })
    }
    await page.focus('[data-testid="open-export"]')
    await page.keyboard.press('Enter')
    await page.waitForSelector('[data-testid="export-panel"]')
    await expect.poll(async () => (await focus('export-panel')).inside).toBe(true)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="export-panel"]', { state: 'detached' })
    await expect.poll(async () => (await focus('export-panel')).testid).toBe('open-export')
  })

  it('leaves focus where a dialog put it itself, and still gives it back after', async () => {
    await page.focus('[data-testid="open-settings"]')
    await page.keyboard.press('Enter')
    await page.waitForSelector('[data-testid="settings"]')
    // Settings puts focus in its own search box: the dialog does not move it on to its first control.
    await expect.poll(async () => (await focus('settings')).tag).toBe('INPUT')
    expect((await focus('settings')).inside).toBe(true)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="settings"]', { state: 'detached' })
    await expect.poll(async () => (await focus('settings')).testid).toBe('open-settings')
  })
})
