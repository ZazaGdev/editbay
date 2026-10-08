import { describe, it, expect, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Shortcuts you change must still be there after the app is closed and opened
 * again. The only honest way to check that is to close it and open it again.
 */

const userData = await mkdtemp(join(tmpdir(), 'editbay-keys-'))

afterAll(async () => {
  await rm(userData, { recursive: true, force: true })
})

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  const page = await app.firstWindow()
  await page.waitForSelector('main')
  return { app, page }
}

describe('custom shortcuts across a restart', () => {
  it('are still there after the app is closed and reopened', async () => {
    const first = await launch()
    await first.page.locator('[data-testid="open-shortcuts"]').click()
    await first.page.waitForSelector('[data-testid="shortcuts-dialog"]')
    await first.page.locator('[data-testid="shortcut-add-split"]').click()
    await first.page.keyboard.press('KeyX')
    await first.page.locator('[data-testid="shortcut-remove-split-KeyS"]').click()
    await first.page.waitForTimeout(400)
    await first.app.close()

    const second = await launch()
    await second.page.locator('[data-testid="open-shortcuts"]').click()
    await second.page.waitForSelector('[data-testid="shortcuts-dialog"]')
    const combos = (await second.page.getAttribute('[data-testid="shortcut-split"]', 'data-combos')) ?? ''
    await second.app.close()

    expect(combos.split(' ').filter(Boolean)).toEqual(['KeyX'])
  }, 240_000)
})
