import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { closeExport, discardUnsavedWork } from './dialogs'

/**
 * Plan 13, step 4: reframing. Guides and safe zones over the Output view,
 * boxes that snap to the centre and the edges, full screen, keys for all of
 * it, nudging, typed crop numbers, the halves of a wide recording, and one
 * clip's framing pasted onto another.
 */

const fx = fixtureSet('ui-reframing')
/** A GitHub Mac, where the hidden test window cannot go full screen. */
const HIDDEN_MAC = process.platform === 'darwin' && !!process.env.CI
const root = await mkdtemp(join(tmpdir(), 'editbay-reframing-'))
let app: ElectronApplication
let page: Page
let cleanPath: string
/** 3840x1080, red on the left and blue on the right, as OBS records two views side by side. */
let obsPath: string

beforeAll(async () => {
  cleanPath = await fx.cleanClip()
  obsPath = await fx.obsClip()
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

/** A new project with the clean clip on V1, its picture selected, in the Source view. */
async function fresh(source?: string): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  // A new project starts on the shape chosen last, and offers the framing used last: these tests start from Vertical, unframed.
  await page.evaluate(() => window.api.setAppSettings({ lastShape: 'vertical', lastFraming: null }))
  await page.keyboard.press('ControlOrMeta+n')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0)
  await page.evaluate((p) => window.api.importFiles([p]), source ?? cleanPath)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]')
  const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
  await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
  await page.waitForSelector('[data-testid="picture-clip-panel"]')
  await page.keyboard.press('Home')
  if ((await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')) !== 'source') await page.click('[data-testid="view-source"]')
}

async function rgbAt(x: number, y: number): Promise<[number, number, number]> {
  const stage = page.locator('[data-testid="monitor-stage"]')
  const box = (await stage.boundingBox())!
  const file = join(root, `shot-${Date.now()}.png`)
  await writeFile(file, await stage.screenshot())
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const size = String(probe).match(/, (\d+)x(\d+)/)
  const scale = size ? Number(size[1]) / box.width : 1
  const px = Math.round((x - box.x) * scale)
  const py = Math.round((y - box.y) * scale)
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${px}:${py},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  return [stdout[0] ?? 0, stdout[1] ?? 0, stdout[2] ?? 0]
}

async function openGuides(): Promise<void> {
  if ((await page.locator('[data-testid="guides-menu"]').count()) === 0) await page.click('[data-testid="guides-toggle"]')
  await page.waitForSelector('[data-testid="guides-menu"]')
}

async function closeGuides(): Promise<void> {
  if ((await page.locator('[data-testid="guides-menu"]').count()) > 0) await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="guides-menu"]', { state: 'detached' })
}

/** Where a crop is, from its box's own report. */
async function crop(): Promise<{ x: number; y: number; w: number; h: number }> {
  const [x, y, w, h] = ((await page.getAttribute('[data-testid="crop-rect"]', 'data-crop')) ?? '').split(',').map(Number)
  return { x: x!, y: y!, w: w!, h: h! }
}

/** Drag from a point by an offset in steps, with Alt held when asked. */
async function drag(x: number, y: number, dx: number, dy: number, alt = false): Promise<void> {
  if (alt) await page.keyboard.down('Alt')
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6)
  await page.mouse.up()
  if (alt) await page.keyboard.up('Alt')
}

/** Guides off, thirds on, every app's safe zone: the window's defaults, whatever a test before left. */
async function defaultGuides(): Promise<void> {
  await openGuides()
  await page.check('[data-testid="guides-thirds"]')
  await page.check('[data-testid="guides-safe"][data-choice="all"]')
  await page.uncheck('[data-testid="guides-show"]')
  await closeGuides()
}

describe('guides', () => {
  beforeEach(async () => {
    await fresh()
    await defaultGuides()
  })

  it('draws the centre, the thirds and every app’s safe zone over the Output view, when turned on', async () => {
    await page.click('[data-testid="view-program"]')
    expect(await page.locator('[data-testid="guides"]').count()).toBe(0)
    await openGuides()
    await page.check('[data-testid="guides-show"]')
    await closeGuides()
    await page.waitForSelector('[data-testid="guides"]')
    expect(await page.getAttribute('[data-testid="guides"]', 'data-thirds')).toBe('yes')
    expect(await page.getAttribute('[data-testid="guides"]', 'data-safe')).toBe('all')
    expect(await page.locator('[data-testid="safe-shade"]').count()).toBe(4)
  })

  it('turns Centre and thirds on with the guides when nothing else is ticked, from the menu and from G (task 58)', async () => {
    await page.click('[data-testid="view-program"]')
    // Nothing ticked: on with thirds alone, then thirds off and no safe zone, then off.
    const nothingTicked = async (): Promise<void> => {
      await openGuides()
      await page.click('[data-testid="guides-thirds"]')
      await page.uncheck('[data-testid="guides-thirds"]')
      await page.check('[data-testid="guides-safe"][data-choice="none"]')
      await page.uncheck('[data-testid="guides-show"]')
    }
    await nothingTicked()
    expect(await page.isChecked('[data-testid="guides-thirds"]')).toBe(false)
    await page.check('[data-testid="guides-show"]')
    expect(await page.isChecked('[data-testid="guides-thirds"]')).toBe(true)
    await closeGuides()
    await page.waitForSelector('[data-testid="guides"][data-thirds="yes"]')
    expect(await page.locator('[data-testid="guides"] [data-testid="guide-line"]').count()).toBe(6)

    await nothingTicked()
    await closeGuides()
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('g')
    await page.waitForSelector('[data-testid="guides"][data-thirds="yes"]')
    expect(await page.locator('[data-testid="guides"] [data-testid="guide-line"]').count()).toBe(6)
  })

  it('turns the guides on with what is clicked, from the settings a new window starts with', async () => {
    // Guides off, thirds on, all three apps: the first click on either should show them.
    await page.click('[data-testid="view-program"]')
    await openGuides()
    await page.click('[data-testid="guides-safe"][data-choice="all"]')
    await closeGuides()
    await page.waitForSelector('[data-testid="guides"]')
    expect(await page.getAttribute('[data-testid="guides"]', 'data-safe')).toBe('all')
    expect(await page.getAttribute('[data-testid="guides"]', 'data-thirds')).toBe('no')

    await defaultGuides()
    await openGuides()
    await page.click('[data-testid="guides-thirds"]')
    await closeGuides()
    await page.waitForSelector('[data-testid="guides"]')
    expect(await page.getAttribute('[data-testid="guides"]', 'data-thirds')).toBe('yes')
    expect(await page.getAttribute('[data-testid="guides"]', 'data-safe')).toBe('none')
  })

  it('shades what the chosen app covers, and shows it on screen', async () => {
    await page.click('[data-testid="view-program"]')
    const frame = (await page.locator('[data-testid="frame-outline"]').boundingBox())!
    // Inside the frame, near its top, where every app puts something, and off
    // the centre and thirds lines.
    // Off to the right, clear of the chip naming the app, which sits at the
    // left of the same band: over the chip the shading is what is under it.
    const x = frame.x + frame.width * 0.85
    const y = frame.y + frame.height * 0.04
    const before = await rgbAt(x, y)
    await openGuides()
    await page.check('[data-testid="guides-safe"][data-choice="tiktok"]')
    await closeGuides()
    await page.waitForFunction(() => document.querySelector('[data-testid="guides"]')?.getAttribute('data-safe') === 'tiktok')
    const after = await rgbAt(x, y)
    // Tinted red: more red against green than before.
    expect(after[0] - after[1]).toBeGreaterThan(before[0] - before[1] + 15)
  })

  it('shows no safe zone on a frame that is not vertical, and says so rather than offering the choice', async () => {
    await page.selectOption('[data-testid="export-preset"]', 'landscape')
    await page.waitForFunction(() => (document.querySelector('[data-testid="export-preset"]') as HTMLSelectElement).value === 'landscape')
    await page.click('[data-testid="view-program"]')
    await openGuides()

    // The apps' areas cannot take effect here, so they cannot be picked, and
    // the menu says why rather than leaving you to work it out from nothing
    // happening.
    const choices = page.locator('[data-testid="guides-safe"]')
    expect(await choices.count()).toBeGreaterThan(1)
    for (const disabled of await choices.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).disabled))) {
      expect(disabled).toBe(true)
    }
    expect(await page.textContent('[data-testid="guides-not-vertical"]')).toContain('taller than it is wide')

    // Centre and thirds are about composing a shot and apply to any frame, so
    // they stay live.
    expect(await page.isDisabled('[data-testid="guides-thirds"]')).toBe(false)

    await page.check('[data-testid="guides-show"]')
    await closeGuides()
    await page.waitForSelector('[data-testid="guides"]')
    expect(await page.getAttribute('[data-testid="guides"]', 'data-safe')).toBe('none')
    expect(await page.locator('[data-testid="safe-shade"]').count()).toBe(0)
  })

  it('offers the areas again on a vertical frame, with nothing in the way', async () => {
    await openGuides()
    expect(await page.locator('[data-testid="guides-not-vertical"]').count()).toBe(0)
    expect(await page.isDisabled('[data-testid="guides-safe"][data-choice="tiktok"]')).toBe(false)
    await closeGuides()
  })

  it('remembers the choice after a reload', async () => {
    await openGuides()
    await page.check('[data-testid="guides-show"]')
    await page.check('[data-testid="guides-safe"][data-choice="reels"]')
    await closeGuides()
    await page.reload()
    await page.waitForSelector('main')
    await page.click('[data-testid="view-program"]')
    await page.waitForSelector('[data-testid="guides"]')
    expect(await page.getAttribute('[data-testid="guides"]', 'data-safe')).toBe('reels')
    // Leave them off for whatever runs next.
    await openGuides()
    await page.uncheck('[data-testid="guides-show"]')
    await closeGuides()
  })
})

describe('a recording that holds one view', () => {
  it('says what Split and Picture in picture will do on it, rather than letting them look broken', async () => {
    await fresh()
    await page.locator('[data-testid="clip"]').first().click()
    await page.waitForSelector('[data-testid="layout-split"]', { timeout: 10_000 })

    // This suite's recording is 640x360, which holds one view.
    // On hover over its "?", which opens the layouts tutorial (task 60).
    const said = await page.getAttribute('[data-testid="layout-one-view"]', 'title')
    expect(said).toContain('640x360')
    expect(said).toContain('same shot')

    // Said, not taken away: both still give the clip two pictures to crop apart.
    expect(await page.isDisabled('[data-testid="layout-split"]')).toBe(false)
    expect(await page.isDisabled('[data-testid="layout-pip"]')).toBe(false)
  })
})

describe('snapping', () => {
  beforeEach(() => fresh())

  it('pulls a crop moved near the middle of the source back onto it, unless Alt is held', async () => {
    // The clean clip is 640x360, and a vertical crop starts centred on it.
    const start = await crop()
    expect(Math.abs(start.x + start.w / 2 - 320)).toBeLessThanOrEqual(1)
    const box = (await page.locator('[data-testid="crop-rect"]').boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // A few screen pixels to the side: still within reach of the centre, so it
    // stays there, to the pixel that crops on even pixels allow.
    await drag(cx, cy, 4, 0)
    await page.waitForTimeout(300)
    expect(Math.abs((await crop()).x + start.w / 2 - 320)).toBeLessThanOrEqual(1)

    // The same with Alt: it moves.
    await drag(cx, cy, 4, 0, true)
    await page.waitForFunction((was) => {
      const [x] = (document.querySelector('[data-testid="crop-rect"]')?.getAttribute('data-crop') ?? '').split(',').map(Number)
      return x !== was
    }, start.x)
  })

  it('pulls a place moved near the frame’s centre line onto it', async () => {
    await page.click('[data-testid="layout-pip"]')
    await page.waitForFunction(() => document.querySelector('[data-testid="layout"]')?.getAttribute('data-layout') === 'pip')
    await page.locator('[data-testid="picture"]').nth(1).click()
    await page.click('[data-testid="view-program"]')
    await page.waitForSelector('[data-testid="place-rect"]')
    const frame = (await page.locator('[data-testid="frame-outline"]').boundingBox())!
    const place = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    const midFrame = frame.x + frame.width / 2
    const midPlace = place.x + place.width / 2
    // Drag the box's centre to 3 screen pixels short of the frame's centre line.
    await drag(midPlace, place.y + place.height / 2, midFrame - midPlace + 3, 0)
    await page.waitForFunction(() => {
      const [x, , w] = (document.querySelector('[data-testid="place-rect"]')?.getAttribute('data-place') ?? '').split(',').map(Number)
      return Math.abs(x! + w! / 2 - 0.5) < 0.002
    })

    // With Alt it lands where it was dropped, a few pixels off the line.
    const onLine = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    await drag(onLine.x + onLine.width / 2, onLine.y + onLine.height / 2, 3, 0, true)
    await page.waitForFunction(() => {
      const [x, , w] = (document.querySelector('[data-testid="place-rect"]')?.getAttribute('data-place') ?? '').split(',').map(Number)
      return x! + w! / 2 - 0.5 > 0.002
    })
  })
})

/** Where the edited place is, from its box's own report, as fractions of the frame. */
async function place(): Promise<{ x: number; y: number; w: number; h: number }> {
  const [x, y, w, h] = ((await page.getAttribute('[data-testid="place-rect"]', 'data-place')) ?? '').split(',').map(Number)
  return { x: x!, y: y!, w: w!, h: h! }
}

/** Wait until the crop box reports `x`. */
async function cropXIs(x: number): Promise<void> {
  await page.waitForFunction(
    (want) => Number((document.querySelector('[data-testid="crop-rect"]')?.getAttribute('data-crop') ?? '').split(',')[0]) === want,
    x
  )
}

describe('keys', () => {
  beforeEach(() => fresh())

  // A window kept hidden never finishes going full screen on a Mac, so GitHub's Macs skip it (task 1388).
  it.skipIf(HIDDEN_MAC)('G shows and hides the guides, and F puts the monitor on the whole screen and back', async () => {
    await page.click('[data-testid="view-program"]')
    const shown = (await page.locator('[data-testid="guides"]').count()) > 0
    await page.keyboard.press('g')
    await page.waitForFunction((was) => (document.querySelector('[data-testid="guides"]') !== null) !== was, shown)
    await page.keyboard.press('g')
    await page.waitForFunction((was) => (document.querySelector('[data-testid="guides"]') !== null) === was, shown)
    await page.keyboard.press('f')
    await page.waitForSelector('[data-testid="monitor-stage"][data-fullscreen="yes"]')
    await page.keyboard.press('f')
    await page.waitForSelector('[data-testid="monitor-stage"][data-fullscreen="no"]')
    await page.waitForFunction(() => document.fullscreenElement === null)
  })

  it('nudges the crop by 2 pixels, or 20 with Shift, and a quick run of nudges is one undo step', async () => {
    const start = await crop()
    await page.keyboard.press('Alt+ArrowLeft')
    await cropXIs(start.x - 2)
    await page.keyboard.press('Alt+Shift+ArrowLeft')
    await cropXIs(start.x - 22)
    await page.keyboard.press('ControlOrMeta+z')
    await cropXIs(start.x)

    // Apart by more than a second: two steps, and one undo takes back only the second.
    await page.keyboard.press('Alt+ArrowLeft')
    await cropXIs(start.x - 2)
    await page.waitForTimeout(1200)
    await page.keyboard.press('Alt+ArrowLeft')
    await cropXIs(start.x - 4)
    await page.keyboard.press('ControlOrMeta+z')
    await cropXIs(start.x - 2)
  })

  it('builds each nudge on the last, however fast they come', async () => {
    const start = await crop()
    // Five presses before the first has come back from the document.
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft', altKey: true }))
      }
    })
    await cropXIs(start.x - 10)
    await page.keyboard.press('ControlOrMeta+z')
    await cropXIs(start.x)
  })

  it('nudges with Alt and an arrow even while a dropdown has focus, which keeps the bare arrows', async () => {
    const start = await crop()
    await page.focus('[data-testid="export-preset"]')
    await page.keyboard.press('Alt+ArrowLeft')
    await cropXIs(start.x - 2)
  })

  it('makes no edit for a nudge that cannot move the picture, so its layout stays named', async () => {
    await page.click('[data-testid="layout-pip"]')
    await page.waitForFunction(() => document.querySelector('[data-testid="layout"]')?.getAttribute('data-layout') === 'pip')
    await page.locator('[data-testid="picture"]').nth(1).click()
    await page.click('[data-testid="view-program"]')
    await page.waitForSelector('[data-testid="place-rect"]')
    expect((await place()).y).toBe(0)
    const shown = (await page.locator('[data-testid="guides"]').count()) > 0
    await page.keyboard.press('Alt+ArrowUp')
    // Keys are taken in turn: once G has shown or hidden the guides, the nudge before it is done.
    await page.keyboard.press('g')
    await page.waitForFunction((was) => (document.querySelector('[data-testid="guides"]') !== null) !== was, shown)
    expect(await page.getAttribute('[data-testid="layout"]', 'data-layout')).toBe('pip')
    await page.keyboard.press('g')
    // Nor an undo step: one undo takes back the layout itself.
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForFunction(() => document.querySelector('[data-testid="layout"]')?.getAttribute('data-layout') === 'single')
  })

  it('edits the main picture again once the shape has no frame, which leaves the layers out', async () => {
    const main = await crop()
    await page.click('[data-testid="layout-pip"]')
    await page.waitForFunction(() => document.querySelector('[data-testid="layout"]')?.getAttribute('data-layout') === 'pip')
    await page.locator('[data-testid="picture"]').nth(1).click()
    await page.waitForFunction(
      (x) => (document.querySelector('[data-testid="crop-x"]') as HTMLInputElement | null)?.value !== String(x),
      main.x
    )
    await page.selectOption('[data-testid="export-preset"]', 'handoff')
    await page.waitForFunction(
      (x) => (document.querySelector('[data-testid="crop-x"]') as HTMLInputElement | null)?.value === String(x),
      main.x
    )
  })

  it('nudges the place in the Output view', async () => {
    await page.click('[data-testid="layout-pip"]')
    await page.waitForFunction(() => document.querySelector('[data-testid="layout"]')?.getAttribute('data-layout') === 'pip')
    await page.locator('[data-testid="picture"]').nth(1).click()
    await page.click('[data-testid="view-program"]')
    await page.waitForSelector('[data-testid="place-rect"]')
    const before = await place()
    // Down, since a picture in picture starts in the top corner.
    await page.keyboard.press('Alt+Shift+ArrowDown')
    await page.waitForFunction(
      (y) => Number((document.querySelector('[data-testid="place-rect"]')?.getAttribute('data-place') ?? '').split(',')[1]) > y + 0.005,
      before.y
    )
    // 20 output pixels of a 1920 high frame.
    expect(((await place()).y - before.y) * 1920).toBeCloseTo(20, 0)
  })

  it('copies one clip’s framing and pastes it onto another, with an Undo', async () => {
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === 2)
    await page.click('[data-testid="layout-pip"]')
    await page.waitForFunction(() => document.querySelector('[data-testid="layout"]')?.getAttribute('data-layout') === 'pip')
    await page.keyboard.press('ControlOrMeta+Alt+c')
    await page.waitForSelector('[data-testid="toast"][data-kind="framing"]')

    const second = (await page.locator('[data-testid="clip"][data-kind="video"]').nth(1).boundingBox())!
    await page.mouse.click(second.x + second.width / 2, second.y + second.height / 2)
    await page.waitForFunction(() => document.querySelector('[data-testid="layout"]')?.getAttribute('data-layout') === 'single')
    await page.keyboard.press('ControlOrMeta+Alt+v')
    await page.waitForFunction(() => document.querySelector('[data-testid="layout"]')?.getAttribute('data-layout') === 'pip')
    await page.click('[data-testid="toast"][data-kind="setFraming"] [data-testid="toast-undo"]')
    await page.waitForFunction(() => document.querySelector('[data-testid="layout"]')?.getAttribute('data-layout') === 'single')
  })

  it('copies a clip’s crop alone and pastes it onto another, leaving its layout, with one undo', async () => {
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === 2)
    await page.fill('[data-testid="crop-w"]', '200')
    await page.press('[data-testid="crop-w"]', 'Enter')
    await page.waitForFunction(() => (document.querySelector('[data-testid="crop-w"]') as HTMLInputElement).value === '200')
    const copied = await crop()
    expect(await page.isDisabled('[data-testid="crop-paste"]')).toBe(true)
    await page.click('[data-testid="crop-copy"]')
    await page.waitForSelector('[data-testid="toast"][data-kind="crop"]')

    const second = (await page.locator('[data-testid="clip"][data-kind="video"]').nth(1).boundingBox())!
    await page.mouse.click(second.x + second.width / 2, second.y + second.height / 2)
    await page.click('[data-testid="layout-pip"]')
    await page.waitForFunction(() => document.querySelector('[data-testid="layout"]')?.getAttribute('data-layout') === 'pip')
    await page.click('[data-testid="picture"][data-picture-id="main"]')
    const own = await crop()
    expect(own).not.toEqual(copied)
    await page.click('[data-testid="crop-paste"]')
    await page.waitForFunction((w) => (document.querySelector('[data-testid="crop-w"]') as HTMLInputElement).value === String(w), copied.w)
    expect(await crop()).toEqual(copied)
    // The crop alone: the layout stays the one this clip had.
    expect(await page.getAttribute('[data-testid="layout"]', 'data-layout')).toBe('pip')
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForFunction((w) => (document.querySelector('[data-testid="crop-w"]') as HTMLInputElement).value === String(w), own.w)
    expect(await page.getAttribute('[data-testid="layout"]', 'data-layout')).toBe('pip')
  })

  it('pastes Picture 2’s crop onto the next clip’s Picture 2, leaving its main crop, with Picture 2 still chosen (task 95)', async () => {
    /** The crops of the second clip on V1, its main picture's and its Picture 2's. */
    const crops = (): Promise<{ main: string; second: string }> =>
      page.evaluate(async () => {
        const c = (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[1]!
        const s = (r: { x: number; y: number; w: number; h: number }): string => [r.x, r.y, r.w, r.h].join(',')
        return { main: s(c.transform.crop), second: s(c.layers[0]!.crop) }
      })
    const chosen = (): Promise<string | null> =>
      page.getAttribute('[data-testid="switch-picture"][data-selected="yes"]', 'data-picture-id').then((id) => (id === 'main' ? 'main' : id && 'layer'))
    const clips = page.locator('[data-testid="clip"][data-kind="video"]')
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === 2)
    const second = (await clips.nth(1).boundingBox())!
    await page.mouse.click(second.x + second.width / 2, second.y + second.height / 2)
    await page.click('[data-testid="layout-pip"]')
    await page.waitForFunction(() => document.querySelector('[data-testid="layout"]')?.getAttribute('data-layout') === 'pip')
    const first = (await clips.nth(0).boundingBox())!
    await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2)
    await page.click('[data-testid="layout-pip"]')
    await page.waitForFunction(() => document.querySelector('[data-testid="layout"]')?.getAttribute('data-layout') === 'pip')

    // Picture 2 of the first clip, cropped to its own width and copied.
    await page.locator('[data-testid="switch-picture"]').nth(1).click()
    expect(await chosen()).toBe('layer')
    await page.fill('[data-testid="crop-w"]', '300')
    await page.press('[data-testid="crop-w"]', 'Enter')
    await page.waitForFunction(() => (document.querySelector('[data-testid="crop-w"]') as HTMLInputElement).value === '300')
    const copied = await crop()
    await page.click('[data-testid="crop-copy"]')
    await page.waitForSelector('[data-testid="toast"][data-kind="crop"]')

    await page.mouse.click(second.x + second.width / 2, second.y + second.height / 2)
    // The second clip's own Picture 2 crop, shown once it is selected.
    await page.waitForFunction(() => (document.querySelector('[data-testid="crop-w"]') as HTMLInputElement).value !== '300')
    expect(await chosen()).toBe('layer')
    const before = await crops()
    await page.click('[data-testid="crop-paste"]')
    await expect.poll(async () => (await crops()).second).toBe([copied.x, copied.y, copied.w, copied.h].join(','))
    expect((await crops()).main).toBe(before.main)
    expect(await chosen()).toBe('layer')
  })
})

describe('the crop in numbers', () => {
  beforeEach(() => fresh())

  const focused = (): Promise<string | null> => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)

  it('puts a typed number on the picture as the typing pauses, and one undo takes the whole visit back', async () => {
    const before = await crop()
    await page.click('[data-testid="crop-x"]')
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('10')
    await cropXIs(10)
    await page.keyboard.type('0')
    await cropXIs(100)
    // Still typing: the field kept its focus all along.
    expect(await focused()).toBe('crop-x')
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('ControlOrMeta+z')
    await cropXIs(before.x)
    expect(await crop()).toEqual(before)
  })

  it('never rewrites a number while it is typed, and tidies it on leaving', async () => {
    await page.click('[data-testid="crop-x"]')
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('99')
    await cropXIs(100)
    expect(await page.inputValue('[data-testid="crop-x"]')).toBe('99')
    await page.locator('[data-testid="timecode"]').click()
    await page.waitForFunction(() => (document.querySelector('[data-testid="crop-x"]') as HTMLInputElement).value === '100')
  })

  it('puts back the crop it was entered with on Escape, after changes made while typing', async () => {
    const before = await crop()
    await page.click('[data-testid="crop-x"]')
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('40')
    await cropXIs(40)
    await page.keyboard.press('Escape')
    await cropXIs(before.x)
    expect(await crop()).toEqual(before)
    await page.waitForFunction(
      (x) => (document.querySelector('[data-testid="crop-x"]') as HTMLInputElement).value === String(x),
      before.x
    )
  })

  it('steps by 2 with the arrow keys, or 20 with Shift, at once', async () => {
    const before = await crop()
    await page.click('[data-testid="crop-x"]')
    await page.keyboard.press('ArrowUp')
    await cropXIs(before.x + 2)
    await page.keyboard.press('Shift+ArrowDown')
    await cropXIs(before.x - 18)
    expect(await focused()).toBe('crop-x')
  })

  it('takes a typed width, and with the lock on keeps the place’s shape', async () => {
    await page.fill('[data-testid="crop-w"]', '200')
    await page.press('[data-testid="crop-w"]', 'Enter')
    await page.waitForFunction(() => document.querySelector('[data-testid="crop-rect"]')?.getAttribute('data-crop')?.split(',')[2] === '200')
    const locked = await crop()
    // The vertical frame's shape, 9 by 16, to the even pixel.
    expect(Math.abs(locked.h - (200 * 16) / 9)).toBeLessThanOrEqual(2)

    await page.uncheck('[data-testid="aspect-lock"]')
    await page.fill('[data-testid="crop-h"]', '100')
    await page.press('[data-testid="crop-h"]', 'Enter')
    await page.waitForFunction(() => document.querySelector('[data-testid="crop-rect"]')?.getAttribute('data-crop')?.split(',')[3] === '100')
    expect((await crop()).w).toBe(200)
    await page.check('[data-testid="aspect-lock"]')
  })

  it('takes a Y past the edge as typed, and makes the crop shorter to fit, keeping its shape', async () => {
    // A vertical crop of the 640x360 clip is already full height: moved down, it gets shorter.
    const before = await crop()
    await page.fill('[data-testid="crop-y"]', '20')
    await page.press('[data-testid="crop-y"]', 'Enter')
    await page.waitForFunction(() => (document.querySelector('[data-testid="crop-y"]') as HTMLInputElement).value === '20')
    const after = await crop()
    expect(after.y).toBe(20)
    expect(after.h).toBe(340)
    // The lock is on: narrower too, the same shape.
    expect(Math.abs(after.w / after.h - before.w / before.h)).toBeLessThan(0.02)
  })

  it('puts back what was typed on Escape, changing nothing and keeping the selection', async () => {
    const before = await crop()
    await page.fill('[data-testid="crop-x"]', '300')
    await page.press('[data-testid="crop-x"]', 'Escape')
    await page.waitForFunction(
      (x) => (document.querySelector('[data-testid="crop-x"]') as HTMLInputElement).value === String(x),
      before.x
    )
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') !== 'crop-x')
    expect(await crop()).toEqual(before)
    expect(await page.locator('[data-testid="clip"][data-kind="video"][data-selected="yes"]').count()).toBe(1)
  })

  it('draws one box per field, ringed on its own edge when focused, with no browser arrows', async () => {
    await page.click('[data-testid="crop-x"]')
    const look = await page.evaluate(() => {
      const input = document.querySelector('[data-testid="crop-x"]') as HTMLInputElement
      const box = input.closest('.ui-field__box') as HTMLElement
      const own = getComputedStyle(input)
      return {
        inputRing: own.boxShadow,
        inputBorder: own.borderTopStyle,
        boxRing: getComputedStyle(box).boxShadow,
        // Drawn as a plain text field, which is what takes the arrows away.
        appearance: own.appearance
      }
    })
    expect(look.inputRing).toBe('none')
    expect(look.inputBorder).toBe('none')
    expect(look.boxRing).not.toBe('none')
    expect(look.appearance).toBe('textfield')
    await page.press('[data-testid="crop-x"]', 'Escape')
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') !== 'crop-x')
  })

  it('puts back a number it cannot use', async () => {
    const before = await crop()
    await page.fill('[data-testid="crop-x"]', '')
    await page.press('[data-testid="crop-x"]', 'Enter')
    expect(await page.inputValue('[data-testid="crop-x"]')).toBe(String(before.x))
    expect(await crop()).toEqual(before)
  })
})

describe('which choice is on', () => {
  const fill = (sel: string): Promise<string> => page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor)

  it('shows the layout and the place that apply, in one look for every control that has an on state', async () => {
    await fresh()
    await page.mouse.move(0, 0)
    expect(await page.getAttribute('[data-testid="layout-single"]', 'aria-pressed')).toBe('true')
    // On is a fill of its own, not only an outline.
    const on = await fill('[data-testid="layout-single"]')
    expect(await fill('[data-testid="layout-split"]')).not.toBe(on)
    // And the Source and Output switch says it the same way.
    expect(await fill('[data-testid="view"] [aria-pressed="true"]')).toBe(on)
  })
})

describe('the sides of the crop box', () => {
  const crop = async (): Promise<number[]> =>
    ((await page.getAttribute('[data-testid="crop-rect"]', 'data-crop')) ?? '').split(',').map(Number)

  it('has none while Lock to shape is on, and says so', async () => {
    await fresh()
    if (!(await page.locator('[data-testid="aspect-lock"]').isChecked())) await page.locator('[data-testid="aspect-lock"]').check()
    expect(await page.getAttribute('[data-testid="crop-rect"]', 'data-locked')).toBe('yes')
    expect(await page.locator('[data-testid="crop-s"]').count()).toBe(0)
    expect(await page.getAttribute('[data-testid="crop-rect"]', 'title')).toContain('Lock to shape is on')
  })

  it('changes the height alone from its bottom side once the lock is off', async () => {
    await page.locator('[data-testid="aspect-lock"]').uncheck()
    await page.waitForSelector('[data-testid="crop-s"]')
    const [, , w0, h0] = await crop()
    const side = (await page.locator('[data-testid="crop-s"]').boundingBox())!
    await page.mouse.move(side.x + side.width / 2, side.y + side.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 4; i++) await page.mouse.move(side.x + side.width / 2, side.y + side.height / 2 - 10 * i)
    await page.mouse.up()
    await expect.poll(async () => (await crop())[3], { timeout: 5000 }).toBeLessThan(h0!)
    expect((await crop())[2]).toBe(w0)
    await page.locator('[data-testid="aspect-lock"]').check()
  })
})

describe('a look on a clip', () => {
  /** The middle of the Output view's canvas, as the screen shows it. */
  async function middle(): Promise<[number, number, number]> {
    const box = (await page.locator('[data-testid="program-canvas"]').boundingBox())!
    return rgbAt(box.x + box.width / 2, box.y + box.height / 2)
  }
  const spread = ([r, g, b]: [number, number, number]): number => Math.max(r, g, b) - Math.min(r, g, b)

  it('turns the Output view black and white, and gives the colour back', async () => {
    await fresh(obsPath)
    await page.click('[data-testid="view-program"]')
    const says = (): Promise<string | null> => page.getAttribute('[data-testid="clip-look"]', 'data-look')
    expect(await says()).toBe('none')
    // Solid red or blue, whichever view the crop is on: plainly a colour.
    await expect.poll(async () => spread(await middle()), { timeout: 10_000 }).toBeGreaterThan(100)

    await page.locator('[data-testid="look-select"]').selectOption('mono')
    await expect.poll(says, { timeout: 5000 }).toBe('mono')
    await expect.poll(async () => spread(await middle()), { timeout: 5000 }).toBeLessThanOrEqual(6)
    // Grey rather than black: the brightness is still there.
    expect((await middle())[0]).toBeGreaterThan(20)
    expect(await page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!.look)).toBe('mono')

    await page.locator('[data-testid="look-select"]').selectOption('none')
    await expect.poll(says, { timeout: 5000 }).toBe('none')
    await expect.poll(async () => spread(await middle()), { timeout: 5000 }).toBeGreaterThan(100)
  })
})

describe('the halves of a wide recording', () => {
  beforeEach(() => fresh(obsPath))

  it('puts the crop on the left or the right camera with one click', async () => {
    await page.click('[data-testid="crop-right-view"]')
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="crop-rect"]')?.getAttribute('data-crop')?.split(',')[0]) >= 1920)
    const right = await crop()
    expect(right.x + right.w).toBeLessThanOrEqual(3840)
    // With the lock on, the vertical frame's shape, centred on the camera.
    expect(Math.abs(right.w / right.h - 9 / 16)).toBeLessThan(0.01)
    expect(Math.abs(right.x + right.w / 2 - 2880)).toBeLessThanOrEqual(2)
    await page.click('[data-testid="crop-left-view"]')
    await page.waitForFunction(() => {
      const [x, , w] = (document.querySelector('[data-testid="crop-rect"]')?.getAttribute('data-crop') ?? '').split(',').map(Number)
      return x! + w! <= 1920
    })
    const left = await crop()
    expect(Math.abs(left.x + left.w / 2 - 960)).toBeLessThanOrEqual(2)
    // With the lock off, the whole half.
    await page.uncheck('[data-testid="aspect-lock"]')
    await page.click('[data-testid="crop-right-view"]')
    await page.waitForFunction(() => document.querySelector('[data-testid="crop-rect"]')?.getAttribute('data-crop') === '1920,0,1920,1080')
    await page.check('[data-testid="aspect-lock"]')
  })
})

describe.skipIf(HIDDEN_MAC)('full screen', () => {
  beforeEach(() => fresh())

  it('puts the monitor on the whole screen, and Escape brings it back', async () => {
    await page.click('[data-testid="fullscreen"]')
    await page.waitForFunction(() => document.fullscreenElement?.getAttribute('data-testid') === 'monitor-stage')
    await page.waitForSelector('[data-testid="monitor-stage"][data-fullscreen="yes"]')
    // No caption in full screen: it is for watching.
    expect(await page.locator('[data-testid="monitor-caption"]').count()).toBe(0)
    // The whole window, not the monitor's own corner of it.
    const stage = (await page.locator('[data-testid="monitor-stage"]').boundingBox())!
    const view = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    expect(stage.width).toBeGreaterThanOrEqual(view.w - 1)
    expect(stage.height).toBeGreaterThanOrEqual(view.h - 1)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.fullscreenElement === null)
    await page.waitForSelector('[data-testid="monitor-stage"][data-fullscreen="no"]')
    expect(await page.locator('[data-testid="monitor-caption"]').count()).toBe(1)
    // Escape left full screen and nothing else: the clip is still selected.
    expect(await page.locator('[data-testid="clip"][data-kind="video"][data-selected="yes"]').count()).toBe(1)
  })

  it('gives way to a dialog opened from it, so the dialog can be seen', async () => {
    await page.click('[data-testid="fullscreen"]')
    await page.waitForSelector('[data-testid="monitor-stage"][data-fullscreen="yes"]')
    await page.keyboard.press('ControlOrMeta+e')
    await page.waitForFunction(() => document.fullscreenElement === null)
    await page.waitForSelector('[data-testid="monitor-stage"][data-fullscreen="no"]')
    expect(await page.locator('[data-testid="export-panel"]').isVisible()).toBe(true)
    await closeExport(page)
  })
})
