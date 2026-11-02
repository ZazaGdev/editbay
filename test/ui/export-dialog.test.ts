import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { copyFile, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath, ffprobePath } from '../../src/main/ffmpeg/locate'
import { closeExport, discardUnsavedWork, openExport } from './dialogs'

/**
 * Plan 13, step 2: the Export dialog. A folder from the start, the names it
 * will write, a question before writing over anything, every sequence at
 * once, what it wrote, and failures in plain words.
 */

const fx = fixtureSet('ui-export')
const root = await mkdtemp(join(tmpdir(), 'editbay-export-dialog-'))
let app: ElectronApplication
const WAIT = { timeout: 15_000 }
let page: Page
let cleanPath: string
let counter = 0
/** The folder the stubbed folder dialog hands back, for the test that is running. */
let picked = ''

interface Recorded {
  editbayOpened?: string[]
  editbayShown?: string[]
  editbayCopied?: string[]
  editbayNotified?: string[]
}

beforeAll(async () => {
  cleanPath = await fx.cleanClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  // Playing or showing a file, or copying text, would reach the desktop and
  // clipboard of whoever is at the machine: recorded instead.
  await app.evaluate(({ shell, clipboard }) => {
    const g = globalThis as Recorded
    g.editbayOpened = []
    g.editbayShown = []
    g.editbayCopied = []
    shell.openPath = async (path: string) => {
      g.editbayOpened?.push(path)
      return ''
    }
    shell.showItemInFolder = (path: string) => {
      g.editbayShown?.push(path)
    }
    clipboard.writeText = ((text: string) => {
      g.editbayCopied?.push(text)
    }) as typeof clipboard.writeText
  })
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

async function recorded(key: keyof Recorded): Promise<string[]> {
  return app.evaluate((_electron, k) => (globalThis as Recorded)[k] ?? [], key)
}

/** Wait until main has recorded something under `key`, and give back what it has. */
async function waitRecorded(key: keyof Recorded, count: number): Promise<string[]> {
  for (let i = 0; i < 100; i++) {
    const got = await recorded(key)
    if (got.length >= count) return got
    await new Promise((r) => setTimeout(r, 100))
  }
  return recorded(key)
}

async function sizeOf(file: string): Promise<string> {
  const out = await captureText(ffprobePath, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file
  ])
  return out.trim()
}

/** A new project holding the clean clip `copies` times, with the folder dialog answering a fresh folder. */
async function freshProject(copies = 1, source = cleanPath): Promise<string> {
  await closeExport(page)
  // A new project starts on the shape chosen last, and offers the framing used last: these tests start from Vertical, unframed.
  await page.evaluate(() => window.api.setAppSettings({ lastShape: 'vertical', lastFraming: null }))
  await page.keyboard.press('ControlOrMeta+n')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0)
  await page.evaluate((p) => window.api.importFiles([p]), source)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  for (let i = 0; i < copies; i++) {
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="clip"]').length === n, i + 1)
  }
  counter += 1
  picked = await mkdtemp(join(root, `out${counter}-`))
  await app.evaluate(async ({ dialog }, d) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] })
  }, picked)
  return picked
}

/**
 * Open the dialog and choose the folder the dialog stub answers. Waits until
 * the dialog shows that folder: before then it shows the default, which for a
 * project never saved is the real Videos folder, and nothing may go there.
 */
async function chooseFolder(): Promise<void> {
  await openExport(page)
  await page.locator('[data-testid="export-folder"]').click()
  await page.waitForFunction(
    (dir) => document.querySelector('[data-testid="export-folder"]')?.getAttribute('title') === dir,
    picked
  )
  await page.waitForSelector('[data-testid="export-will-write"]')
}

async function exportNow(): Promise<void> {
  await page.waitForFunction(() => !(document.querySelector('[data-testid="export-start"]') as HTMLButtonElement | null)?.disabled)
  await page.locator('[data-testid="export-start"]').click()
}

async function waitDone(): Promise<void> {
  await page.waitForSelector('[data-testid="export-done"]', { timeout: 180_000 })
}

async function addSequenceIn(shape: string): Promise<void> {
  // One sequence has no tab of its own.
  const tabs = Math.max(1, await page.locator('[data-testid="sequence-tab"]').count())
  await page.locator('[data-testid="sequence-duplicate"]').click()
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="sequence-tab"]').length === n, tabs + 1)
  await page.selectOption('[data-testid="export-preset"]', shape)
  await page.waitForFunction(
    (s) => (document.querySelector('[data-testid="export-preset"]') as HTMLSelectElement | null)?.value === s,
    shape
  )
}

describe('the Export dialog', () => {
  it('opens with Ctrl+E, with a folder to export to already filled in', async () => {
    await freshProject()
    await page.keyboard.press('ControlOrMeta+e')
    await page.waitForSelector('[data-testid="export-panel"]')
    // The default arrives from main a moment after the dialog opens.
    await page.waitForFunction(() => {
      const title = document.querySelector('[data-testid="export-folder"]')?.getAttribute('title')
      return !!title && title !== 'Choose a folder'
    })
    await page.waitForSelector('[data-testid="export-will-write"]')
    expect(await page.isDisabled('[data-testid="export-start"]')).toBe(false)
    await closeExport(page)
  })

  it('picks the folder to export into from Choose..., starting at the folder shown', async () => {
    await freshProject()
    await chooseFolder()
    const first = picked
    const second = await mkdtemp(join(root, 'chosen-'))
    await app.evaluate(async ({ dialog }, d) => {
      const g = globalThis as { pickedFrom?: string | undefined }
      dialog.showOpenDialog = async (...args: unknown[]) => {
        const options = args[args.length - 1] as { defaultPath?: string }
        g.pickedFrom = options.defaultPath
        return { canceled: false, filePaths: [d] }
      }
    }, second)
    await page.locator('[data-testid="export-folder-choose"]').click()
    await page.waitForFunction(
      (dir) => document.querySelector('[data-testid="export-folder"]')?.getAttribute('title') === dir,
      second
    )
    expect(await app.evaluate(() => (globalThis as { pickedFrom?: string }).pickedFrom)).toBe(first)
    expect(await page.isDisabled('[data-testid="export-folder-show"]')).toBe(false)
    await closeExport(page)
  })

  it('names the file it will write', async () => {
    await freshProject()
    await chooseFolder()
    expect(await page.textContent('[data-testid="export-will-write"]')).toContain('Untitled.mp4')
  })

  it('offers to sharpen the picture a little, off at first, and keeps the choice', async () => {
    await freshProject()
    await page.keyboard.press('ControlOrMeta+e')
    await page.waitForSelector('[data-testid="export-panel"]')
    const box = page.locator('[data-testid="export-sharpen"]')
    expect(await box.isChecked()).toBe(false)
    await page.locator('[data-testid="export-sharpen"]').click()
    await expect.poll(() => box.isChecked()).toBe(true)
    await closeExport(page)
    await page.keyboard.press('ControlOrMeta+e')
    await page.waitForSelector('[data-testid="export-panel"]')
    expect(await page.locator('[data-testid="export-sharpen"]').isChecked()).toBe(true)
    // Off again, so nothing after this is sharpened.
    await page.locator('[data-testid="export-sharpen"]').click()
    await expect.poll(() => page.locator('[data-testid="export-sharpen"]').isChecked()).toBe(false)
    await closeExport(page)
  })

  // Fast is NVIDIA's encoder, which no Mac has (task 1388); the test below covers it switched off.
  it.skipIf(process.platform === 'darwin')('offers a Fast export on the graphics card, Best quality at first, and keeps the choice', async () => {
    await freshProject()
    await page.keyboard.press('ControlOrMeta+e')
    await page.waitForSelector('[data-testid="export-panel"]')
    const best = page.locator('[data-testid="export-speed-best"]')
    const fast = page.locator('[data-testid="export-speed-fast"]')
    expect(await best.getAttribute('aria-pressed')).toBe('true')
    // This machine has the card: Fast can be chosen once it has been tried.
    await expect.poll(() => fast.isDisabled(), WAIT).toBe(false)
    await fast.click()
    await expect.poll(() => fast.getAttribute('aria-pressed')).toBe('true')
    // Said on hover, with no note under it (task 60).
    expect(await page.locator('[data-testid="export-fast-note"]').count()).toBe(0)
    // Only as wide as its two choices, not the window.
    const toggle = await page.locator('[data-testid="export-speed"]').boundingBox()
    const choices = [(await best.boundingBox())!, (await fast.boundingBox())!]
    const panel = await page.locator('[data-testid="export-panel"]').boundingBox()
    expect(toggle!.width).toBeLessThan(choices[0]!.width + choices[1]!.width + 16)
    expect(toggle!.width).toBeLessThan(panel!.width / 2)
    await closeExport(page)
    await page.keyboard.press('ControlOrMeta+e')
    await page.waitForSelector('[data-testid="export-panel"]')
    await expect.poll(() => page.locator('[data-testid="export-speed-fast"]').getAttribute('aria-pressed'), WAIT).toBe('true')
    await page.locator('[data-testid="export-speed-best"]').click()
    await closeExport(page)
  })

  it('shows Fast switched off, saying why, where no graphics card can encode', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('export:gpu')
      ipcMain.handle('export:gpu', () => false)
    })
    await page.keyboard.press('ControlOrMeta+e')
    await page.waitForSelector('[data-testid="export-panel"]')
    const fast = page.locator('[data-testid="export-speed-fast"]')
    await expect.poll(() => fast.getAttribute('title'), WAIT).toContain('NVIDIA')
    expect(await fast.isDisabled()).toBe(true)
    expect(await page.locator('[data-testid="export-speed-best"]').getAttribute('aria-pressed')).toBe('true')
    await closeExport(page)
  })

  it('names the video as typed, keeps the name, and says what it does with letters a file name cannot have', async () => {
    const dir = await freshProject()
    await chooseFolder()
    const box = page.locator('[data-testid="export-file-name"]')
    // It starts with the name it would be given.
    expect(await box.inputValue()).toBe('Untitled')
    await box.fill('final cut v2')
    await expect.poll(() => page.textContent('[data-testid="export-will-write"]')).toContain('final cut v2.mp4')
    await box.fill('final: cut')
    await page.waitForSelector('[data-testid="export-file-name-note"]')
    await expect.poll(() => page.textContent('[data-testid="export-will-write"]')).toContain('final_ cut.mp4')
    await box.fill('final cut v2')
    await closeExport(page)
    // Kept for the sequence when the window is opened again, and written under it.
    await openExport(page)
    expect(await page.locator('[data-testid="export-file-name"]').inputValue()).toBe('final cut v2')
    await exportNow()
    await waitDone()
    expect(existsSync(join(dir, 'final cut v2.mp4'))).toBe(true)
    await closeExport(page)
  })

  it('asks before writing over a file, and does what each answer says', async () => {
    const dir = await freshProject()
    await chooseFolder()
    await exportNow()
    await waitDone()
    expect(await readdir(dir)).toEqual(['Untitled.mp4'])
    const first = (await stat(join(dir, 'Untitled.mp4'))).mtimeMs

    // Cancel: nothing written.
    await exportNow()
    await page.waitForSelector('[data-testid="export-exists"]')
    expect(await page.textContent('[data-testid="export-exists"]')).toContain('Untitled.mp4 is already in')
    await page.locator('[data-testid="export-ask-cancel"]').click()
    await page.waitForSelector('[data-testid="export-exists"]', { state: 'detached' })
    expect(await readdir(dir)).toEqual(['Untitled.mp4'])

    // Keep both: a second file beside the first, which is left alone.
    await exportNow()
    await page.locator('[data-testid="export-keep-both"]').click()
    await page.waitForSelector('[data-testid="export-file"]:has-text("Untitled (2).mp4")', { timeout: 180_000 })
    expect((await readdir(dir)).sort()).toEqual(['Untitled (2).mp4', 'Untitled.mp4'])
    expect((await stat(join(dir, 'Untitled.mp4'))).mtimeMs).toBe(first)

    // Replace: the first is written again, and nothing is added.
    await exportNow()
    await page.locator('[data-testid="export-replace"]').click()
    await page.waitForFunction(
      () => !(document.querySelector('[data-testid="export-start"]') as HTMLButtonElement | null)?.disabled,
      undefined,
      { timeout: 180_000 }
    )
    await waitDone()
    expect((await readdir(dir)).sort()).toEqual(['Untitled (2).mp4', 'Untitled.mp4'])
    expect((await stat(join(dir, 'Untitled.mp4'))).mtimeMs).toBeGreaterThan(first)
  }, 360_000)

  it('does what Settings says without asking, when it says something other than ask', async () => {
    const dir = await freshProject()
    await chooseFolder()
    await exportNow()
    await waitDone()
    await closeExport(page)

    await page.click('[data-testid="open-settings"]')
    await page.click('[data-testid="settings-tab"][data-tab="Export"]')
    await page.selectOption('[data-testid="setting-export-existing"]', 'keepBoth')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="settings"]', { state: 'detached' })

    await openExport(page)
    await exportNow()
    // No question: the new file goes beside the one that was there.
    await page.waitForSelector('[data-testid="export-file"]:has-text("Untitled (2).mp4")', { timeout: 180_000 })
    expect(await page.locator('[data-testid="export-exists"]').count()).toBe(0)
    expect((await readdir(dir)).sort()).toEqual(['Untitled (2).mp4', 'Untitled.mp4'])

    await closeExport(page)
    await page.click('[data-testid="open-settings"]')
    await page.click('[data-testid="settings-tab"][data-tab="Export"]')
    await page.selectOption('[data-testid="setting-export-existing"]', 'ask')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="settings"]', { state: 'detached' })
  }, 360_000)

  it('shows the file in its folder when it finishes, when Settings asks for that', async () => {
    const dir = await freshProject()
    await page.click('[data-testid="open-settings"]')
    await page.click('[data-testid="settings-tab"][data-tab="Export"]')
    await page.locator('[data-testid="setting-show-after-export"]').check()
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="settings"]', { state: 'detached' })

    const before = (await recorded('editbayShown')).length
    await chooseFolder()
    await exportNow()
    await waitDone()
    const shown = await waitRecorded('editbayShown', before + 1)
    expect(shown[shown.length - 1]).toBe(join(dir, 'Untitled.mp4'))

    await closeExport(page)
    await page.click('[data-testid="open-settings"]')
    await page.click('[data-testid="settings-tab"][data-tab="Export"]')
    await page.locator('[data-testid="setting-show-after-export"]').uncheck()
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="settings"]', { state: 'detached' })
  }, 240_000)

  it('offers the folder chosen in Settings to a project that has not chosen one', async () => {
    const dir = await freshProject()
    // The folder dialog answers `dir`, so that is the folder Settings keeps.
    await page.click('[data-testid="open-settings"]')
    await page.click('[data-testid="settings-tab"][data-tab="Export"]')
    await page.click('[data-testid="setting-export-choose"]')
    await page.waitForSelector(`[data-testid="setting-export-folder"]:has-text("${dir.split(/[\\/]/).pop()}")`)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="settings"]', { state: 'detached' })

    await openExport(page)
    await page.waitForFunction((d) => document.querySelector('[data-testid="export-folder"]')?.getAttribute('title') === d, dir)
    await closeExport(page)

    await page.click('[data-testid="open-settings"]')
    await page.click('[data-testid="settings-tab"][data-tab="Export"]')
    await page.click('[data-testid="setting-export-beside"]')
    await page.waitForSelector('[data-testid="setting-export-folder"]:has-text("Beside the project file")')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="settings"]', { state: 'detached' })
  }, 240_000)

  it('starts a project that has never exported the way Settings says', async () => {
    await freshProject(2)
    await page.click('[data-testid="open-settings"]')
    await page.click('[data-testid="settings-tab"][data-tab="Export"]')
    await page.selectOption('[data-testid="setting-export-mode"]', 'batch')
    await page.fill('[data-testid="setting-export-pattern"]', '{clip}_{index}')
    await page.press('[data-testid="setting-export-pattern"]', 'Enter')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="settings"]', { state: 'detached' })

    try {
      await openExport(page)
      expect(await page.inputValue('[data-testid="export-mode"]')).toBe('batch')
      expect(await page.inputValue('[data-testid="export-pattern"]')).toBe('{clip}_{index}')
      // Changed in the window, and it stays changed: Settings is only where it starts.
      await page.selectOption('[data-testid="export-mode"]', 'join')
      await closeExport(page)
      await openExport(page)
      expect(await page.inputValue('[data-testid="export-mode"]')).toBe('join')
    } finally {
      // Settings put back even on a miss, or every export after it writes one file a clip.
      await closeExport(page)
      await page.click('[data-testid="open-settings"]')
      await page.click('[data-testid="settings-tab"][data-tab="Export"]')
      await page.selectOption('[data-testid="setting-export-mode"]', 'join')
      await page.fill('[data-testid="setting-export-pattern"]', '')
      await page.press('[data-testid="setting-export-pattern"]', 'Enter')
      await page.keyboard.press('Escape')
      await page.waitForSelector('[data-testid="settings"]', { state: 'detached' })
    }
  }, 240_000)

  it('drops its question when the folder changes, so it never answers for files it did not check', async () => {
    const dir = await freshProject()
    await chooseFolder()
    await exportNow()
    await waitDone()
    await exportNow()
    await page.waitForSelector('[data-testid="export-exists"]')
    // Another folder, where nothing has been asked.
    picked = await mkdtemp(join(root, 'elsewhere-'))
    await app.evaluate(async ({ dialog }, d) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] })
    }, picked)
    await page.locator('[data-testid="export-folder"]').click()
    await page.waitForSelector('[data-testid="export-exists"]', { state: 'detached' })
    expect(await readdir(dir)).toEqual(['Untitled.mp4'])
  }, 240_000)

  it('exports every sequence at once, each in its own shape and named after it', async () => {
    const dir = await freshProject()
    await addSequenceIn('landscape')
    await chooseFolder()
    await page.locator('[data-testid="export-all"]').check()
    await page.waitForFunction(() => document.querySelector('[data-testid="export-will-write"]')?.getAttribute('data-count') === '2')
    await exportNow()
    await waitDone()
    expect(await page.getAttribute('[data-testid="export-done"]', 'data-count')).toBe('2')
    expect((await readdir(dir)).sort()).toEqual(['Untitled Landscape.mp4', 'Untitled Vertical.mp4'])
    expect(await sizeOf(join(dir, 'Untitled Vertical.mp4'))).toBe('1080,1920')
    expect(await sizeOf(join(dir, 'Untitled Landscape.mp4'))).toBe('1920,1080')
  }, 360_000)

  it('exports every sequence its own way when the one on screen is Handoff', async () => {
    const dir = await freshProject()
    await addSequenceIn('handoff')
    await chooseFolder()
    await page.locator('[data-testid="export-all"]').check()
    await page.waitForFunction(() => document.querySelector('[data-testid="export-will-write"]')?.getAttribute('data-count') === '2')
    await exportNow()
    await waitDone()
    const files = (await readdir(dir)).sort()
    // The vertical one is still one video; the Handoff one is a file for its clip.
    expect(files).toContain('Untitled Vertical.mp4')
    expect(files.filter((f) => f.startsWith('Untitled Handoff'))).toHaveLength(1)
    expect(files).toHaveLength(2)
  }, 360_000)

  it('lists what it wrote, and plays or shows a file from there', async () => {
    const dir = await freshProject()
    await chooseFolder()
    await exportNow()
    await waitDone()
    expect(await page.textContent('[data-testid="export-file"]')).toContain('Untitled.mp4')
    const opened = (await recorded('editbayOpened')).length
    await page.locator('[data-testid="export-play"]').click()
    expect((await waitRecorded('editbayOpened', opened + 1)).at(-1)?.toLowerCase()).toBe(join(dir, 'Untitled.mp4').toLowerCase())
    const shown = (await recorded('editbayShown')).length
    await page.locator('[data-testid="export-reveal"]').click()
    expect((await waitRecorded('editbayShown', shown + 1)).at(-1)?.toLowerCase()).toBe(join(dir, 'Untitled.mp4').toLowerCase())
  }, 240_000)

  it('shows how far it has got and the time left while it runs, and a cancel in grey rather than red', async () => {
    // Long enough that the export is still going when there is enough done to
    // estimate from: a handful of short clips can be over in a few seconds.
    const long = join(root, 'long.mp4')
    await capture(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=90',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=90',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
      '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', long
    ])
    await freshProject(1, long)
    await chooseFolder()
    await exportNow()
    await page.waitForSelector('[data-testid="export-percent"]')
    await page.waitForSelector('[data-testid="export-remaining"]', { timeout: 60_000 })
    expect(await page.textContent('[data-testid="export-remaining"]')).toMatch(/^about .+ left$/)
    await page.locator('[data-testid="export-cancel"]').click()
    await page.waitForSelector('[data-testid="export-cancelled"]', { timeout: 60_000 })
    expect(await page.locator('[data-testid="export-error"]').count()).toBe(0)
  }, 240_000)

  it('says plainly what failed, with the details a click away', async () => {
    // A recording that goes missing after it was imported makes its clip fail.
    const doomed = join(root, 'doomed.mp4')
    await copyFile(cleanPath, doomed)
    await freshProject(1, doomed)
    await rm(doomed)
    await chooseFolder()
    await exportNow()
    await page.waitForSelector('[data-testid="export-error"]', { timeout: 120_000 })
    expect(await page.textContent('[data-testid="export-error"]')).toMatch(/Clip 1 \(doomed\) could not be exported\./)
    expect(await page.locator('[data-testid="export-details"]').count()).toBe(0)
    await page.locator('[data-testid="export-details-toggle"]').click()
    expect(await page.textContent('[data-testid="export-details"]')).toMatch(/doomed/)
    const copied = (await recorded('editbayCopied')).length
    await page.locator('[data-testid="export-copy"]').click()
    expect((await waitRecorded('editbayCopied', copied + 1)).at(-1)).toMatch(/doomed/)
  }, 240_000)
})

describe('an export that finishes with the dialog closed', () => {
  beforeEach(async () => {
    await app.evaluate(() => {
      ;(globalThis as Recorded).editbayNotified = []
    })
  })

  it('says so in the window, and in Windows when the window is not in front', async () => {
    // Long enough to still be running once the window is out of the way.
    await freshProject(6)
    await chooseFolder()
    await exportNow()
    await closeExport(page)
    // Out of the way, as when you switch to another program while it runs.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize())
    let told: string[] = []
    for (let i = 0; i < 360 && told.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 500))
      told = await recorded('editbayNotified')
    }
    expect(told).toEqual(['Exported Untitled.mp4'])
    // Back from the taskbar without being handed the focus, which would take the
    // keyboard from whoever is at the machine (task 78). The toast does not
    // wait for the focus, only for the window to be drawn again.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.showInactive())
    await page.waitForSelector('[data-testid="toast"][data-kind="export"]', { timeout: 30_000 })
    expect(await page.textContent('[data-testid="toast"][data-kind="export"]')).toContain('Exported Untitled.mp4')

    // Its Show button opens the dialog on what was written.
    await page.locator('[data-testid="toast-action"]').click()
    await waitDone()
    await closeExport(page)
  }, 240_000)

  it('does not trouble Windows when the window is in front', async () => {
    // Whether a test window is really in front depends on what else is on the
    // screen while the tests run, so it is told it is.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      if (!w) return
      w.restore()
      w.isFocused = () => true
    })
    await freshProject()
    await chooseFolder()
    await exportNow()
    await closeExport(page)
    await page.waitForSelector('[data-testid="toast"][data-kind="export"]', { timeout: 180_000 })
    expect(await recorded('editbayNotified')).toEqual([])
  }, 240_000)
})

describe('exporting part of a sequence', () => {
  it('offers the marked range once there is one, and writes only its frames', async () => {
    const folder = await freshProject()
    await chooseFolder()
    expect(await page.locator('[data-testid="export-part-marked"]').isDisabled()).toBe(true)
    await closeExport(page)
    // In at frame 30, Out on frame 59, which marks up to 60: one second.
    // Each key with the editor listening, as the range tests press them.
    for (const key of ['Home', 'Shift+ArrowRight', 'Shift+KeyI', 'Shift+ArrowRight', 'ArrowLeft', 'Shift+KeyO']) {
      await page.locator('[data-testid="timecode"]').click()
      await page.keyboard.press(key)
    }
    await page.waitForSelector('[data-testid="marked-range"][data-from="30"][data-to="60"]')
    await openExport(page)
    await page.locator('[data-testid="export-part-marked"]').check()
    expect(await page.locator('label:has([data-testid="export-part-marked"])').textContent()).toContain('00:00:01:00')
    await exportNow()
    await waitDone()
    const [file] = (await readdir(folder)).filter((f) => f.endsWith('.mp4'))
    const frames = await captureText(ffprobePath, [
      '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', join(folder, file!)
    ])
    expect(Number(frames.trim())).toBe(30)
  })
})

describe('a cover image', () => {
  it('saves the frame at the playhead as an image in the export folder, the size of the frame, from its key with no window open', async () => {
    const folder = await freshProject()
    await chooseFolder()
    // The button is gone from the Export window: the key does it from anywhere.
    expect(await page.locator('[data-testid="export-save-frame"]').count()).toBe(0)
    await closeExport(page)
    await page.keyboard.press('ControlOrMeta+Alt+s')
    let png: string | undefined
    // Made by a one frame export, which takes a few seconds.
    for (let i = 0; i < 300 && !png; i++) {
      png = (await readdir(folder)).find((f) => f.endsWith('.png'))
      if (!png) await new Promise((r) => setTimeout(r, 200))
    }
    expect(png).toMatch(/ 00-00-00-00\.png$/)
    expect(await sizeOf(join(folder, png!))).toBe('1080,1920')
    await page.waitForSelector('[data-testid="toast"][data-kind="frame"]:has-text("Saved the frame")')
  })

  it('has a 3:4 guide for Instagram\'s grid among the guides', async () => {
    if ((await page.locator('[data-testid="guides-menu"]').count()) === 0) await page.click('[data-testid="guides-toggle"]')
    await page.locator('[data-testid="guides-cover"]').check()
    await page.keyboard.press('Escape')
    if ((await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')) === 'source') await page.click('[data-testid="view-program"]')
    const box = (await page.locator('[data-testid="cover-guide"]').boundingBox())!
    expect(box.height / box.width).toBeCloseTo(4 / 3, 1)
  })
})
