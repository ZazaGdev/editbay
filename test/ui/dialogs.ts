import type { ElectronApplication, Page } from 'playwright-core'

/** Open the Export dialog from the top bar, unless it is open already. */
export async function openExport(page: Page): Promise<void> {
  if ((await page.locator('[data-testid="export-panel"]').count()) > 0) return
  await page.locator('[data-testid="open-export"]').click()
  await page.waitForSelector('[data-testid="export-panel"]')
}

/**
 * Click the Export dialog's folder button, which the test has stubbed to
 * answer `dir`, and wait until the dialog shows it. Until then it shows the
 * default folder, which for a project never saved is the real Videos folder:
 * an export started in between would write there.
 */
export async function chooseExportFolder(page: Page, dir: string): Promise<void> {
  await page.locator('[data-testid="export-folder"]').click()
  await page.waitForFunction(
    (d) => document.querySelector('[data-testid="export-folder"]')?.getAttribute('title') === d,
    dir
  )
}

/**
 * Close the Export dialog if it is open. While it is, the editor takes no
 * keys, so a test that goes on to press any must close it first.
 */
export async function closeExport(page: Page): Promise<void> {
  if ((await page.locator('[data-testid="export-panel"]').count()) === 0) return
  await page.locator('[data-testid="export-panel-close"]').click()
  await page.waitForSelector('[data-testid="export-panel"]', { state: 'detached' })
}

/**
 * Native dialogs cannot be clicked, so the tests replace them in the main
 * process, handed the real `dialog` module. The preload API is frozen and
 * cannot be stubbed from the page, and this keeps the real IPC path.
 */

/** The buttons of the "save changes?" question, in order. */
export const SAVE = 0
export const DONT_SAVE = 1
export const CANCEL = 2

/**
 * Answer every "save changes?" question with `response` from now on, and
 * count how many times it is asked.
 */
export async function answerUnsavedPrompt(app: ElectronApplication, response: number): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    const g = globalThis as { editbayPrompts?: string[] }
    g.editbayPrompts = []
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.find((a): a is { message?: string } => typeof a === 'object' && a !== null && 'buttons' in a)
      g.editbayPrompts?.push(options?.message ?? '')
      return { response: answer, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, response)
}

/** The questions asked since the last `answerUnsavedPrompt`, by their message. */
export async function promptsAsked(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as { editbayPrompts?: string[] }).editbayPrompts ?? [])
}

/**
 * For suites that throw their work away on purpose: New and closing the app
 * ask about unsaved changes, and an unanswered native dialog hangs the run.
 */
export function discardUnsavedWork(app: ElectronApplication): Promise<void> {
  return answerUnsavedPrompt(app, DONT_SAVE)
}

/** Make the save dialog pick `path` without showing anything. */
export async function answerSaveDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog
  }, path)
}
