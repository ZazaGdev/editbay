import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { answerSaveDialog, discardUnsavedWork } from './dialogs'

/**
 * Plan 13, step 6: help. An empty window says what to do, and every action
 * can be found by typing a few letters of it.
 */

const fx = fixtureSet('ui-help')
const root = await mkdtemp(join(tmpdir(), 'editbay-help-'))
/** A stand-in for %APPDATA%, with OBS set up to record into `obsFolder`. */
const obsAppData = join(root, 'appdata')
const obsFolder = join(root, 'OBS')
let app: ElectronApplication
let page: Page
let cleanPath: string

beforeAll(async () => {
  cleanPath = await fx.cleanClip()
  await mkdir(join(obsAppData, 'obs-studio', 'basic', 'profiles', 'Main'), { recursive: true })
  await writeFile(join(obsAppData, 'obs-studio', 'user.ini'), '[Basic]\r\nProfileDir=Main\r\n')
  await writeFile(
    join(obsAppData, 'obs-studio', 'basic', 'profiles', 'Main', 'basic.ini'),
    `[SimpleOutput]\r\nFilePath=${obsFolder.replace(/\\/g, '\\\\')}\r\n`
  )
  await mkdir(obsFolder, { recursive: true })
  await copyFile(cleanPath, join(obsFolder, '2026-09-22 10-00-00.mkv'))
  app = await electron.launch({
    args: ['.', `--user-data-dir=${join(root, 'user-data')}`],
    cwd: process.cwd(),
    env: { ...process.env, EDITBAY_OBS_APPDATA: obsAppData }
  })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

async function newProject(): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Control+n')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"]').length === 0)
}

/** The picked file the stubbed file dialog hands back. */
async function pickReturns(path: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
  }, path)
}

async function withAClip(): Promise<void> {
  await newProject()
  await page.evaluate((p) => window.api.importFiles([p]), cleanPath)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]')
}

async function openPalette(): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Control+k')
  await page.waitForSelector('[data-testid="command-palette"]')
}

describe('an empty window', () => {
  it('draws the three things you do, each with its keys as they are set', async () => {
    await newProject()
    await page.waitForSelector('[data-testid="welcome"]')
    expect(await page.locator('[data-testid="welcome-step"]').count()).toBe(3)
    const names = await page.locator('[data-testid="welcome-step"] span').nth(1).textContent()
    expect(names).toBe('Bring it in')
    // The keys are drawn as keys, and read from the keymap rather than written in.
    const keys = await page.locator('[data-testid="welcome-steps"] kbd').allTextContents()
    expect(keys).toContain('S')
    expect(keys).toContain('I')
    expect(keys).toContain('O')
    expect(keys).toContain('Ctrl+E')
  })

  it('offers the tutorials, and opens them, which is the line a first-time user sees', async () => {
    await newProject()
    await page.waitForSelector('[data-testid="welcome"]')
    await page.locator('[data-testid="welcome-tutorials"]').click()
    await page.waitForSelector('[data-testid="tutorials"]')
    expect(await page.locator('[data-testid="tutorial-row"]').count()).toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="tutorials"]', { state: 'detached' })
  })

  it('offers the newest recording from OBS, and imports it with a click', async () => {
    await newProject()
    await page.waitForSelector('[data-testid="welcome-recording"]')
    expect(await page.textContent('[data-testid="welcome-recording"]')).toBe('Import 2026-09-22 10-00-00.mkv')
    await page.click('[data-testid="welcome-recording"]')
    await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
    expect(await page.getAttribute('[data-testid="asset"] div[title]', 'title')).toContain('2026-09-22 10-00-00.mkv')
  }, 180_000)

  it('can be scrolled to its top in the smallest window, with the text made larger', async () => {
    await newProject()
    await page.waitForSelector('[data-testid="welcome"]')
    const size = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      const [w, h] = win.getSize()
      win.setSize(1100, 680)
      win.webContents.setZoomFactor(1.75)
      return { w: w!, h: h! }
    })
    try {
      await page.waitForFunction(() => window.innerHeight < 420)
      // Taller than the monitor, so there is something to scroll.
      await page.waitForFunction(() => {
        const w = document.querySelector('[data-testid="welcome"]')!
        return w.scrollHeight > w.clientHeight
      })
      const welcome = (await page.locator('[data-testid="welcome"]').boundingBox())!
      await page.locator('[data-testid="welcome"]').evaluate((e) => (e.scrollTop = 0))
      const add = (await page.locator('[data-testid="welcome-add"]').boundingBox())!
      expect(add.y).toBeGreaterThanOrEqual(welcome.y)
    } finally {
      await app.evaluate(({ BrowserWindow }, s) => {
        const win = BrowserWindow.getAllWindows()[0]!
        win.webContents.setZoomFactor(1)
        win.setSize(s.w, s.h)
      }, size)
    }
  })

  it('adds files from its button, and makes way once there is a source', async () => {
    await newProject()
    await pickReturns(cleanPath)
    await page.click('[data-testid="welcome-add"]')
    await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
    await page.waitForSelector('[data-testid="welcome"]', { state: 'detached' })
    // Sources but nothing on the timeline: it says how to put one there.
    expect(await page.textContent('[data-testid="monitor-empty"]')).toBe(
      'Drag a source onto the timeline, or press Add to timeline.'
    )
  })

  // Bugs and notes 2, note 7.
  it('names the project from its own field, the same name as the top bar, kept as files land', async () => {
    await newProject()
    const field = page.locator('[data-testid="welcome-name"]')
    expect(await field.inputValue()).toBe('')
    expect(await field.getAttribute('placeholder')).toBe('Untitled')
    // Not focused when it opens: keys still go to the window.
    expect(await field.evaluate((e) => e === document.activeElement)).toBe(false)

    await field.fill('Holiday cut')
    await field.press('Enter')
    await expect.poll(() => page.textContent('[data-testid="project-name"]'), { timeout: 15_000 }).toContain('Holiday cut')

    // Escape leaves the name as it was.
    await field.fill('Something else')
    await field.press('Escape')
    expect(await field.inputValue()).toBe('Holiday cut')
    expect(await page.textContent('[data-testid="project-name"]')).toContain('Holiday cut')

    // Renamed in the top bar, the field follows.
    await page.click('[data-testid="project-name"]')
    await page.fill('[data-testid="project-rename"]', 'Road trip')
    await page.press('[data-testid="project-rename"]', 'Enter')
    await expect.poll(() => field.inputValue(), { timeout: 15_000 }).toBe('Road trip')

    // Typed, then Add files straight away: the name is kept.
    await field.fill('Road trip cut')
    await pickReturns(cleanPath)
    await page.click('[data-testid="welcome-add"]')
    await page.waitForSelector('[data-testid="welcome"]', { state: 'detached', timeout: 120_000 })
    await expect.poll(() => page.textContent('[data-testid="project-name"]'), { timeout: 15_000 }).toContain('Road trip cut')
  }, 180_000)

  it('lists the projects worked on lately, and opens one with a click', async () => {
    await withAClip()
    const saved = join(root, 'lately.editbay')
    await answerSaveDialog(app, saved)
    await page.keyboard.press('Control+Shift+s')
    for (let i = 0; i < 100 && !(await stat(saved).catch(() => null)); i++) await new Promise((r) => setTimeout(r, 100))
    await newProject()
    await page.waitForSelector('[data-testid="welcome-recent"]')
    expect(await page.textContent('[data-testid="welcome-recent"]')).toContain('lately')
    await page.click('[data-testid="welcome-recent"]')
    await page.waitForSelector('[data-testid="clip"]', { timeout: 30_000 })
  }, 240_000)
})

describe('searching every action', () => {
  it('opens on Ctrl+K, finds an action as you type, and runs it on Enter', async () => {
    await withAClip()
    // At a point inside the clip, so a split has something to cut.
    await page.keyboard.press('Shift+ArrowRight')
    await openPalette()
    await page.fill('[data-testid="command-search"]', 'split')
    expect(await page.getAttribute('[data-testid="command"]', 'data-command')).toBe('split')
    // With its key, so the key can be learned.
    expect(await page.locator('[data-testid="command"][data-command="split"] kbd').textContent()).toBe('S')
    await page.press('[data-testid="command-search"]', 'Enter')
    await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === 2)
  }, 180_000)

  it('chooses with the arrows, and closes on Escape without doing anything', async () => {
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
    await page.waitForSelector('[data-testid="clip"][data-selected="yes"]')
    await openPalette()
    await page.fill('[data-testid="command-search"]', 'safe zones')
    const first = await page.getAttribute('[data-testid="command"][aria-selected="true"]', 'data-command')
    await page.press('[data-testid="command-search"]', 'ArrowDown')
    expect(await page.getAttribute('[data-testid="command"][aria-selected="true"]', 'data-command')).not.toBe(first)
    // Tab stays in the search, rather than going to the buttons behind it.
    await page.press('[data-testid="command-search"]', 'Tab')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('command-search')
    await page.press('[data-testid="command-search"]', 'Escape')
    await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })
    // Escape closed the search and nothing else: the clip is still selected.
    expect(await page.locator('[data-testid="clip"][data-selected="yes"]').count()).toBeGreaterThan(0)
  })

  it('opens from the Search button too, and runs a command clicked with the mouse', async () => {
    await page.click('[data-testid="open-search"]')
    await page.waitForSelector('[data-testid="command-palette"]')
    await page.fill('[data-testid="command-search"]', 'keyboard shortcuts')
    await page.click('[data-testid="command"][data-command="showShortcuts"]')
    await page.waitForSelector('[data-testid="shortcuts-dialog"]')
    await page.click('[data-testid="shortcuts-close"]')
    await page.waitForSelector('[data-testid="shortcuts-dialog"]', { state: 'detached' })
  })

  it('opens Export with every sequence chosen', async () => {
    await withAClip()
    await page.click('[data-testid="sequence-add"]')
    await page.locator('[data-testid="sequence-add-shape"]').first().click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="sequence-tab"]').length === 2)
    await openPalette()
    await page.fill('[data-testid="command-search"]', 'export all')
    await page.press('[data-testid="command-search"]', 'Enter')
    await page.waitForSelector('[data-testid="export-panel"]')
    expect(await page.isChecked('[data-testid="export-all"]')).toBe(true)
    await page.click('[data-testid="export-panel-close"]')
    await page.waitForSelector('[data-testid="export-panel"]', { state: 'detached' })
  }, 180_000)

  it('finds the assets commands by "asset" (task 54)', async () => {
    await openPalette()
    await page.fill('[data-testid="command-search"]', 'asset')
    const found = await page.locator('[data-testid="command"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-command')))
    expect(found).toEqual(expect.arrayContaining(['chooseAssetsFolder', 'freePacks', 'saveAsAsset']))
    expect(await page.locator('[data-testid="command-none"]').count()).toBe(0)
    await page.fill('[data-testid="command-search"]', 'free assets')
    await page.press('[data-testid="command-search"]', 'Enter')
    await page.waitForSelector('[data-testid="free-packs"]')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="free-packs"]', { state: 'detached' })
  })

  it('also lists what has no key: safe zones for one app, a shape, a layout', async () => {
    await withAClip()
    await openPalette()
    await page.fill('[data-testid="command-search"]', 'safe tiktok')
    await page.press('[data-testid="command-search"]', 'Enter')
    await page.click('[data-testid="view-program"]')
    await page.waitForFunction(() => document.querySelector('[data-testid="guides"]')?.getAttribute('data-safe') === 'tiktok')

    await openPalette()
    await page.fill('[data-testid="command-search"]', 'shape square')
    await page.press('[data-testid="command-search"]', 'Enter')
    await page.waitForFunction(() => (document.querySelector('[data-testid="export-preset"]') as HTMLSelectElement).value === 'square')

    // A layout acts on the selected clip.
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
    await page.waitForSelector('[data-testid="picture-clip-panel"]')
    await openPalette()
    await page.fill('[data-testid="command-search"]', 'picture in picture')
    await page.press('[data-testid="command-search"]', 'Enter')
    await page.waitForFunction(() => document.querySelector('[data-testid="layout"]')?.getAttribute('data-layout') === 'pip')
  }, 180_000)

  it('shows what cannot be done just now, greyed, and does not run it', async () => {
    await withAClip()
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
    await page.waitForSelector('[data-testid="picture-clip-panel"]')
    // Nothing has been copied, so pasting is greyed; run anyway, it would say so in a notice.
    await openPalette()
    await page.fill('[data-testid="command-search"]', 'paste framing')
    expect(await page.getAttribute('[data-testid="command"][data-command="pasteFraming"]', 'aria-disabled')).toBe('true')
    await page.press('[data-testid="command-search"]', 'Enter')
    expect(await page.locator('[data-testid="command-palette"]').count()).toBe(1)
    expect(await page.locator('[data-testid="toast"][data-kind="framing"]').count()).toBe(0)
    await page.press('[data-testid="command-search"]', 'Escape')
    await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })
  }, 180_000)

  it('says so when nothing matches', async () => {
    await openPalette()
    await page.fill('[data-testid="command-search"]', 'zzzz')
    await page.waitForSelector('[data-testid="command-none"]')
    await page.press('[data-testid="command-search"]', 'Escape')
  })
})
