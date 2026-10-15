import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, readdir, readFile, unlink, copyFile, rename, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fixtureSet } from '../e2e/fixtures'
import {
  answerUnsavedPrompt,
  answerSaveDialog,
  chooseExportFolder,
  closeExport,
  openExport,
  promptsAsked,
  CANCEL,
  DONT_SAVE,
  SAVE
} from './dialogs'

/**
 * Carrying on where you left off, checked the only honest way: by closing the
 * app, sometimes badly, and opening it again.
 *
 * Every test launches its own app with its own settings folder, because
 * closing it is part of what is being tested.
 */

const fx = fixtureSet('resume')
const root = await mkdtemp(join(tmpdir(), 'editbay-resume-'))
let cleanPath: string
let silentPath: string
let counter = 0

beforeAll(async () => {
  cleanPath = await fx.cleanClip()
  silentPath = await fx.silentClip()
}, 180_000)

afterAll(async () => {
  // Chromium lets go of its files a moment after the process exits.
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** A folder of its own for one test: its app settings, its projects and its exports. */
async function workspaceDir(): Promise<{ userData: string; files: string }> {
  counter += 1
  const base = join(root, `t${counter}`)
  return { userData: join(base, 'user-data'), files: await mkdtemp(join(root, `files${counter}-`)) }
}

async function launch(
  userData: string,
  extraArgs: string[] = [],
  env: Record<string, string> = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, ...extraArgs],
    cwd: process.cwd(),
    env: { ...process.env, ...env } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForSelector('main')
  return { app, page }
}

/** Close the window the way its close button does, which is what asks about unsaved work. */
async function clickClose(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close()
  })
}

/** Close the window and wait for the app to be gone. */
async function closeAndWait(app: ElectronApplication): Promise<void> {
  const closed = app.waitForEvent('close', { timeout: 30_000 })
  await clickClose(app)
  await closed
}

async function importAndAdd(page: Page, paths: string[]): Promise<void> {
  await page.evaluate((p) => window.api.importFiles(p), paths)
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length >= count,
    paths.length,
    { timeout: 180_000 }
  )
  for (let i = 0; i < paths.length; i++) {
    await page.locator('[data-testid="add-to-timeline"]').nth(i).click()
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="clip"]').length === n, i + 1, {
      timeout: 10_000
    })
  }
}

async function waitForTitle(page: Page, title: string): Promise<void> {
  await page.waitForFunction((t) => document.title === t, title, { timeout: 15_000 })
}

async function playhead(page: Page): Promise<number> {
  return Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
}

async function waitForPlayhead(page: Page, frame: number): Promise<void> {
  await page.waitForFunction(
    (f) => document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead') === String(f),
    frame,
    { timeout: 10_000 }
  )
}

describe('closing with unsaved changes', () => {
  it('asks first: Cancel keeps the window open, and Don\'t save closes it', async () => {
    const { userData } = await workspaceDir()
    const { app, page } = await launch(userData)
    await importAndAdd(page, [cleanPath])
    await waitForTitle(page, 'Untitled • Editbay')

    await answerUnsavedPrompt(app, CANCEL)
    await clickClose(app)
    await expect.poll(() => promptsAsked(app), { timeout: 10_000 }).toHaveLength(1)
    // Give a close that was not properly held every chance to happen.
    await page.waitForTimeout(1000)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(await page.locator('[data-testid="clip"]').count()).toBe(1)

    await answerUnsavedPrompt(app, DONT_SAVE)
    await closeAndWait(app)
  }, 240_000)

  it('saves before closing when you choose Save, and the file holds the edit', async () => {
    const { userData, files } = await workspaceDir()
    const target = join(files, 'kept.editbay')
    const { app, page } = await launch(userData)
    await importAndAdd(page, [cleanPath])

    await answerUnsavedPrompt(app, SAVE)
    await answerSaveDialog(app, target)
    await closeAndWait(app)

    const saved = JSON.parse((await readFile(target)).toString()) as { name: string; sequences: { videoTracks: { clips: unknown[] }[] }[] }
    expect(saved.sequences[0]!.videoTracks[0]!.clips).toHaveLength(1)
    expect(saved.name).toBe('kept')
  }, 240_000)

  it('does not ask when nothing has changed', async () => {
    const { userData } = await workspaceDir()
    const { app } = await launch(userData)
    // Were it to ask, Cancel would keep the app open and this would time out.
    await answerUnsavedPrompt(app, CANCEL)
    await closeAndWait(app)
  }, 120_000)

  it('asks before New throws the changes away, and Cancel keeps them', async () => {
    const { userData } = await workspaceDir()
    const { app, page } = await launch(userData)
    await importAndAdd(page, [cleanPath])

    await answerUnsavedPrompt(app, CANCEL)
    await page.keyboard.press('Control+n')
    await expect.poll(() => promptsAsked(app), { timeout: 10_000 }).toHaveLength(1)
    await page.waitForTimeout(500)
    expect(await page.locator('[data-testid="clip"]').count()).toBe(1)

    await answerUnsavedPrompt(app, DONT_SAVE)
    await page.keyboard.press('Control+n')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0)
    await closeAndWait(app)
  }, 240_000)
})

describe('the project name', () => {
  it('follows the file, so a joined export is named after it', async () => {
    const { userData, files } = await workspaceDir()
    const exportDir = await mkdtemp(join(root, 'export-'))
    const { app, page } = await launch(userData)
    await importAndAdd(page, [cleanPath])

    await answerSaveDialog(app, join(files, 'holiday.editbay'))
    await page.keyboard.press('Control+s')
    await waitForTitle(page, 'holiday - Editbay')

    await app.evaluate(async ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, exportDir)
    await openExport(page)
    await chooseExportFolder(page, exportDir)
    await page.waitForFunction(() => !(document.querySelector('[data-testid="export-start"]') as HTMLButtonElement).disabled)
    await page.locator('[data-testid="export-start"]').click()
    await page.waitForSelector('[data-testid="export-done"]', { timeout: 180_000 })

    expect(await readdir(exportDir)).toEqual(['holiday.mp4'])
    await closeAndWait(app)
  }, 360_000)
})

describe('reopening a project', () => {
  it('puts back the cut, the playhead, the zoom, the view and the export settings', async () => {
    const { userData, files } = await workspaceDir()
    const target = join(files, 'demo.editbay')
    const first = await launch(userData)
    const page = first.page
    await importAndAdd(page, [cleanPath, silentPath])

    // Select the first clip, then set up a workspace unlike the default in every field.
    const box = await page.locator('[data-testid="clip"]').first().boundingBox()
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
    // Before the playhead leaves the clip: a crop setting brings it back into the selected clip.
    await page.locator('[data-testid="aspect-lock"]').click()
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('End')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Equal')
    await page.keyboard.press('Equal')
    await page.keyboard.press('KeyV')
    await first.app.evaluate(async ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, files)
    await openExport(page)
    await chooseExportFolder(page, files)
    await page.selectOption('[data-testid="export-mode"]', 'batch')
    await page.fill('[data-testid="export-pattern"]', '{clip}_cut')
    // Shortcuts belong to a text box while it has focus, and to nothing while a dialog is open.
    await page.locator('[data-testid="export-pattern"]').blur()
    await closeExport(page)

    const total = Number(await page.getAttribute('[data-testid="timecode"]', 'data-total'))
    const selectedId = await page.locator('[data-testid="clip"][data-selected="yes"]').getAttribute('data-clip-id')
    expect(await playhead(page)).toBe(total - 3)

    await answerSaveDialog(first.app, target)
    await page.keyboard.press('Control+s')
    await waitForTitle(page, 'demo - Editbay')

    // Moving after the save is not an edit: no question on close, and still
    // written back so reopening lands here rather than where it was saved.
    await page.keyboard.press('ArrowLeft')
    await waitForPlayhead(page, total - 4)
    await page.waitForTimeout(800)
    await closeAndWait(first.app)

    // Nothing to open by hand: the last project comes back on its own.
    const second = await launch(userData)
    await second.page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
    const p2 = second.page

    await waitForTitle(p2, 'demo - Editbay')
    expect(await playhead(p2)).toBe(total - 4)
    expect(await p2.getAttribute('[data-testid="zoom-out"]', 'data-zoom')).toBe('7')
    expect(await p2.getAttribute('[data-testid="monitor-stage"]', 'data-view')).toBe('program')
    expect(await p2.isChecked('[data-testid="aspect-lock"]')).toBe(false)
    expect(await p2.locator('[data-testid="clip"][data-selected="yes"]').getAttribute('data-clip-id')).toBe(selectedId)
    await openExport(p2)
    expect(await p2.getAttribute('[data-testid="export-folder"]', 'title')).toBe(files)
    expect(await p2.inputValue('[data-testid="export-mode"]')).toBe('batch')
    expect(await p2.inputValue('[data-testid="export-pattern"]')).toBe('{clip}_cut')

    await closeAndWait(second.app)
    expect(existsSync(target)).toBe(true)
  }, 360_000)
})

/** Recovery copies on disk for one app's settings folder. */
async function recoveryCopies(userData: string): Promise<string[]> {
  try {
    return (await readdir(join(userData, 'recovery'))).filter((n) => n.endsWith('.editbay-recovery'))
  } catch {
    return []
  }
}

/**
 * Kill the app outright, as a crash or a power cut would: nothing gets to tidy
 * up. The whole process tree goes, because killing only the main process
 * leaves Chromium's helpers holding the app open.
 */
async function crash(app: ElectronApplication): Promise<void> {
  const proc = app.process()
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()))
  await new Promise<void>((resolve) => {
    execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => resolve())
  })
  await exited
  await app.close().catch(() => undefined)
}

/** Autosave every half second rather than every minute, so a crash can follow quickly. */
const FAST_AUTOSAVE = { EDITBAY_AUTOSAVE_MS: '500' }

// Crashed with Windows' taskkill.
describe.runIf(process.platform === 'win32')('after a crash', () => {
  it('offers the last autosave of a saved project, and Restore brings the edit back', async () => {
    const { userData, files } = await workspaceDir()
    const target = join(files, 'demo.editbay')
    const first = await launch(userData, [], FAST_AUTOSAVE)
    await importAndAdd(first.page, [cleanPath])
    await answerSaveDialog(first.app, target)
    await first.page.keyboard.press('Control+s')
    await waitForTitle(first.page, 'demo - Editbay')

    // An edit that is never saved, then the app dies once a copy holds it.
    await first.page.locator('[data-testid="add-to-timeline"]').first().click()
    await first.page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
    await expect.poll(() => recoveryCopies(userData), { timeout: 15_000 }).toHaveLength(1)
    await crash(first.app)

    const second = await launch(userData)
    const page = second.page
    await page.waitForSelector('[data-testid="recovery-offer"]', { timeout: 15_000 })
    expect(await page.textContent('[data-testid="recovery-offer"]')).toContain('demo')
    // Meanwhile the saved version is showing, with its one clip.
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 1)

    await page.click('[data-testid="recovery-restore"]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
    // Restored work is not what the file holds, so it still has to be saved.
    await waitForTitle(page, 'demo • Editbay')
    expect(await page.locator('[data-testid="recovery-offer"]').count()).toBe(0)

    await page.keyboard.press('Control+s')
    await waitForTitle(page, 'demo - Editbay')
    await expect.poll(() => recoveryCopies(userData), { timeout: 10_000 }).toHaveLength(0)
    await closeAndWait(second.app)
  }, 360_000)

  it('offers a project that was never saved, and Discard throws the copy away for good', async () => {
    const { userData } = await workspaceDir()
    const first = await launch(userData, [], FAST_AUTOSAVE)
    await importAndAdd(first.page, [cleanPath])
    await expect.poll(() => recoveryCopies(userData), { timeout: 15_000 }).toHaveLength(1)
    await crash(first.app)

    const second = await launch(userData)
    await second.page.waitForSelector('[data-testid="recovery-offer"]', { timeout: 15_000 })
    expect(await second.page.locator('[data-testid="clip"]').count()).toBe(0)
    await second.page.click('[data-testid="recovery-discard"]')
    await expect.poll(() => recoveryCopies(userData), { timeout: 10_000 }).toHaveLength(0)
    await closeAndWait(second.app)

    const third = await launch(userData)
    await third.page.waitForTimeout(1500)
    expect(await third.page.locator('[data-testid="recovery-offer"]').count()).toBe(0)
    await closeAndWait(third.app)
  }, 360_000)

  it('keeps offering the copy when you close without answering', async () => {
    const { userData, files } = await workspaceDir()
    const first = await launch(userData, [], FAST_AUTOSAVE)
    await importAndAdd(first.page, [cleanPath])
    await saveAs(first.app, first.page, join(files, 'unanswered.editbay'))
    await first.page.locator('[data-testid="add-to-timeline"]').first().click()
    await first.page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
    await expect.poll(() => recoveryCopies(userData), { timeout: 15_000 }).toHaveLength(1)
    await crash(first.app)

    // Look around the saved version without answering, then close. Closing
    // writes where you were into the project file, which makes it newer than
    // the copy: the copy must survive that.
    const second = await launch(userData)
    await second.page.waitForSelector('[data-testid="recovery-offer"]', { timeout: 15_000 })
    await second.page.keyboard.press('End')
    await second.page.waitForTimeout(800)
    await closeAndWait(second.app)

    const third = await launch(userData)
    await third.page.waitForSelector('[data-testid="recovery-offer"]', { timeout: 15_000 })
    await third.page.click('[data-testid="recovery-restore"]')
    await third.page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
    await answerUnsavedPrompt(third.app, DONT_SAVE)
    await closeAndWait(third.app)
  }, 360_000)

  it('leaves nothing to recover after a clean close', async () => {
    const { userData } = await workspaceDir()
    const { app, page } = await launch(userData, [], FAST_AUTOSAVE)
    await importAndAdd(page, [cleanPath])
    await expect.poll(() => recoveryCopies(userData), { timeout: 15_000 }).toHaveLength(1)
    await answerUnsavedPrompt(app, DONT_SAVE)
    await closeAndWait(app)
    expect(await recoveryCopies(userData)).toEqual([])
  }, 240_000)
})

/** Save the open project to `target` through Ctrl+S, answering the save dialog. */
async function saveAs(app: ElectronApplication, page: Page, target: string): Promise<void> {
  await answerSaveDialog(app, target)
  await page.keyboard.press('Control+Shift+s')
  const name = target.split(/[\\/]/).pop()!.replace(/\.editbay$/, '')
  await waitForTitle(page, `${name} - Editbay`)
}

describe('getting back to a project', () => {
  it('opens a project the app was started with', async () => {
    const { userData, files } = await workspaceDir()
    const target = join(files, 'started.editbay')
    const first = await launch(userData)
    await importAndAdd(first.page, [cleanPath, silentPath])
    await saveAs(first.app, first.page, target)
    // Start a new project, so that reopening the last one would show nothing.
    await first.page.keyboard.press('Control+n')
    await first.page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0)
    await closeAndWait(first.app)

    const second = await launch(userData, [target])
    await second.page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
    await waitForTitle(second.page, 'started - Editbay')
    await closeAndWait(second.app)
  }, 360_000)

  it('starts empty when the last project was a new one', async () => {
    const { userData, files } = await workspaceDir()
    const first = await launch(userData)
    await importAndAdd(first.page, [cleanPath])
    await saveAs(first.app, first.page, join(files, 'old.editbay'))
    await first.page.keyboard.press('Control+n')
    await waitForTitle(first.page, 'Untitled - Editbay')
    await closeAndWait(first.app)

    const second = await launch(userData)
    await second.page.waitForTimeout(1500)
    expect(await second.page.locator('[data-testid="clip"]').count()).toBe(0)
    await waitForTitle(second.page, 'Untitled - Editbay')
    await closeAndWait(second.app)
  }, 360_000)

  it('starts empty, and says why, when the last project has gone', async () => {
    const { userData, files } = await workspaceDir()
    const target = join(files, 'vanished.editbay')
    const first = await launch(userData)
    await importAndAdd(first.page, [cleanPath])
    await saveAs(first.app, first.page, target)
    await closeAndWait(first.app)
    await unlink(target)

    const second = await launch(userData)
    await second.page.waitForSelector('[data-testid="toast"][data-kind="notice"]', { timeout: 15_000 })
    expect(await second.page.textContent('[data-testid="toast"][data-kind="notice"]')).toContain('vanished.editbay')
    expect(await second.page.locator('[data-testid="clip"]').count()).toBe(0)
    await closeAndWait(second.app)
  }, 360_000)

  it('lists recent projects newest first, opens one with a click, and drops one that has gone', async () => {
    const { userData, files } = await workspaceDir()
    const { app, page } = await launch(userData)
    await importAndAdd(page, [cleanPath])
    await saveAs(app, page, join(files, 'one.editbay'))
    await page.keyboard.press('Control+n')
    await importAndAdd(page, [cleanPath, silentPath])
    await saveAs(app, page, join(files, 'two.editbay'))
    await page.keyboard.press('Control+n')
    await importAndAdd(page, [silentPath])
    await saveAs(app, page, join(files, 'three.editbay'))
    await unlink(join(files, 'three.editbay'))

    await page.click('[data-testid="recent-toggle"]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="recent-item"]').length === 3)
    const listed = await page
      .locator('[data-testid="recent-item"]')
      .evaluateAll((els) => els.map((e) => `${e.getAttribute('data-path')?.split(/[\\/]/).pop()}:${e.getAttribute('data-exists')}`))
    expect(listed).toEqual(['three.editbay:no', 'two.editbay:yes', 'one.editbay:yes'])

    // The one that has gone comes off the list when clicked.
    await page.locator('[data-testid="recent-item"][data-exists="no"]').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="recent-item"]').length === 2)

    // Opening one from the list, when the open project has no unsaved changes.
    await page.locator('[data-testid="recent-item"]').nth(1).click()
    await waitForTitle(page, 'one - Editbay')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 1)

    await closeAndWait(app)
  }, 360_000)

  it("keeps work given up with Don't save, and opens it again from the Recent menu (plan 84)", async () => {
    const { userData } = await workspaceDir()
    const { app, page } = await launch(userData)
    await importAndAdd(page, [cleanPath])
    await answerUnsavedPrompt(app, DONT_SAVE)
    await page.keyboard.press('Control+n')
    await waitForTitle(page, 'Untitled - Editbay')
    expect(await promptsAsked(app)).toEqual(['Save changes to Untitled?'])
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0)

    // From Search every action, which opens the Recent menu at them.
    await page.keyboard.press('Control+k')
    await page.keyboard.type('earlier versions')
    await page.keyboard.press('Enter')
    await page.waitForSelector('[data-testid="earlier-versions"]')
    expect(await page.locator('[data-testid="earlier-versions"]').textContent()).toBe('Work never saved')
    await page.locator('[data-testid="earlier-version"][data-reason="not-saved"]').first().click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 1)
    await closeAndWait(app)
  }, 360_000)

  it('draws the window again when its process dies, and does not open that project by itself next time (audit 2026-10-01)', async () => {
    const { userData, files } = await workspaceDir()
    const first = await launch(userData)
    await importAndAdd(first.page, [cleanPath])
    await saveAs(first.app, first.page, join(files, 'crashy.editbay'))
    // The window's process killed, as a crash in it would. The page Playwright
    // holds dies with it, so the window is watched from the app's side.
    first.page.on('crash', () => undefined)
    // Playwright rejects what it had waiting on the dead page: expected here, and only here.
    const expected = (err: unknown): void => {
      if (!(err instanceof Error && /Target crashed/.test(err.message))) throw err
    }
    process.on('unhandledRejection', expected)
    // The kill lands a moment after it is asked for, and until then the window
    // still has the title the test waits for. So the process going is waited
    // for first; this listener comes after the app's own, so by then the app
    // has dealt with it.
    await first.app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0]!.webContents
      const g = globalThis as { editbayGone?: boolean }
      g.editbayGone = false
      wc.once('render-process-gone', () => {
        g.editbayGone = true
      })
      wc.forcefullyCrashRenderer()
    })
    await expect
      .poll(() => first.app.evaluate(() => (globalThis as { editbayGone?: boolean }).editbayGone), { timeout: 30_000 })
      .toBe(true)
    // Drawn again, on the project still open.
    await expect
      .poll(
        () => first.app.evaluate(({ BrowserWindow }) => {
          const wc = BrowserWindow.getAllWindows()[0]!.webContents
          return wc.isCrashed() ? 'crashed' : wc.getTitle()
        }),
        { timeout: 30_000 }
      )
      .toBe('crashy - Editbay')
    await answerUnsavedPrompt(first.app, DONT_SAVE)
    await closeAndWait(first.app)
    process.off('unhandledRejection', expected)

    const second = await launch(userData)
    await waitForTitle(second.page, 'Untitled - Editbay')
    await closeAndWait(second.app)
  }, 360_000)

  it('hands a second launch over to the app already running', async () => {
    const { userData, files } = await workspaceDir()
    const other = join(files, 'other.editbay')
    const { app, page } = await launch(userData)
    await importAndAdd(page, [cleanPath, silentPath])
    await saveAs(app, page, other)
    await page.keyboard.press('Control+n')
    await waitForTitle(page, 'Untitled - Editbay')

    // What double-clicking a project does while the app is open: Windows
    // starts the program again with the file.
    const electronPath = createRequire(import.meta.url)('electron') as string
    const second = spawn(electronPath, ['.', `--user-data-dir=${userData}`, other], { cwd: process.cwd() })
    const code = await new Promise<number | null>((resolve) => second.once('exit', resolve))
    expect(code).toBe(0)

    await waitForTitle(page, 'other - Editbay')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await closeAndWait(app)
  }, 360_000)
})

describe('reopening without the cache', () => {
  it('rebuilds a waveform and filmstrip the cache lost, and the timeline fills in', async () => {
    const { userData, files } = await workspaceDir()
    const first = await launch(userData)
    await importAndAdd(first.page, [cleanPath])
    await saveAs(first.app, first.page, join(files, 'cache.editbay'))
    // The waveform is drawn on the clip's sound, on A1.
    await first.page.waitForFunction(() => document.querySelector('[data-testid="sound-clip"]')?.getAttribute('data-peaks') === 'yes')
    await closeAndWait(first.app)

    // Clear the derived files, as clearing the app's cache would.
    const cache = join(userData, 'media-cache')
    for (const key of await readdir(cache)) {
      for (const name of ['peaks.bin', 'filmstrip.jpg']) await rm(join(cache, key, name), { force: true })
    }

    const second = await launch(userData)
    await second.page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 1)
    await second.page.waitForFunction(
      () => {
        const clip = document.querySelector('[data-testid="clip"]')
        const sound = document.querySelector('[data-testid="sound-clip"]')
        return clip?.getAttribute('data-rebuilding') === 'no' && sound?.getAttribute('data-peaks') === 'yes'
      },
      undefined,
      { timeout: 60_000 }
    )
    expect(await second.page.locator('[data-testid="missing-media"]').count()).toBe(0)
    await waitForTitle(second.page, 'cache - Editbay')
    await closeAndWait(second.app)
  }, 360_000)

  it('relinks a moved file from the panel, and finds its neighbour in the same folder', async () => {
    const { userData, files } = await workspaceDir()
    const footage = join(files, 'footage')
    await mkdir(footage)
    await copyFile(cleanPath, join(footage, 'one.mp4'))
    await copyFile(silentPath, join(footage, 'two.mp4'))
    // The project lives somewhere else, so moving the footage loses both.
    const projects = join(files, 'projects')
    await mkdir(projects)

    const first = await launch(userData)
    await importAndAdd(first.page, [join(footage, 'one.mp4'), join(footage, 'two.mp4')])
    await saveAs(first.app, first.page, join(projects, 'moved.editbay'))
    await closeAndWait(first.app)

    const moved = join(files, 'footage-moved')
    await rename(footage, moved)

    const second = await launch(userData)
    const page = second.page
    await page.waitForSelector('[data-testid="missing-media"]', { timeout: 15_000 })
    expect(await page.locator('[data-testid="clip"][data-offline="yes"]').count()).toBe(2)

    await second.app.evaluate(async ({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, join(moved, 'one.mp4'))
    await page.locator('[data-testid="relink"]').first().click()

    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-offline="no"]').length === 2, undefined, {
      timeout: 60_000
    })
    expect(await page.locator('[data-testid="missing-media"]').count()).toBe(0)
    await page.waitForSelector('[data-testid="toast"][data-kind="notice"]')
    expect(await page.textContent('[data-testid="toast"][data-kind="notice"]')).toContain('Found 1 more missing file')

    // The project now points somewhere else, which is a change to save.
    await waitForTitle(page, 'moved \u2022 Editbay')
    await answerUnsavedPrompt(second.app, DONT_SAVE)
    await closeAndWait(second.app)
  }, 360_000)
})
