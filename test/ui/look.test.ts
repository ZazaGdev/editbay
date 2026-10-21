import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 19, step 2: every control is drawn by the app. What is tested here is
 * what a picture cannot show: that the keyboard draws a ring and the mouse
 * does not, that a button which is off says why, that the toasts are clear of
 * the timeline, and that the search box is a box rather than a dialog.
 */

const fx = fixtureSet('ui-look')
const root = await mkdtemp(join(tmpdir(), 'editbay-look-'))
let app: ElectronApplication
let page: Page
let clipPath: string

/** A clip on the timeline, since a relaunch starts from a blank project. */
async function withAClip(): Promise<void> {
  if ((await page.locator('[data-testid="clip"]').count()) > 0) return
  await page.evaluate((p) => window.api.importFiles([p]), clipPath)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').click()
  await page.waitForSelector('[data-testid="clip"]')
}

beforeAll(async () => {
  clipPath = await fx.cleanClip()
  const clip = clipPath
  app = await electron.launch({
    args: ['.', `--user-data-dir=${join(root, 'user-data')}`],
    cwd: process.cwd()
  })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), clip)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').click()
  await page.waitForSelector('[data-testid="clip"]')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true }).catch(() => {})
  await fx.cleanup()
})

/** The shadow Chromium computes for an element, which is how the ring is drawn. */
function ringOn(testid: string): Promise<string> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`)
    return el ? getComputedStyle(el).boxShadow : 'missing'
  }, testid)
}

describe('the keyboard leaves a mark the mouse does not', () => {
  it('draws a ring on a top bar button reached with Tab, and none on one clicked', async () => {
    // Focus put on it as the keyboard would, so :focus-visible matches.
    await page.locator('[data-testid="open-search"]').focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('open-search')
    const withKeyboard = await ringOn('open-search')
    expect(withKeyboard).not.toBe('none')
    expect(withKeyboard).not.toBe('missing')

    // The same button clicked: focused, but no ring, so the window is quiet for the mouse.
    await page.locator('[data-testid="open-shortcuts"]').click()
    await page.waitForSelector('[data-testid="shortcuts-dialog"]')
    await page.locator('[data-testid="shortcuts-close"]').click()
    await page.waitForSelector('[data-testid="shortcuts-dialog"]', { state: 'detached' })
    expect(await ringOn('open-search')).toBe('none')
  })
})

describe('a control that is off says why', () => {
  it('gives every disabled control in the window a title, on itself or on what wraps it', async () => {
    const silent = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button:disabled, input:disabled, select:disabled'))
        .filter((el) => {
          const own = el.getAttribute('title') ?? ''
          const wrapper = el.closest('[title]')?.getAttribute('title') ?? ''
          return own.trim() === '' && wrapper.trim() === ''
        })
        .map((el) => el.getAttribute('data-testid') ?? el.textContent?.trim() ?? el.tagName)
    )
    expect(silent).toEqual([])
  })

  it('shows the reason on the wrapper, since Chromium gives a disabled button no pointer events', async () => {
    // Arranged: any edit clears what there was to redo, so Redo is off.
    await page.keyboard.press('s')
    await page.waitForSelector('[data-testid="redo"]:disabled')
    const wrapped = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="redo"]')
      const wrapper = el?.parentElement
      return { onButton: el?.getAttribute('title') ?? '', onWrapper: wrapper?.getAttribute('title') ?? '' }
    })
    expect(wrapped.onButton).not.toBe('')
    expect(wrapped.onWrapper).toBe(wrapped.onButton)
    await page.keyboard.press('ControlOrMeta+z')
  })
})

describe('the toasts', () => {
  it('sit clear of the timeline, which is where the work is', async () => {
    // An edit that offers an Undo raises one. Changing the shape does.
    await page.selectOption('[data-testid="export-preset"]', 'square')
    await page.waitForSelector('[data-testid="toast"][data-kind="setShape"]')
    const toast = (await page.locator('[data-testid="toast"]').first().boundingBox())!
    const timeline = (await page.locator('[data-testid="timeline-panel"]').boundingBox())!
    expect(toast.y + toast.height).toBeLessThanOrEqual(timeline.y)
    // On the right, not over the middle of the window.
    const window = page.viewportSize() ?? { width: 0, height: 0 }
    expect(toast.x).toBeGreaterThan(window.width / 2)
    await page.locator('[data-testid="toast-undo"]').click()
    await page.waitForSelector('[data-testid="toast"]', { state: 'detached' })
  })
})

describe('the search of every action', () => {
  it('is a box to type in, with no title bar and no Close button, and Escape closes it', async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await page.waitForSelector('[data-testid="command-palette"]')
    expect(await page.locator('[data-testid="command-palette-close"]').count()).toBe(0)
    expect(await page.locator('[data-testid="command-palette"] h2').count()).toBe(0)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })
  })

  it('groups its actions under headings before anything is typed, and ranks them once something is', async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await page.waitForSelector('[data-testid="command-palette"]')
    const headings = await page.locator('[data-testid="command-list"] .ui-label').allTextContents()
    expect(headings).toContain('Editing')
    expect(headings).toContain('Project')

    // Typing ranks them instead, so the best match is first and the headings go.
    await page.fill('[data-testid="command-search"]', 'split')
    expect(await page.locator('[data-testid="command-list"] .ui-label').count()).toBe(0)
    expect(await page.getAttribute('[data-testid="command"]', 'data-command')).toBe('split')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })
  })

  it('offers what was run last at the top, once something has been run from it', async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await page.waitForSelector('[data-testid="command-palette"]')
    await page.fill('[data-testid="command-search"]', 'go to start')
    await page.click('[data-testid="command"][data-command="goToStart"]')
    await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })

    await page.keyboard.press('ControlOrMeta+k')
    await page.waitForSelector('[data-testid="command-palette"]')
    expect(await page.locator('[data-testid="command-list"] .ui-label').first().textContent()).toBe('Recent')
    expect(await page.getAttribute('[data-testid="command"]', 'data-command')).toBe('goToStart')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })
  })
})

// Bugs and notes 2, note 9.
describe('Recent in the search of every action', () => {
  const recentOrder = (): Promise<string[]> =>
    page.locator('[data-testid="command-list"] > div').first().locator('[data-testid="command"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-command') ?? ''))
  const flip = async (words: string, id: string): Promise<void> => {
    await page.fill('[data-testid="command-search"]', words)
    await page.click(`[data-testid="command"][data-command="${id}"]`)
  }

  it('stays in the order it opened in while switches are flipped, and moves the next time', async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await page.waitForSelector('[data-testid="command-palette"]')
    await flip('snap', 'snapping')
    await flip('skim', 'skim')
    await flip('overview', 'overview')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })

    await page.keyboard.press('ControlOrMeta+k')
    await page.waitForSelector('[data-testid="command-palette"]')
    const opened = await recentOrder()
    expect(opened.slice(0, 3)).toEqual(['overview', 'skim', 'snapping'])
    const skimWas = await page.getAttribute('[data-testid="command"][data-command="skim"] [data-testid="command-state"]', 'data-on')
    // The second, then the third: nothing moves, and the second shows its new state.
    await page.click('[data-testid="command"][data-command="skim"]')
    await expect
      .poll(() => page.getAttribute('[data-testid="command"][data-command="skim"] [data-testid="command-state"]', 'data-on'))
      .not.toBe(skimWas)
    expect(await recentOrder()).toEqual(opened)
    await page.click('[data-testid="command"][data-command="snapping"]')
    expect(await recentOrder()).toEqual(opened)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })

    await page.keyboard.press('ControlOrMeta+k')
    await page.waitForSelector('[data-testid="command-palette"]')
    expect((await recentOrder()).slice(0, 3)).toEqual(['snapping', 'skim', 'overview'])
    // Overview back as it was: the others were flipped twice.
    await page.click('[data-testid="command"][data-command="overview"]')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached' })
  })
})

describe('the primary action', () => {
  it('paints the same accent in the window and in the dialog it opens', async () => {
    const inBar = await page.evaluate(
      () => getComputedStyle(document.querySelector('[data-testid="open-export"]')!).backgroundColor
    )
    await page.locator('[data-testid="open-export"]').click()
    await page.waitForSelector('[data-testid="export-panel"]')
    // Once it knows what it would write: until then it is off, and an off
    // button is grey whatever its variant.
    await page.waitForSelector('[data-testid="export-start"]:not(:disabled)', { timeout: 30_000 })
    const inDialog = await page.evaluate(
      () => getComputedStyle(document.querySelector('[data-testid="export-start"]')!).backgroundColor
    )
    expect(inDialog).toBe(inBar)
    await page.locator('[data-testid="export-panel-close"]').click()
    await page.waitForSelector('[data-testid="export-panel"]', { state: 'detached' })
  })
})

describe('the panels fold away', () => {
  it('gives the monitor the room, and gives it back', async () => {
    const wide = async (): Promise<number> =>
      (await page.locator('[data-testid="monitor-stage"]').boundingBox())!.width

    const open = await wide()
    await page.locator('[data-testid="bin-fold"]').click()
    await page.waitForSelector('[data-testid="bin-column"][data-folded="yes"]')
    const folded = await wide()
    expect(folded).toBeGreaterThan(open)

    await page.locator('[data-testid="bin-column-open"]').click()
    await page.waitForSelector('[data-testid="bin-column"][data-folded="no"]')
    expect(await wide()).toBeCloseTo(open, 0)
  })

  it('folds the Inspector too, and the divider goes with it', async () => {
    await page.locator('[data-testid="inspector-fold"]').click()
    await page.waitForSelector('[data-testid="inspector-column"][data-folded="yes"]')
    expect(await page.locator('[data-testid="inspector-divider"]').count()).toBe(0)
    await page.locator('[data-testid="inspector-column-open"]').click()
    await page.waitForSelector('[data-testid="inspector-column"][data-folded="no"]')
    expect(await page.locator('[data-testid="inspector-divider"]').count()).toBe(1)
  })
})

describe('one job per place under the monitor', () => {
  it('puts what you are looking at left of the transport, and what is drawn over it right', async () => {
    const box = async (id: string): Promise<{ x: number; width: number }> => {
      const b = (await page.locator(`[data-testid="${id}"]`).boundingBox())!
      return { x: b.x, width: b.width }
    }
    const view = await box('view')
    const play = await box('play-pause')
    const guides = await box('guides-toggle')
    expect(view.x + view.width).toBeLessThanOrEqual(play.x)
    expect(play.x + play.width).toBeLessThanOrEqual(guides.x)
  })

  it('has moved Remove silences to the timeline, where the other edits are', async () => {
    const button = (await page.locator('[data-testid="remove-silences"]').boundingBox())!
    const timeline = (await page.locator('[data-testid="timeline-panel"]').boundingBox())!
    expect(button.y).toBeGreaterThanOrEqual(timeline.y)
  })

  it('has moved lock to shape into the Inspector, beside the crop it acts on', async () => {
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
    await page.waitForSelector('[data-testid="picture-clip-panel"]')
    const lock = (await page.locator('[data-testid="aspect-lock"]').boundingBox())!
    const crop = (await page.locator('[data-inspector-group][data-group="Crop"]').boundingBox())!
    expect(lock.y).toBeGreaterThanOrEqual(crop.y)
    expect(lock.y).toBeLessThanOrEqual(crop.y + crop.height)
  })

  it('groups the Inspector under Frame, Zoom, Crop, Look, Blur and Sound, in that order, with Source last', async () => {
    const groups = (): Promise<(string | null)[]> =>
      page.locator('[data-inspector-group]').evaluateAll((els) => els.map((e) => e.getAttribute('data-group')))
    expect((await groups()).slice(0, 7)).toEqual(['Frame', 'Zoom', 'Crop', 'Look', 'Blur', 'Tools', 'Sound'])
    expect((await groups()).at(-1)).toBe('Source')

    // A sound clip's too: Source last, below Sound and Linked.
    const sound = (await page.locator('[data-testid="sound-clip"]').first().boundingBox())!
    await page.mouse.click(sound.x + sound.width / 2, sound.y + sound.height / 2)
    await page.waitForSelector('[data-testid="sound-clip-panel"]')
    expect((await groups()).at(0)).toBe('Sound')
    expect((await groups()).at(-1)).toBe('Source')

    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
    await page.waitForSelector('[data-testid="picture-clip-panel"]')
  })

  it('folds a section away from its label, and it stays folded for another clip and after a reload', async () => {
    const crop = '[data-inspector-group][data-group="Crop"]'
    expect(await page.getAttribute(crop, 'data-folded')).toBe('no')
    await page.locator(`${crop} [data-testid="inspector-group-toggle"]`).click()
    await page.waitForSelector(`${crop}[data-folded="yes"]`)
    // Folded, its controls are gone and it takes a line.
    expect(await page.locator(`${crop} [data-testid="aspect-lock"]`).count()).toBe(0)

    // Another clip, where the crop is just as much in play: your answer holds.
    const clips = page.locator('[data-testid="clip"][data-kind="video"]')
    const other = (await clips.last().boundingBox())!
    await page.mouse.click(other.x + other.width / 2, other.y + other.height / 2)
    await page.waitForSelector('[data-testid="picture-clip-panel"]')
    expect(await page.getAttribute(crop, 'data-folded')).toBe('yes')

    await page.reload()
    await page.waitForSelector('[data-testid="clip"][data-kind="video"]')
    const first = (await clips.first().boundingBox())!
    await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2)
    await page.waitForSelector(`${crop}[data-folded="yes"]`)

    // And opened again from the same label.
    await page.locator(`${crop} [data-testid="inspector-group-toggle"]`).click()
    await page.waitForSelector(`${crop}[data-folded="no"] [data-testid="aspect-lock"]`)
  })
})

describe('the level meter', () => {
  it('reads the sound at the playhead, and says nothing where there is none', async () => {
    await page.keyboard.press('Home')
    await page.waitForSelector('[data-testid="level-meter"]')
    // On a clip with sound: a reading, and it is a number rather than blank.
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="level-meter"]')?.getAttribute('data-level') ?? '') !== '',
      undefined,
      { timeout: 30_000 }
    )
    const heard = Number(await page.getAttribute('[data-testid="level-meter"]', 'data-level'))
    expect(heard).toBeGreaterThan(0)

    // Past the end of everything: nothing is heard, and it says so rather than reading zero.
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(
      () => document.querySelector('[data-testid="level-meter"]')?.getAttribute('data-level') === '',
      undefined,
      { timeout: 10_000 }
    )
    expect(await page.textContent('[data-testid="level-meter-reading"]')).toBe('--')
    await page.keyboard.press('Home')
  })

  it('reads in decibels, and says which of the two bars it is', async () => {
    await page.keyboard.press('Home')
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="level-meter"]')?.getAttribute('data-level') ?? '') !== '',
      undefined,
      { timeout: 30_000 }
    )
    const reading = (await page.textContent('[data-testid="level-meter-reading"]'))!
    expect(reading).toMatch(/dB$/)
    // Never a percentage, which is what the preview volume beside it reads in.
    expect(reading).not.toContain('%')
    // Below full scale, since nothing here is louder than the file allows.
    expect(Number(reading.replace(' dB', ''))).toBeLessThanOrEqual(0)
    // And it says what it is, so it is not taken for the volume control.
    expect(await page.textContent('[data-testid="level-meter"]')).toContain('LEVEL')
  })

  it('holds its highest reading rather than dropping the moment the sound does', async () => {
    await page.keyboard.press('Home')
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="level-meter"]')?.getAttribute('data-level') ?? '') !== '',
      undefined,
      { timeout: 30_000 }
    )
    const peak = Number(await page.getAttribute('[data-testid="level-meter"]', 'data-held'))
    expect(peak).toBeGreaterThan(0)

    // The clip turned right down: the reading drops at once, the peak stays up.
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
    await page.waitForSelector('[data-testid="linked-sound-level"]')
    await page.locator('[data-testid="linked-sound-level"]').fill('10')
    await page.waitForFunction(
      (was) => Number(document.querySelector('[data-testid="level-meter"]')?.getAttribute('data-level')) < was,
      peak,
      { timeout: 10_000 }
    )
    expect(Number(await page.getAttribute('[data-testid="level-meter"]', 'data-held'))).toBeCloseTo(peak, 2)

    // And it comes down once the hold is out.
    await page.waitForFunction(
      (was) => Number(document.querySelector('[data-testid="level-meter"]')?.getAttribute('data-held')) < was,
      peak,
      { timeout: 10_000 }
    )
    await page.keyboard.press('ControlOrMeta+z')
    await page.keyboard.press('Home')
  })
})

/*
 * Last on purpose: this one closes the window and opens it again, which leaves
 * an empty project behind. Anything after it would be arranging its own clip
 * from scratch.
 */
describe('what the window remembers', () => {
  it('keeps a folded panel folded when the window opens again', async () => {
    await page.locator('[data-testid="bin-fold"]').click()
    await page.waitForSelector('[data-testid="bin-column"][data-folded="yes"]')

    await app.close()
    app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
    page = await app.firstWindow()
    await page.waitForSelector('main')
    await discardUnsavedWork(app)

    await page.waitForSelector('[data-testid="bin-column"][data-folded="yes"]')
    await page.locator('[data-testid="bin-column-open"]').click()
    await page.waitForSelector('[data-testid="bin-column"][data-folded="no"]')
  }, 120_000)

  it('keeps the whole-edit strip hidden when the window opens again, and brings it back', async () => {
    await withAClip()
    const strip = page.locator('[data-testid="overview"]')
    await expect.poll(() => strip.count(), { timeout: 10_000 }).toBe(1)

    // The X on the row itself.
    await page.locator('[data-testid="overview-hide"]').click()
    await expect.poll(() => strip.count(), { timeout: 10_000 }).toBe(0)
    expect(await page.getAttribute('[data-testid="overview-toggle"]', 'aria-pressed')).toBe('false')

    await app.close()
    app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
    page = await app.firstWindow()
    await page.waitForSelector('main')
    await discardUnsavedWork(app)

    // Still away, and it is the window that remembered: nothing was saved with
    // the project, and no undo can reach it.
    await page.waitForSelector('[data-testid="overview-toggle"]')
    expect(await page.locator('[data-testid="overview"]').count()).toBe(0)

    // The button in the row above the timeline brings it back.
    await withAClip()
    await page.locator('[data-testid="overview-toggle"]').click()
    await page.waitForSelector('[data-testid="overview"]')
    expect(await page.getAttribute('[data-testid="overview-toggle"]', 'aria-pressed')).toBe('true')
  }, 120_000)

  it('refuses to be made smaller than its minimum', async () => {
    const size = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      const min = win.getMinimumSize()
      win.setSize(600, 400)
      const size = win.getSize()
      return { width: size[0] ?? 0, height: size[1] ?? 0, minWidth: min[0] ?? 0, minHeight: min[1] ?? 0 }
    })
    expect(size.width).toBeGreaterThanOrEqual(size.minWidth)
    expect(size.height).toBeGreaterThanOrEqual(size.minHeight)
    // A minimum worth having: the monitor's own smallest still fits beside two panels.
    expect(size.minWidth).toBeGreaterThanOrEqual(1000)
  })
})
