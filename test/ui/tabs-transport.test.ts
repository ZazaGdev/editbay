import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 13, step 3: the sequence tabs, the transport and the monitor. A new
 * sequence in the shape you pick, a menu on every tab, a remove that cannot
 * catch the wrong tab, drawn transport buttons with their keys, a timecode you
 * can type into, and a monitor that says what it shows and where the frame is.
 */

const fx = fixtureSet('ui-tabs')
const root = await mkdtemp(join(tmpdir(), 'editbay-tabs-'))
const WAIT = { timeout: 10_000 }
let app: ElectronApplication
let page: Page
let cleanPath: string

beforeAll(async () => {
  cleanPath = await fx.cleanClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** A new project with the clean clip on V1, twice: 8 seconds at 30 fps. */
async function fresh(): Promise<void> {
  // A new project starts on the shape chosen last, and offers the framing used last: these tests start from Vertical, unframed.
  await page.evaluate(() => window.api.setAppSettings({ lastShape: 'vertical', lastFraming: null }))
  await page.keyboard.press('Control+n')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0)
  await page.evaluate((p) => window.api.importFiles([p]), cleanPath)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  for (let i = 1; i <= 2; i++) {
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="clip"]').length === n, i)
  }
  await page.keyboard.press('Home')
  await waitPlayhead(0)
}

async function tabNames(): Promise<string[]> {
  return page.locator('[data-testid="sequence-name"]').allTextContents()
}

async function waitTabs(n: number): Promise<void> {
  await page.waitForFunction((want) => document.querySelectorAll('[data-testid="sequence-tab"]').length === want, n)
}

async function shape(): Promise<string> {
  return page.inputValue('[data-testid="export-preset"]')
}

async function waitPlayhead(frame: number): Promise<void> {
  await page.waitForFunction(
    (f) => document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead') === String(f),
    frame
  )
}

/** The tab whose name is exactly `name`: "Vertical" is not "Vertical 2". */
function tab(name: string): ReturnType<Page['locator']> {
  return page
    .locator('[data-testid="sequence-tab"]')
    .filter({ has: page.getByTestId('sequence-name').getByText(name, { exact: true }) })
}

/**
 * How light the monitor is, 0 to 255, at a point given in page pixels, read
 * from a screenshot as the window draws it: a box can be where it should be
 * and still be hidden under something else.
 */
async function lightnessAt(x: number, y: number): Promise<number> {
  const stage = page.locator('[data-testid="monitor-stage"]')
  const box = (await stage.boundingBox())!
  const file = join(root, `shot-${Date.now()}.png`)
  await writeFile(file, await stage.screenshot())
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const size = String(probe).match(/, (\d+)x(\d+)/)
  const scale = size ? Number(size[1]) / box.width : 1
  const px = Math.round((x - box.x) * scale)
  const py = Math.round((y - box.y) * scale)
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${px}:${py},format=gray`, '-f', 'rawvideo', 'pipe:1'])
  return stdout[0] ?? 0
}

async function rightClickTab(name: string): Promise<void> {
  await tab(name).click({ button: 'right' })
  await page.waitForSelector('[data-testid="sequence-menu"]')
}

describe('the sequence tabs', () => {
  // A new project, a clip brought in and put on twice: more than the default ten seconds on a busy machine.
  beforeEach(fresh, 30_000)

  it('+ asks which shape, and the new sequence takes it', async () => {
    await page.click('[data-testid="sequence-add"]')
    await page.waitForSelector('[data-testid="sequence-add-menu"]')
    // All of it on screen, though the tabs are at the bottom of the window.
    const menu = (await page.locator('[data-testid="sequence-add-menu"]').boundingBox())!
    const height = await page.evaluate(() => window.innerHeight)
    expect(menu.y).toBeGreaterThanOrEqual(0)
    expect(menu.y + menu.height).toBeLessThanOrEqual(height)
    await page.click('[data-testid="sequence-add-shape"][data-shape="square"]')
    await waitTabs(2)
    await page.waitForFunction(() => (document.querySelector('[data-testid="export-preset"]') as HTMLSelectElement).value === 'square')
    expect(await tabNames()).toEqual(['Vertical', 'Square'])
  })

  it('shows the remove x on the sequence on screen only', async () => {
    await page.click('[data-testid="sequence-duplicate"]')
    await waitTabs(2)
    expect(await page.locator('[data-testid="sequence-remove"]').count()).toBe(1)
    expect(await page.locator('[data-testid="sequence-tab"][data-active="yes"] [data-testid="sequence-remove"]').count()).toBe(1)
    const box = await page.locator('[data-testid="sequence-remove"]').boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(20)
  })

  it('offers Undo after a sequence is removed, which brings it back', async () => {
    await page.click('[data-testid="sequence-duplicate"]')
    await waitTabs(2)
    await page.locator('[data-testid="sequence-remove"]').click()
    // Back to one sequence, which has no tab (task 88).
    await waitTabs(0)
    await page.waitForSelector('[data-testid="toast"][data-kind="removeSequence"] [data-testid="toast-undo"]')
    await page.locator('[data-testid="toast-undo"]').click()
    await waitTabs(2)
  })

  it('has a menu on right-click: rename, duplicate, shape and remove', async () => {
    // One sequence has no tab to click: a second one brings them.
    await page.click('[data-testid="sequence-duplicate"]')
    await waitTabs(2)

    await rightClickTab('Vertical 2')
    await page.locator('[data-testid="sequence-menu-shape"]', { hasText: 'Landscape' }).click()
    await page.waitForFunction(() => (document.querySelector('[data-testid="export-preset"]') as HTMLSelectElement).value === 'landscape')
    expect(await tabNames()).toEqual(['Vertical', 'Landscape'])

    await rightClickTab('Landscape')
    await page.click('[data-testid="sequence-menu-rename"]')
    const box = page.locator('[data-testid="sequence-name-input"]')
    await box.fill('YouTube')
    await box.press('Enter')
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('[data-testid="sequence-name"]')).some((e) => e.textContent === 'YouTube')
    )

    await rightClickTab('YouTube')
    await page.click('[data-testid="sequence-menu-duplicate"]')
    await waitTabs(3)

    await rightClickTab('YouTube')
    await page.click('[data-testid="sequence-menu-remove"]')
    await waitTabs(2)
    expect(await tabNames()).not.toContain('YouTube')
  })

  it('acts from the menu on the tab clicked, which comes on screen first', async () => {
    await page.click('[data-testid="sequence-duplicate"]')
    await waitTabs(2)
    // The copy is on screen; the menu is for the original.
    await rightClickTab('Vertical')
    await page.waitForFunction(
      () => document.querySelector('[data-testid="sequence-tab"][data-active="yes"] [data-testid="sequence-name"]')?.textContent === 'Vertical'
    )
    await page.locator('[data-testid="sequence-menu-shape"]', { hasText: 'Square' }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="sequence-name"]')?.textContent === 'Square')
    expect(await tabNames()).toEqual(['Square', 'Vertical 2'])
    expect(await shape()).toBe('square')
  })

  it('removes one sequence, never two, when its x is double-clicked', async () => {
    await page.click('[data-testid="sequence-duplicate"]')
    await waitTabs(2)
    await page.click('[data-testid="sequence-duplicate"]')
    await waitTabs(3)
    // The middle one on screen: once it goes, the next slides under the pointer, its x with it.
    await tab('Vertical 2').click()
    await page.waitForFunction(
      () => document.querySelector('[data-testid="sequence-tab"][data-active="yes"] [data-testid="sequence-name"]')?.textContent === 'Vertical 2'
    )
    // The first click of a double-click, then the second once the window has
    // drawn the next sequence's x under the pointer, as a slow double-click does.
    const x = (await page.locator('[data-testid="sequence-remove"]').boundingBox())!
    const at = { x: x.x + x.width / 2, y: x.y + x.height / 2 }
    await page.mouse.click(at.x, at.y)
    await waitTabs(2)
    await page.waitForFunction(
      () => document.querySelector('[data-testid="sequence-tab"][data-active="yes"] [data-testid="sequence-name"]')?.textContent === 'Vertical 3'
    )
    const next = (await page.locator('[data-testid="sequence-remove"]').boundingBox())!
    expect(Math.abs(next.x + next.width / 2 - at.x)).toBeLessThan(next.width / 2)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down({ clickCount: 2 })
    await page.mouse.up({ clickCount: 2 })
    await page.waitForTimeout(500)
    expect(await tabNames()).toEqual(['Vertical', 'Vertical 3'])
  })

  it('keeps every tab where it is when another comes on screen', async () => {
    await page.click('[data-testid="sequence-duplicate"]')
    await waitTabs(2)
    const before = (await tab('Vertical 2').boundingBox())!.x
    await tab('Vertical').click()
    await page.waitForFunction(
      () => document.querySelector('[data-testid="sequence-tab"][data-active="yes"] [data-testid="sequence-name"]')?.textContent === 'Vertical'
    )
    expect((await tab('Vertical 2').boundingBox())!.x).toBe(before)
  })

  it('opens a tab\'s menu from the keyboard, and works it with the arrows', async () => {
    await page.click('[data-testid="sequence-duplicate"]')
    await waitTabs(2)
    await tab('Vertical').focus()
    await page.keyboard.press('Shift+F10')
    await page.waitForSelector('[data-testid="sequence-menu"]')
    // The first item, Rename, has focus; down once is Duplicate.
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await waitTabs(3)
  })

  it('closes a menu when its sequence goes from under it', async () => {
    await page.click('[data-testid="sequence-duplicate"]')
    await waitTabs(2)
    await rightClickTab('Vertical 2')
    await page.keyboard.press('Control+z')
    await waitTabs(0)
    await page.waitForSelector('[data-testid="sequence-menu"]', { state: 'detached' })
    await page.keyboard.press('Control+y')
    await waitTabs(2)
    await page.waitForTimeout(300)
    expect(await page.locator('[data-testid="sequence-menu"]').count()).toBe(0)
  })

  it('closes the menu on Escape, which clears nothing else', async () => {
    const clip = await page.locator('[data-testid="clip"]').first().boundingBox()
    await page.mouse.click(clip!.x + clip!.width / 2, clip!.y + 60)
    await page.waitForSelector('[data-testid="clip"][data-selected="yes"]')
    // A second sequence, so the first has a tab; it keeps its own selection.
    await page.click('[data-testid="sequence-duplicate"]')
    await waitTabs(2)
    await rightClickTab('Vertical')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="sequence-menu"]', { state: 'detached' })
    // Escape went to the menu, not to the editor, which would have cleared the selection.
    expect(await page.locator('[data-testid="clip"][data-selected="yes"]').count()).toBe(1)
  })
})

describe('the transport', () => {
  // A new project, a clip brought in and put on twice: more than the default ten seconds on a busy machine.
  beforeEach(fresh, 30_000)

  it('names each key in its tooltips', async () => {
    expect(await page.getAttribute('[data-testid="play-pause"]', 'title')).toBe('Play (Space)')
    expect(await page.getAttribute('[data-testid="home"]', 'title')).toBe('Go to start (Home)')
    expect(await page.getAttribute('[data-testid="end"]', 'title')).toBe('Go to end (End)')
    expect(await page.getAttribute('[data-testid="view-program"]', 'title')).toContain('(V)')
  })

  // Audit 2026-10-01: a clip can be chosen without the mouse.
  it('selects the next and previous clip on the track with ] and [', async () => {
    const selected = (): Promise<string | null> => page.getAttribute('[data-testid="clip"][data-selected="yes"]', 'data-clip-id')
    const ids = await page.locator('[data-testid="clip"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-clip-id')))
    await page.keyboard.press('BracketRight')
    await expect.poll(selected).toBe(ids[0])
    await page.keyboard.press('BracketRight')
    await expect.poll(selected).toBe(ids[1])
    await waitPlayhead(120)
    await page.keyboard.press('BracketLeft')
    await expect.poll(selected).toBe(ids[0])
    await waitPlayhead(0)
  })

  it('goes to the end with its End button', async () => {
    await page.click('[data-testid="end"]')
    await waitPlayhead(240)
  })

  it('goes where a typed time says, in every form it takes', async () => {
    const typeAndGo = async (text: string, frame: number): Promise<void> => {
      await page.click('[data-testid="monitor-timecode"]')
      await page.fill('[data-testid="timecode-input"]', text)
      await page.press('[data-testid="timecode-input"]', 'Enter')
      await waitPlayhead(frame)
      await page.waitForSelector('[data-testid="timecode-input"]', { state: 'detached' })
    }
    await typeAndGo('0:02', 60)
    await typeAndGo('3s', 90)
    await typeAndGo('0:01:15', 45)
    await typeAndGo('100f', 100)
    await typeAndGo('00:00:05:10', 160)
  })

  it('keeps a time it cannot read, marked', async () => {
    await page.click('[data-testid="monitor-timecode"]')
    await page.fill('[data-testid="timecode-input"]', 'soon')
    await page.press('[data-testid="timecode-input"]', 'Enter')
    expect(await page.getAttribute('[data-testid="timecode-input"]', 'aria-invalid')).toBe('true')
    await page.press('[data-testid="timecode-input"]', 'Escape')
    await page.waitForSelector('[data-testid="timecode-input"]', { state: 'detached' })
  })

  it('goes nowhere when Escape leaves a time typed, and gives focus back to the timecode', async () => {
    await page.click('[data-testid="monitor-timecode"]')
    await page.fill('[data-testid="timecode-input"]', '3s')
    await page.press('[data-testid="timecode-input"]', 'Escape')
    await page.waitForSelector('[data-testid="timecode-input"]', { state: 'detached' })
    await page.waitForTimeout(300)
    expect(await page.getAttribute('[data-testid="timecode"]', 'data-playhead')).toBe('0')
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'monitor-timecode')
  })

  it('turns the preview down without touching a single clip, and says so on its own button', async () => {
    /** Every clip's volume in the project, so nothing about the edit can move unseen. */
    const gains = (): Promise<number[]> =>
      page.evaluate(async () =>
        (await window.api.currentProject()).sequences.flatMap((s) =>
          s.audioTracks.flatMap((r) => r.clips.map((c) => c.gain))
        )
      )
    const before = await gains()
    expect(before.length).toBeGreaterThan(0)
    const changedBefore = await page.getAttribute('[data-testid="project-name"]', 'data-changed')

    await page.click('[data-testid="monitor-volume"]')
    await page.waitForSelector('[data-testid="monitor-volume-level"]', WAIT)
    await page.locator('[data-testid="monitor-volume-level"]').fill('40')
    await expect.poll(() => page.getAttribute('[data-testid="monitor-volume"]', 'data-volume'), WAIT).toBe('40')

    // The whole point: listening quieter is not an edit.
    expect(await gains()).toEqual(before)
    expect(await page.getAttribute('[data-testid="project-name"]', 'data-changed')).toBe(changedBefore)

    // A control turned down has to look turned down, or it gets left there.
    expect(await page.textContent('[data-testid="monitor-volume"]')).toContain('40%')

    await page.click('[data-testid="monitor-volume-full"]')
    await expect.poll(() => page.getAttribute('[data-testid="monitor-volume"]', 'data-volume'), WAIT).toBe('100')
    await page.keyboard.press('Escape')
  })

  it('shows which view is on with a pressed button', async () => {
    expect(await page.getAttribute('[data-testid="view-source"]', 'aria-pressed')).toBe('true')
    await page.click('[data-testid="view-program"]')
    expect(await page.getAttribute('[data-testid="view-program"]', 'aria-pressed')).toBe('true')
    expect(await page.getAttribute('[data-testid="view-source"]', 'aria-pressed')).toBe('false')
    await page.click('[data-testid="view-source"]')
  })
})

describe('the monitor', () => {
  // A new project, a clip brought in and put on twice: more than the default ten seconds on a busy machine.
  beforeEach(fresh, 30_000)

  it('says which view it shows, and no more (task 60)', async () => {
    // Side by side on this vertical sequence: one caption, on the Source side, says what both are,
    // so none covers the frame on the Output side.
    expect(await page.locator('[data-testid="monitor-caption"]').count()).toBe(1)
    expect(await page.textContent('[data-testid="monitor-caption"]')).toBe(
      'Left, the source. Right, the output 1080x1920'
    )
    // Above the pictures, in the room kept for it, not over either (bugs and notes 2, note 30).
    const caption = (await page.locator('[data-testid="monitor-caption"]').boundingBox())!
    for (const side of ['source', 'program']) {
      const box = (await page.locator(`[data-testid="monitor-side"][data-side="${side}"]`).boundingBox())!
      expect(caption.y + caption.height).toBeLessThanOrEqual(box.y + 1)
    }
    // One at a time, the monitor says which it shows.
    await page.click('[data-testid="side-by-side"]')
    await page.waitForSelector('[data-testid="monitor-stage"][data-both="no"]')
    expect(await page.textContent('[data-testid="monitor-caption"]')).toBe('Source')
    await page.click('[data-testid="view-program"]')
    expect(await page.textContent('[data-testid="monitor-caption"]')).toBe('Output 1080x1920')
    await page.click('[data-testid="view-source"]')
    await page.click('[data-testid="side-by-side"]')
    await page.waitForSelector('[data-testid="monitor-stage"][data-both="yes"]')
  })

  it('outlines the output frame in the Output view, in its shape', async () => {
    // One view at a time, so the Source view shows no frame to outline.
    await page.click('[data-testid="side-by-side"]')
    await page.waitForSelector('[data-testid="monitor-stage"][data-both="no"]')
    expect(await page.locator('[data-testid="frame-outline"]').count()).toBe(0)
    await page.click('[data-testid="view-program"]')
    await page.waitForSelector('[data-testid="frame-outline"]')
    expect(await page.getAttribute('[data-testid="frame-outline"]', 'data-frame')).toBe('1080x1920')
    const box = await page.locator('[data-testid="frame-outline"]').boundingBox()
    expect(box!.width / box!.height).toBeCloseTo(1080 / 1920, 1)
    // Seen, not only placed: its left line, two pixels out from the frame, is
    // lighter than the black on either side of it.
    const midY = box!.y + box!.height / 2
    await expect.poll(() => lightnessAt(box!.x + 0.5, midY), { timeout: 10_000 }).toBeGreaterThan(25)
    expect(await lightnessAt(box!.x - 4, midY)).toBeLessThan(10)
    // Around the frame, which fits the monitor: no bigger than the monitor and its own few pixels.
    const stage = await page.locator('[data-testid="monitor-stage"]').boundingBox()
    expect(box!.height).toBeLessThanOrEqual(stage!.height + 8)
    // Both side by side again, as the window starts; the button is off for a landscape frame.
    await page.click('[data-testid="side-by-side"]')
    await page.waitForSelector('[data-testid="monitor-stage"][data-both="yes"]')

    await page.selectOption('[data-testid="export-preset"]', 'landscape')
    await page.waitForFunction(() => document.querySelector('[data-testid="frame-outline"]')?.getAttribute('data-frame') === '1920x1080')
    await page.click('[data-testid="view-source"]')
  })
})

describe('keys after a tab is clicked', () => {
  // A new project, a clip brought in and put on twice: more than the default ten seconds on a busy machine.
  beforeEach(fresh, 30_000)

  it('Space still plays: a clicked tab does not keep it', async () => {
    await page.click('[data-testid="sequence-duplicate"]')
    await waitTabs(2)
    await tab('Vertical').click()
    await page.waitForFunction(
      () => document.querySelector('[data-testid="sequence-tab"][data-active="yes"] [data-testid="sequence-name"]')?.textContent === 'Vertical'
    )
    await page.keyboard.press('Home')
    await waitPlayhead(0)
    await page.keyboard.press('Space')
    await page.waitForFunction(() => document.querySelector('[data-testid="play-pause"]')?.getAttribute('data-playing') === 'yes')
    await page.keyboard.press('Space')
    await page.waitForFunction(() => document.querySelector('[data-testid="play-pause"]')?.getAttribute('data-playing') === 'no')
  })
})

describe('the record button and its settings', () => {
  it('reads as one split control, sharing a border rather than sitting apart', async () => {
    const record = (await page.locator('[data-testid="record"]').boundingBox())!
    const chevron = (await page.locator('[data-testid="record-menu-toggle"]').boundingBox())!

    // Touching, not spaced: the chevron starts where the button ends.
    expect(Math.abs(chevron.x - (record.x + record.width))).toBeLessThan(2)
    // The same height, or the shared border would step.
    expect(Math.abs(chevron.height - record.height)).toBeLessThan(2)
    expect(Math.abs(chevron.y - record.y)).toBeLessThan(2)

    // And the join is drawn: square where they meet, round on the outside.
    const corners = await page.evaluate(() => {
      const box = (id: string): CSSStyleDeclaration =>
        getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!)
      const left = box('record')
      const right = box('record-menu-toggle')
      return {
        leftOuter: left.borderTopLeftRadius,
        leftInner: left.borderTopRightRadius,
        rightInner: right.borderTopLeftRadius,
        rightOuter: right.borderTopRightRadius,
        rightBorderLeft: right.borderLeftWidth
      }
    })
    expect(Number.parseFloat(corners.leftInner)).toBe(0)
    expect(Number.parseFloat(corners.rightInner)).toBe(0)
    expect(Number.parseFloat(corners.leftOuter)).toBeGreaterThan(0)
    expect(Number.parseFloat(corners.rightOuter)).toBeGreaterThan(0)
    // One border between them, not two.
    expect(Number.parseFloat(corners.rightBorderLeft)).toBe(0)
  })
})
