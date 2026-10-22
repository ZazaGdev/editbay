import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { answerSaveDialog, chooseExportFolder, closeExport, discardUnsavedWork, openExport } from './dialogs'

/**
 * Plan 13, step 1: the window. It fits the screen, has a top bar, tells you
 * when something happened, and keeps keys where they belong.
 */

const fx = fixtureSet('ui-window')
const root = await mkdtemp(join(tmpdir(), 'editbay-window-'))
let app: ElectronApplication
let page: Page
let userData: string
let cleanPath: string
/** How soon a changed project is saved on its own, in this suite. */
const SAVE_SOON_MS = 1500

async function launch(): Promise<void> {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: process.cwd(),
    env: { ...process.env, EDITBAY_SAVE_AUTOMATICALLY_MS: String(SAVE_SOON_MS) } as Record<string, string>
  })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}

beforeAll(async () => {
  cleanPath = await fx.cleanClip()
  userData = join(root, 'user-data')
  await launch()
  await page.evaluate((p) => window.api.importFiles([p]), cleanPath)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').click()
  await page.waitForSelector('[data-testid="clip"]')
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

async function resize(width: number, height: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const w = BrowserWindow.getAllWindows()[0]
      w?.unmaximize()
      w?.setContentSize(size.width, size.height)
    },
    { width, height }
  )
  await page.waitForFunction((w) => Math.abs(window.innerWidth - w) <= 2, width, { timeout: 5000 })
}

async function selectClip(): Promise<void> {
  const box = await page.locator('[data-testid="clip"]').first().boundingBox()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.waitForSelector('[data-testid="clip"][data-selected="yes"]')
}

async function playhead(): Promise<number> {
  return Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
}

describe('the window', () => {
  it('fits the screen at its smallest and at full size, with no page scrollbar', async () => {
    const minimum = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getMinimumSize())
    expect(minimum).toEqual([1100, 680])

    for (const [w, h] of [
      [1100, 640],
      [1920, 1040]
    ] as const) {
      await resize(w, h)
      const overflow = await page.evaluate(() => ({
        x: document.documentElement.scrollWidth - window.innerWidth,
        y: document.documentElement.scrollHeight - window.innerHeight,
        bodyY: document.body.scrollHeight - window.innerHeight,
        // The editor fills the window exactly, rather than being as tall as whatever is in it.
        main: (document.querySelector('main')?.getBoundingClientRect().height ?? 0) - window.innerHeight
      }))
      expect(overflow.x).toBeLessThanOrEqual(0)
      expect(overflow.y).toBeLessThanOrEqual(0)
      expect(overflow.bodyY).toBeLessThanOrEqual(0)
      expect(Math.abs(overflow.main)).toBeLessThanOrEqual(1)
      // Nothing that matters is cut off at the bottom: the transport and the timeline's clips are in view.
      const bottom = await page.evaluate(() => window.innerHeight)
      for (const selector of ['[data-testid="play-pause"]', '[data-testid="clip"]', '[data-testid="export-preset"]']) {
        const box = await page.locator(selector).first().boundingBox()
        expect(box, selector).not.toBeNull()
        expect(box!.y + box!.height, selector).toBeLessThanOrEqual(bottom)
      }
    }
    await resize(1440, 860)
  })

  it('keeps the ffmpeg version off the screen when ffmpeg works', async () => {
    await page.waitForFunction(() => (document.querySelector('[data-testid="ffmpeg-status"]')?.textContent ?? '').includes('ffmpeg version'))
    expect(await page.isVisible('[data-testid="ffmpeg-status"]')).toBe(false)
    expect(await page.locator('[data-testid="ffmpeg-banner"]').count()).toBe(0)
  })

  it('names each key in the top bar tooltips', async () => {
    // A Mac shows Cmd as its sign, with no plus.
    const k = process.platform === 'darwin' ? '⌘' : 'Ctrl+'
    expect(await page.getAttribute('[data-testid="save"]', 'title')).toBe(`Save (${k}S)`)
    expect(await page.getAttribute('[data-testid="undo"]', 'title')).toBe(`Undo (${k}Z)`)
    expect(await page.getAttribute('[data-testid="new-project"]', 'title')).toBe(`New project (${k}N)`)
  })

  it('opens Export as a dialog, which Escape closes', async () => {
    await openExport(page)
    expect(await page.isVisible('[data-testid="export-mode"]')).toBe(true)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="export-panel"]', { state: 'detached' })
  })

  it('keeps the right column for the selected clip only', async () => {
    const column = page.locator('[data-testid="inspector-column"]')
    expect(await column.locator('[data-testid="export-mode"]').count()).toBe(0)
    expect(await column.locator('[data-testid="open-shortcuts"]').count()).toBe(0)
  })
})

describe('telling you what happened', () => {
  it('says when it has saved, and the name loses its unsaved mark', async () => {
    const target = join(root, 'told.editbay')
    await answerSaveDialog(app, target)
    await page.locator('[data-testid="save"]').click()
    await page.waitForSelector('[data-testid="toast"][data-kind="saved"]')
    expect(await page.textContent('[data-testid="toast"][data-kind="saved"]')).toContain('told.editbay')
    await page.waitForSelector('[data-testid="project-name"][data-changed="no"]')
  })

  it('says the name can be changed before you try, by drawing the field it will become', async () => {
    const name = page.locator('[data-testid="project-name"]')
    const edge = (): Promise<string> =>
      name.evaluate((el) => getComputedStyle(el).borderTopColor)

    await page.mouse.move(0, 400)
    await page.waitForTimeout(150)
    const atRest = await edge()
    // Nothing drawn until the pointer is on it: transparent, whatever that
    // computes to.
    expect(atRest).toMatch(/rgba\(.*0\)$/)

    const box = (await name.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(edge, { timeout: 5000 }).not.toBe(atRest)
    await page.mouse.move(0, 400)
  })

  it('renames the project and its file together, and leaves both on Escape', async () => {
    const shown = (): Promise<string> =>
      page.locator('[data-testid="project-name"]').innerText()
    const there = async (name: string): Promise<boolean> =>
      stat(join(root, name)).then(
        () => true,
        () => false
      )

    // Escape leaves the old name exactly as it was, and the file with it.
    const before = await shown()
    await page.locator('[data-testid="project-name"]').click()
    await page.fill('[data-testid="project-rename"]', 'thrown away')
    await page.keyboard.press('Escape')
    await expect.poll(shown, { timeout: 5000 }).toBe(before)
    expect(await there('told.editbay')).toBe(true)

    // Enter keeps it, and the spaces are tidied on the way in.
    await page.locator('[data-testid="project-name"]').click()
    await page.fill('[data-testid="project-rename"]', '  Holiday   cut  ')
    await page.keyboard.press('Enter')
    await expect.poll(shown, { timeout: 5000 }).toContain('Holiday cut')

    // The file follows, so the Recent list and the bar never say two different
    // things. It was saved and untouched since, so the new file holds the new
    // name rather than waiting for the next save.
    await expect.poll(() => there('Holiday cut.editbay'), { timeout: 10_000 }).toBe(true)
    expect(await there('told.editbay')).toBe(false)
    await page.waitForSelector('[data-testid="project-name"][data-changed="no"]')

    // A plain save keeps the name. It used to be renamed after its file every
    // time, which matters for a name a filename cannot hold.
    await page.locator('[data-testid="project-name"]').click()
    await page.fill('[data-testid="project-rename"]', 'Episode 3: the long one')
    await page.keyboard.press('Enter')
    await expect.poll(shown, { timeout: 5000 }).toContain('Episode 3: the long one')
    await expect.poll(() => there('Episode 3_ the long one.editbay'), { timeout: 10_000 }).toBe(true)

    await page.locator('[data-testid="save"]').click()
    await page.waitForSelector('[data-testid="project-name"][data-changed="no"]')
    // The colon survives in the name, where the file had to give it up.
    expect(await shown()).toContain('Episode 3: the long one')
  })

  it('refuses a name whose file is already there, rather than writing over it', async () => {
    const taken = join(root, 'Taken.editbay')
    await writeFile(taken, 'someone else\n')
    const before = await page.locator('[data-testid="project-name"]').innerText()

    await page.locator('[data-testid="project-name"]').click()
    await page.fill('[data-testid="project-rename"]', 'Taken')
    await page.keyboard.press('Enter')

    // It fades on its own: nothing was lost and nothing is being asked, so
    // there is no box to clear before carrying on.
    await page.waitForSelector('[data-testid="toast"][data-kind="notice"]', { timeout: 10_000 })
    expect(await page.textContent('[data-testid="toast"][data-kind="notice"]')).toContain('Taken.editbay')
    // Neither the name nor the file moved, and the file that was there is
    // exactly as it was.
    expect(await page.locator('[data-testid="project-name"]').innerText()).toBe(before)
    expect((await readFile(taken)).toString()).toBe('someone else\n')
    await page.waitForSelector('[data-testid="toast"][data-kind="notice"]', { state: 'detached', timeout: 15_000 })
  })

  it('offers Undo after a change of shape, and the Undo puts the shape and crops back', async () => {
    const cropBefore = await page.getAttribute('[data-testid="crop-rect"]', 'data-crop')
    await page.selectOption('[data-testid="export-preset"]', 'square')
    await page.waitForSelector('[data-testid="toast"][data-kind="setShape"] [data-testid="toast-undo"]')
    expect(await page.textContent('[data-testid="toast"][data-kind="setShape"]')).toContain('Square')
    await page.locator('[data-testid="toast-undo"]').click()
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="export-preset"]') as HTMLSelectElement | null)?.value === 'vertical'
    )
    await page.waitForFunction(
      (crop) => document.querySelector('[data-testid="crop-rect"]')?.getAttribute('data-crop') === crop,
      cropBefore
    )
    expect(await page.locator('[data-testid="toast-undo"]').count()).toBe(0)
  })

  it('takes the Undo away once another edit is made', async () => {
    await page.selectOption('[data-testid="export-preset"]', 'square')
    await page.waitForSelector('[data-testid="toast-undo"]')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('KeyS')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
    expect(await page.locator('[data-testid="toast-undo"]').count()).toBe(0)
    // Back to where the suite was: one clip, vertical.
    await page.keyboard.press('ControlOrMeta+z')
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="clip"]').length === 1 &&
        (document.querySelector('[data-testid="export-preset"]') as HTMLSelectElement | null)?.value === 'vertical'
    )
  })
})

describe('keys', () => {
  it('Escape clears the selection', async () => {
    await selectClip()
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-selected="yes"]').length === 0)
  })

  it('an arrow key moves a focused slider, not the playhead', async () => {
    await selectClip()
    await page.keyboard.press('Home')
    await page.waitForFunction(() => document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead') === '0')
    // The clip's sound's volume, in the Inspector's Sound section.
    const slider = page.locator('[data-testid="linked-sound-level"]').first()
    const before = await slider.inputValue()
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction((v) => (document.querySelector('[data-testid="linked-sound-level"]') as HTMLInputElement).value !== v, before)
    expect(await playhead()).toBe(0)
    await slider.blur()
    await page.keyboard.press('ControlOrMeta+z')
  })

  it('a button clicked with the mouse is not pressed again by Enter', async () => {
    await page.locator('[data-testid="sequence-duplicate"]').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="sequence-tab"]').length === 2)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    expect(await page.locator('[data-testid="sequence-tab"]').count()).toBe(2)
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="sequence-tab"]').length === 0)
  })

  it('the editor takes no keys while the Export dialog is open', async () => {
    const view = await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')
    await openExport(page)
    await page.keyboard.press('KeyV')
    await page.waitForTimeout(300)
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')).toBe(view)
    await closeExport(page)
    // And once it is closed, the same key works.
    await page.keyboard.press('KeyV')
    await page.waitForFunction((v) => document.querySelector('[data-testid="monitor-stage"]')?.getAttribute('data-view') !== v, view)
    await page.keyboard.press('KeyV')
  })
})

describe("an export's result", () => {
  it('survives edits made while it ran, and goes at the first edit after', async () => {
    const exportDir = await mkdtemp(join(root, 'export-'))
    await app.evaluate(async ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, exportDir)
    await openExport(page)
    await chooseExportFolder(page, exportDir)
    await page.waitForFunction(() => !(document.querySelector('[data-testid="export-start"]') as HTMLButtonElement).disabled)
    await page.locator('[data-testid="export-start"]').click()
    await page.waitForSelector('[data-testid="export-progress"]')

    // Carry on working with the dialog closed while it runs.
    await closeExport(page)
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('KeyS')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2)
    await page.waitForFunction(() => document.querySelector('[data-testid="open-export"]')?.textContent === 'Export...', undefined, {
      timeout: 120_000
    })

    await openExport(page)
    await page.waitForSelector('[data-testid="export-done"]')
    await closeExport(page)

    // The first edit after it finished makes it out of date.
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 1)
    await openExport(page)
    expect(await page.locator('[data-testid="export-done"]').count()).toBe(0)
    await closeExport(page)
  }, 180_000)
})

describe('the columns', () => {
  it('drag wider, and stay that way after a reload', async () => {
    const column = page.locator('[data-testid="bin-column"]')
    const before = (await column.boundingBox())!.width
    const divider = (await page.locator('[data-testid="bin-divider"]').boundingBox())!
    const x = divider.x + divider.width / 2
    const y = divider.y + divider.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 50, y, { steps: 5 })
    await page.mouse.move(x + 80, y, { steps: 5 })
    await page.mouse.up()
    const after = (await column.boundingBox())!.width
    expect(after).toBeGreaterThan(before + 60)

    await page.reload()
    await page.waitForSelector('[data-testid="bin-column"]')
    const reloaded = (await page.locator('[data-testid="bin-column"]').boundingBox())!.width
    expect(Math.abs(reloaded - after)).toBeLessThanOrEqual(2)
  })
})

describe('the divider above the timeline', () => {
  const tracks = '[data-testid="timeline-tracks"]'
  const monitor = '[data-testid="monitor-stage"]'

  async function dragDivider(byY: number): Promise<void> {
    const divider = (await page.locator('[data-testid="timeline-divider"]').boundingBox())!
    const x = divider.x + divider.width / 2
    const y = divider.y + divider.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + byY / 2, { steps: 5 })
    await page.mouse.move(x, y + byY, { steps: 5 })
    await page.mouse.up()
  }

  async function trackCount(): Promise<number> {
    return page.locator('[data-testid="track-header"]').count()
  }

  it('drags the timeline taller, the monitor giving up the room, and it stays that way after a reload', async () => {
    // Tracks enough to fill more than it has now, so there is something to grow for.
    for (let i = 0; i < 6; i++) await page.click('[data-testid="add-video-track"]')
    // Made short first: the window in these tests leaves the timeline little more than it has.
    await dragDivider(150)
    const before = (await page.locator(tracks).boundingBox())!.height
    const monitorBefore = (await page.locator(monitor).boundingBox())!.height
    await dragDivider(-120)
    const after = (await page.locator(tracks).boundingBox())!.height
    expect(after).toBeGreaterThan(before + 100)
    expect((await page.locator(monitor).boundingBox())!.height).toBeLessThan(monitorBefore - 60)

    await page.reload()
    await page.waitForSelector(tracks)
    expect(Math.abs((await page.locator(tracks).boundingBox())!.height - after)).toBeLessThanOrEqual(2)
  })

  // Bugs and notes 2, note 10.
  it('keeps the height dragged when tracks are removed, with room below the last one', async () => {
    const tall = (await page.locator(tracks).boundingBox())!.height
    const monitorTall = (await page.locator(monitor).boundingBox())!.height
    const many = await trackCount()
    // The empty video tracks added above, taken away from the top down.
    for (let i = 1; i <= 6; i++) {
      await page.locator('[data-testid="track-menu-open"]').first().click()
      await page.click('[data-testid="track-remove"]')
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid="track-header"]').length === n, many - i)
    }
    expect(Math.abs((await page.locator(tracks).boundingBox())!.height - tall)).toBeLessThanOrEqual(2)
    expect(Math.abs((await page.locator(monitor).boundingBox())!.height - monitorTall)).toBeLessThanOrEqual(2)
  })

  it('follows the pointer while dragging, and keeps the height only once it is let go', async () => {
    const stored = (): Promise<string | null> => page.evaluate(() => window.localStorage.getItem('editbay.window'))
    const before = (await page.locator(tracks).boundingBox())!.height
    const kept = await stored()
    const divider = (await page.locator('[data-testid="timeline-divider"]').boundingBox())!
    const x = divider.x + divider.width / 2
    const y = divider.y + divider.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    // Down, making it shorter: the one before left it as tall as it goes.
    await page.mouse.move(x, y + 60, { steps: 6 })
    await expect.poll(async () => (await page.locator(tracks).boundingBox())!.height).toBeLessThan(before - 50)
    expect(await stored()).toBe(kept)
    await page.mouse.up()
    await expect.poll(stored).not.toBe(kept)
  })

  it('grows until the monitor is down to its smallest picture, even with a single track', async () => {
    await dragDivider(-5000)
    const picture = (await page.locator(monitor).boundingBox())!.height
    expect(picture).toBeGreaterThanOrEqual(146)
    expect(picture).toBeLessThanOrEqual(160)
    // The whole timeline is still in the window.
    const panel = (await page.locator('[data-testid="timeline-panel"]').boundingBox())!
    expect(panel.y + panel.height).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight) + 1)
  })

  it('keeps the monitor at its smallest picture or more when the window is made smaller', async () => {
    const size = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      const [w, h] = win.getSize()
      win.setSize(w!, h! - 150)
      return { w: w!, h: h! }
    })
    try {
      await expect.poll(async () => (await page.locator(monitor).boundingBox())!.height).toBeGreaterThanOrEqual(146)
      const panel = (await page.locator('[data-testid="timeline-panel"]').boundingBox())!
      expect(panel.y + panel.height).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight) + 1)
    } finally {
      await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]!.setSize(s.w, s.h), size)
    }
  })

  it('goes back to as tall as the tracks with a double click', async () => {
    await page.locator('[data-testid="timeline-divider"]').dblclick()
    await page.waitForFunction(() => window.localStorage.getItem('editbay.window')?.includes('"timelineHeight":null') === true)
  })
})

describe('saving automatically', () => {
  it('saves a project that has a file on its own, once changes stop, without being turned on', async () => {
    const target = join(root, 'by-itself.editbay')
    await answerSaveDialog(app, target)
    await page.keyboard.press('ControlOrMeta+Shift+s')
    await page.waitForSelector('[data-testid="project-name"]:has-text("by-itself")')
    await page.waitForSelector('[data-testid="project-name"][data-changed="no"]')
    const savedAt = (await stat(target)).mtimeMs

    // On from the start, with nothing to turn on.
    await page.locator('[data-testid="save-menu"]').click()
    expect(await page.locator('[data-testid="save-automatically"]').isChecked()).toBe(true)
    await page.keyboard.press('Escape')

    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('KeyS')
    await page.waitForSelector('[data-testid="project-name"][data-changed="yes"]')
    // Nothing is written straight away: it waits for the changes to stop.
    expect((await stat(target)).mtimeMs).toBe(savedAt)
    await page.waitForSelector('[data-testid="project-name"][data-changed="no"]', { timeout: SAVE_SOON_MS * 6 })
    expect((await stat(target)).mtimeMs).toBeGreaterThan(savedAt)

    // And it is still on after the app is started again.
    const closed = app.waitForEvent('close', { timeout: 30_000 })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await closed
    await launch()
    await page.locator('[data-testid="save-menu"]').click()
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="save-automatically"]') as HTMLInputElement | null)?.checked === true
    )
    await page.keyboard.press('Escape')
  })
})
