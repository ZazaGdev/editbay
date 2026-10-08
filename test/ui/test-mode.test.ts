import { describe, it, expect, afterEach } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CANCEL, DONT_SAVE, answerUnsavedPrompt, promptsAsked } from './dialogs'

/**
 * Task 18: a run of the tests never leaves a question on the screen for
 * somebody to click, while a person closing the app with unsaved changes is
 * still asked whether to save them. The switch is set for every suite by
 * `vitest.config.ts`; the second case takes it away to stand in for a person.
 */

let app: ElectronApplication | null = null
const dirs: string[] = []

async function launch(underTest: boolean): Promise<Page> {
  const dir = await mkdtemp(join(tmpdir(), 'editbay-test-mode-'))
  dirs.push(dir)
  app = await electron.launch({
    args: ['.', `--user-data-dir=${join(dir, 'user-data')}`],
    cwd: process.cwd(),
    // The window stays off the screen either way; only the dialogs differ.
    env: { ...process.env, EDITBAY_UNDER_TEST: underTest ? '1' : '' } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForSelector('main')
  return page
}

/** An unsaved change: a black screen added at the playhead. */
async function changeSomething(page: Page): Promise<void> {
  await page.locator('[data-testid="add-black-screen"]').click()
  await page.waitForSelector('[data-testid="clip"]')
}

const quiet = (a: ElectronApplication): Promise<boolean> =>
  a.evaluate(({ dialog }) => (dialog.showMessageBox as unknown as Record<symbol, unknown>)[Symbol.for('editbay.quiet-dialog')] === true)

/** Closing, which must not wait on anybody: a question left on the screen would hang it. */
async function closeWithin(ms: number): Promise<void> {
  const closing = app!.close()
  const late = new Promise<'late'>((r) => setTimeout(() => r('late'), ms))
  expect(await Promise.race([closing.then(() => 'closed' as const), late])).toBe('closed')
  app = null
}

afterEach(async () => {
  await app?.close().catch(() => undefined)
  app = null
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('closing with unsaved changes', () => {
  it('under the tests, answers its own question and closes without waiting for a click', async () => {
    const page = await launch(true)
    expect(await quiet(app!)).toBe(true)
    await changeSomething(page)
    await closeWithin(20_000)
  })

  it('without the switch, as a person would have it, asks whether to save', async () => {
    const page = await launch(false)
    expect(await quiet(app!)).toBe(false)
    // The real question, with this test's answer in place of a click: Cancel
    // first, so the app is still there to say what it asked.
    await answerUnsavedPrompt(app!, CANCEL)
    await changeSomething(page)
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await expect.poll(() => promptsAsked(app!), { timeout: 20_000 }).toEqual([expect.stringContaining('Save changes to')])
    expect(await page.locator('main').count()).toBe(1)
    await answerUnsavedPrompt(app!, DONT_SAVE)
    await closeWithin(20_000)
    app = null
  })
})
