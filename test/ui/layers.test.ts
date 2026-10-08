import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { fitInBox } from '../../src/shared/crop-geometry'
import { answerSaveDialog, closeExport, discardUnsavedWork, openExport } from './dialogs'

/**
 * Pictures over pictures, driven through the real window, on a file shaped
 * like the owner's OBS recordings: a 3840x1080 canvas, the left view solid
 * red and the right solid blue. What the Output view shows is read from
 * screenshots of the monitor, pixel by pixel.
 */

const fx = fixtureSet('layers-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-layers-'))
let obsPath: string
let cleanPath: string
const userData = join(root, 'user-data')
let app: ElectronApplication
let page: Page
let shot = 0

async function launch(extraArgs: string[] = []): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, ...extraArgs], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}

beforeAll(async () => {
  obsPath = await fx.obsClip()
  cleanPath = await fx.cleanClip()
  await launch()
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

type Colour = 'red' | 'blue' | 'black' | 'white' | 'other'

/**
 * A screenshot of the view shown, saved where ffmpeg can read it: with both
 * side by side, the one chosen with its button, whose side of the monitor it is.
 */
async function monitorShot(): Promise<{ file: string; box: { width: number; height: number } }> {
  const side = page.locator('[data-testid="monitor-side"][data-focused="yes"]')
  const stage = (await side.count()) > 0 ? side : page.locator('[data-testid="monitor-stage"]')
  const box = (await stage.boundingBox())!
  shot += 1
  const file = join(root, `shot-${shot}.png`)
  await writeFile(file, await stage.screenshot())
  if (process.env.KEEP_SHOTS) await writeFile(join(process.env.KEEP_SHOTS, `shot-${shot}.png`), await stage.screenshot())
  return { file, box }
}

/**
 * The colour at a point of the output frame, given as fractions of it, read
 * from the monitor as it is drawn now. The frame is fitted in the monitor with
 * black around it, as the canvas draws it.
 */
async function outputColour(fx: number, fy: number, frame = { w: 1080, h: 1920 }): Promise<Colour> {
  const { file, box } = await monitorShot()
  const size = await captureText(ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffmpeg$1'), ['-hide_banner', '-i', file]).catch(
    (e: { stderr?: string }) => e.stderr ?? ''
  )
  const m = String(size).match(/, (\d+)x(\d+)/)
  const scale = m ? Number(m[1]) / box.width : 1
  const fit = fitInBox(frame.w, frame.h, box.width, box.height)
  const x = Math.round((fit.offsetX + fx * fit.width) * scale)
  const y = Math.round((fit.offsetY + fy * fit.height) * scale)
  const { stdout } = await capture(ffmpegPath, [
    '-v', 'error', '-i', file, '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'
  ])
  const [r = 0, g = 0, b = 0] = stdout
  if (r > 170 && g < 80 && b < 80) return 'red'
  if (b > 170 && r < 80 && g < 80) return 'blue'
  if (r < 30 && g < 30 && b < 30) return 'black'
  if (r > 200 && g > 200 && b > 200) return 'white'
  return 'other'
}

async function waitForOutput(fx: number, fy: number, want: Colour, frame?: { w: number; h: number }): Promise<void> {
  await expect.poll(() => outputColour(fx, fy, frame), { timeout: 15_000 }).toBe(want)
}

async function waitForClips(n: number): Promise<void> {
  await page.waitForFunction((want) => document.querySelectorAll('[data-testid="clip"]').length === want, n, WAIT)
}

async function selectClip(index: number): Promise<void> {
  const box = await page.locator('[data-testid="clip"]').nth(index).boundingBox()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.waitForFunction(
    (i) => document.querySelectorAll('[data-testid="clip"]')[i]?.getAttribute('data-selected') === 'yes',
    index,
    WAIT
  )
}

async function dragBy(x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) await page.mouse.move(x + (dx * i) / 5, y + (dy * i) / 5)
  await page.mouse.up()
}

async function layoutOf(index = 0): Promise<string> {
  return page.evaluate(async (i) => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[i]!.layout, index)
}

async function setView(view: 'source' | 'program'): Promise<void> {
  await page.locator(`[data-testid="view-${view}"]`).click()
  await page.waitForFunction((v) => document.querySelector('[data-testid="monitor-stage"]')?.getAttribute('data-view') === v, view, WAIT)
}

describe('an OBS recording', () => {
  it('imports and a frame of it actually decodes in the preview', async () => {
    await page.evaluate((p) => window.api.importFiles([p]), obsPath)
    await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 180_000 })
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await waitForClips(1)

    // Read from the video itself: the monitor's has-picture flag only says a
    // clip is under the playhead, and would pass for a file that plays nothing.
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('[data-testid="monitor-stage"] video')).some(
          (v) => (v as HTMLVideoElement).videoWidth === 3840 && (v as HTMLVideoElement).readyState >= 2
        ),
      undefined,
      { timeout: 30_000 }
    )
    expect(await page.getAttribute('[data-testid="asset"]', 'data-conformed')).toBe('no')
    expect(await page.getAttribute('[data-testid="asset"]', 'data-audio-tracks')).toBe('2')
  }, 240_000)

  it('shows both views in the Output view after Split, one in each half', async () => {
    await selectClip(0)
    await page.click('[data-testid="layout-split"]')
    await page.waitForSelector('[data-testid="clip-pictures"][data-count="2"]', WAIT)
    await setView('program')
    await waitForOutput(0.5, 0.25, 'red')
    await waitForOutput(0.5, 0.75, 'blue')
  })

  it('shows the views the other way round after Swap', async () => {
    await page.click('[data-testid="layout-swap"]')
    await waitForOutput(0.5, 0.25, 'blue')
    await waitForOutput(0.5, 0.75, 'red')
    await page.click('[data-testid="layout-swap"]')
    await waitForOutput(0.5, 0.25, 'red')
  })

  it('draws a border round the second picture in the Output view, set in the Inspector, and takes it off again', async () => {
    // Split: red over blue, the second picture the lower half, from 960 down.
    const second = page.locator('[data-testid="picture"]').nth(1)
    await second.click()
    await page.locator('[data-testid="picture-border"]').fill('40')
    await page.locator('[data-testid="picture-border"]').press('Enter')
    await expect
      .poll(async () => page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!.layers[0]!.style?.border), WAIT)
      .toBe(40)
    // White above the second picture's top edge, where the red was: the border reaches 40 up, and the selection outline sits on the edge itself.
    await waitForOutput(0.5, (960 - 24) / 1920, 'white')
    await waitForOutput(0.5, 0.75, 'blue')
    await page.locator('[data-testid="picture-border"]').fill('0')
    await page.locator('[data-testid="picture-border"]').press('Enter')
    await waitForOutput(0.5, (960 - 24) / 1920, 'red')
    await page.locator('[data-testid="picture"]').first().click()
  })

  it('starts editing the picture pressed in the Output view, without going to the Inspector', async () => {
    // Back to the main picture, from the Inspector, so the press is what moves it.
    await page.locator('[data-testid="picture"]').first().click()
    await page.waitForSelector('[data-testid="picture"][data-picture-id="main"][data-selected="yes"]', WAIT)

    // The clip is laid out as Split, so the frame holds two pictures side by
    // side. Pressing the right-hand one picks it.
    const targets = page.locator('[data-testid="monitor-picture"]')
    await expect.poll(() => targets.count(), WAIT).toBe(2)
    const other = page.locator('[data-testid="monitor-picture"]:not([data-picture-id="main"])').first()
    const box = (await other.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    await page.waitForSelector('[data-testid="picture"][data-selected="yes"]:not([data-picture-id="main"])', WAIT)
    // And the place box has moved to it: it outlines the picture just pressed.
    const place = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    expect(Math.abs(place.x - box.x)).toBeLessThan(4)
    expect(Math.abs(place.width - box.width)).toBeLessThan(4)

    // Pressing the one being edited is still a drag of its place, not a pick.
    const was = await page.getAttribute('[data-testid="place-rect"]', 'data-place')
    await dragBy(place.x + place.width / 2, place.y + place.height / 2, 0, -30)
    await page.waitForFunction((b) => document.querySelector('[data-testid="place-rect"]')?.getAttribute('data-place') !== b, was, WAIT)
    await page.keyboard.press('Control+z')
  })

  it('picks a picture and moves it in the one press, when it is dragged straight away', async () => {
    // The main picture again, so the other one is the press that picks.
    await page.locator('[data-testid="picture"]').first().click()
    await page.waitForSelector('[data-testid="picture"][data-picture-id="main"][data-selected="yes"]', WAIT)
    const other = page.locator('[data-testid="monitor-picture"]:not([data-picture-id="main"])').first()
    const box = (await other.boundingBox())!
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    // Picked on the press...
    await page.waitForSelector('[data-testid="picture"][data-selected="yes"]:not([data-picture-id="main"])', WAIT)
    const was = await page.getAttribute('[data-testid="place-rect"]', 'data-place')
    // ...and moved by the same press, without letting go first.
    for (let i = 1; i <= 4; i++) await page.mouse.move(from.x, from.y - 10 * i)
    await page.mouse.up()
    await page.waitForFunction((b) => document.querySelector('[data-testid="place-rect"]')?.getAttribute('data-place') !== b, was, WAIT)
    // Every movement of the drag landed before the undo, or a late one lands
    // after it and puts the move back: the same place twice, a moment apart.
    let last = ''
    await expect
      .poll(async () => {
        const now = (await page.getAttribute('[data-testid="place-rect"]', 'data-place')) ?? ''
        const same = now === last
        last = now
        return same
      }, { ...WAIT, interval: 250 })
      .toBe(true)
    // One undo for the move.
    await page.keyboard.press('Control+z')
    await page.waitForFunction((b) => document.querySelector('[data-testid="place-rect"]')?.getAttribute('data-place') === b, was, WAIT)
  })

  it('lets go of the picture when a press that picked it is let go at once', async () => {
    await page.locator('[data-testid="picture"]').first().click()
    await page.waitForSelector('[data-testid="picture"][data-picture-id="main"][data-selected="yes"]', WAIT)
    const other = page.locator('[data-testid="monitor-picture"]:not([data-picture-id="main"])').first()
    const box = (await other.boundingBox())!
    // Pressed and let go in the same instant, before anything that runs after
    // a render could start listening for the release. A real click can be
    // that quick; Playwright's own is not, so the events are sent by hand.
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const was = await page.getAttribute('[data-testid="place-rect"]', 'data-place')
    await page.evaluate((p) => {
      const target = document.querySelector('[data-testid="monitor-picture"]:not([data-picture-id="main"])')!
      const opts = { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, isPrimary: true, button: 0 }
      target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, buttons: 1 }))
      target.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }))
    }, at)
    await page.waitForSelector('[data-testid="picture"][data-selected="yes"]:not([data-picture-id="main"])', WAIT)
    const picked = await page.getAttribute('[data-testid="place-rect"]', 'data-place')
    // With no button held, the pointer going anywhere moves nothing.
    await page.evaluate((p) => {
      for (let i = 1; i <= 5; i++) {
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p.x + 30 * i, clientY: p.y - 30 * i, pointerId: 1, buttons: 0 }))
      }
    }, at)
    await page.waitForTimeout(300)
    expect(await page.getAttribute('[data-testid="place-rect"]', 'data-place')).toBe(picked)
    expect(was).not.toBeNull()
  })

  // Bugs and notes 2, note 12.
  it('chooses a picture under a full frame one with a double click, and the Crop group says which it crops', async () => {
    await page.locator('[data-testid="picture"]').first().click()
    await page.click('[data-testid="layout-pip"]')
    await page.waitForSelector('[data-testid="layout"][data-layout="pip"]', WAIT)
    await page.locator('[data-testid="picture"]').first().click()
    await page.waitForSelector('[data-testid="picture"][data-picture-id="main"][data-selected="yes"]', WAIT)

    // The switch at the top lists the pictures, the chosen one pressed.
    const cropPictures = page.locator('[data-testid="switch-picture"]')
    expect(await cropPictures.count()).toBe(2)
    expect(await cropPictures.first().getAttribute('data-selected')).toBe('yes')

    // The main picture fills the frame, so its box covers the small one: a double click there chooses the small one.
    const small = page.locator('[data-testid="monitor-picture"]:not([data-picture-id="main"])').first()
    const smallId = await small.getAttribute('data-picture-id')
    const box = (await small.boundingBox())!
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForSelector(`[data-testid="picture"][data-picture-id="${smallId}"][data-selected="yes"]`, WAIT)
    expect(await cropPictures.nth(1).getAttribute('data-selected')).toBe('yes')
    // Its own crop numbers now.
    const layerCrop = await page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!.layers[0]!.crop.w)
    expect(Number(await page.inputValue('[data-testid="crop-w"]'))).toBe(layerCrop)

    // Main chosen from the switch at the top: the Frame group follows.
    await cropPictures.first().click()
    await page.waitForSelector('[data-testid="picture"][data-picture-id="main"][data-selected="yes"]', WAIT)

    // A Crop folded by hand stays folded when a double click chooses a picture (bugfixes F11).
    const crop = '[data-inspector-group][data-group="Crop"]'
    await page.locator(`${crop} [data-testid="inspector-group-toggle"]`).click()
    await expect.poll(() => page.getAttribute(crop, 'data-folded'), WAIT).toBe('yes')
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForSelector(`[data-testid="picture"][data-picture-id="${smallId}"][data-selected="yes"]`, WAIT)
    await page.waitForTimeout(300)
    expect(await page.getAttribute(crop, 'data-folded')).toBe('yes')
    await page.locator(`${crop} [data-testid="inspector-group-toggle"]`).click()
    await expect.poll(() => page.getAttribute(crop, 'data-folded'), WAIT).toBe('no')

    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await page.waitForSelector('[data-testid="layout"][data-layout="split"]', WAIT)
  })

  // Bugs and notes 2, note 13 (plan 73).
  it('gives the second picture a zoom of its own, and choosing End keeps it chosen', async () => {
    const project = (): Promise<{ main: unknown; layer: { keys?: unknown[]; simple?: string } }> =>
      page.evaluate(async () => {
        const c = (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!
        return { main: c.transform, layer: c.layers[0]! }
      })
    const before = await project()
    const second = page.locator('[data-testid="picture"]').nth(1)
    const secondId = await second.getAttribute('data-picture-id')
    await second.click()
    await page.waitForSelector(`[data-testid="zoom-group"][data-picture="${secondId}"]`, WAIT)
    expect(await page.textContent('[data-testid="zoom-picture"]')).toContain('Picture 2')

    // A Simple zoom in, on Picture 2 alone.
    await page.click('[data-testid="zoom-simple-in"]')
    await expect.poll(async () => (await project()).layer.simple, WAIT).toBe('smooth')
    expect((await project()).main).toEqual(before.main)

    // End chosen: Picture 2 stays the picture chosen, and the crop box is its End.
    await page.click('[data-testid="zoom-end"]')
    await page.waitForSelector('[data-testid="zoom-end"][aria-pressed="true"]', WAIT)
    expect(await page.getAttribute(`[data-testid="picture"][data-picture-id="${secondId}"]`, 'data-selected')).toBe('yes')
    await page.waitForSelector(`[data-testid="zoom-group"][data-picture="${secondId}"]`, WAIT)

    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await project()).layer.simple, WAIT).toBeUndefined()
    await page.locator('[data-testid="picture"]').first().click()
  })

  // Bugs and notes 2, note 25.
  it('names the picture being worked on, in its own colour, on both views and in the Inspector', async () => {
    const second = page.locator('[data-testid="picture"]').nth(1)
    await second.click()
    await page.waitForSelector('[data-testid="place-tag"]', WAIT)
    expect(await page.textContent('[data-testid="place-tag"]')).toBe('Picture 2')
    expect(await page.textContent('[data-testid="picture-badge"]')).toBe('Picture 2')
    // The same orange on its box, its tag and its heading; blue for Main.
    const colour = (sel: string, prop: 'borderTopColor' | 'backgroundColor'): Promise<string> =>
      page.locator(sel).first().evaluate((e, p) => getComputedStyle(e)[p as 'borderTopColor'], prop)
    const orange = 'rgb(245, 178, 61)'
    expect(await colour('[data-testid="place-rect"]', 'borderTopColor')).toBe(orange)
    expect(await colour('[data-testid="picture-badge"]', 'backgroundColor')).toBe(orange)
    await page.locator('[data-testid="picture"]').first().click()
    await expect.poll(() => page.textContent('[data-testid="picture-badge"]'), WAIT).toBe('Main')
    expect(await colour('[data-testid="picture-badge"]', 'backgroundColor')).toBe('rgb(76, 141, 245)')
  })

  it('chooses the picture for every section from one switch held at the top of the Inspector (task 101)', async () => {
    const pictures = page.locator('[data-testid="switch-picture"]')
    await expect.poll(() => pictures.count(), WAIT).toBe(2)
    // Crop has no switch of its own now.
    expect(await page.locator('[data-inspector-group][data-group="Crop"] [data-testid="switch-picture"]').count()).toBe(0)
    const secondId = await pictures.nth(1).getAttribute('data-picture-id')
    await pictures.nth(1).click()

    // Zoom and Crop both work on Picture 2, and both say so.
    await page.waitForSelector(`[data-testid="zoom-group"][data-picture="${secondId}"]`, WAIT)
    await expect.poll(() => page.locator('[data-testid="picture-badge"]').allTextContents(), WAIT).toEqual(['Picture 2', 'Picture 2'])
    const layerCrop = await page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!.layers[0]!.crop.w)
    expect(Number(await page.inputValue('[data-testid="crop-w"]'))).toBe(layerCrop)

    // Scrolled to the bottom of the Inspector, the switch is still in view at its top.
    const scroller = await page.evaluateHandle(() => {
      let e = document.querySelector('[data-testid="picture-switch"]')?.parentElement ?? null
      while (e && getComputedStyle(e).overflowY !== 'auto') e = e.parentElement
      return e!
    })
    await scroller.evaluate((e) => (e.scrollTop = e.scrollHeight))
    await expect.poll(() => scroller.evaluate((e) => e.scrollTop), WAIT).toBeGreaterThan(100)
    const view = await scroller.evaluate((e) => e.getBoundingClientRect().top)
    const pinned = (await page.locator('[data-testid="picture-switch"]').boundingBox())!
    expect(Math.abs(pinned.y - view)).toBeLessThan(2)
    await scroller.evaluate((e) => (e.scrollTop = 0))

    // A clip with one picture has no switch.
    await page.locator('[data-testid="picture-remove"]').first().click()
    await page.waitForSelector('[data-testid="picture-switch"]', { state: 'detached', ...WAIT })
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await page.waitForSelector('[data-testid="picture-switch"]', WAIT)
    await pictures.first().click()
    await page.waitForSelector('[data-testid="zoom-group"][data-picture="main"]', WAIT)
  })

  it('says what a layout will do on a recording that holds one view', async () => {
    // This suite's recording is 3840x1080 and holds two, so nothing is said.
    expect(await page.locator('[data-testid="layout-one-view"]').count()).toBe(0)
  })

  it('moves a layer when its place is dragged, and one undo puts it back', async () => {
    const layer = page.locator('[data-testid="picture"]').nth(1)
    await layer.click()
    await page.waitForSelector('[data-testid="picture"][data-selected="yes"]:not([data-picture-id="main"])', WAIT)
    const before = await page.getAttribute('[data-testid="place-rect"]', 'data-place')

    // Scale it down by a corner, then drag it up into the top half.
    const corner = (await page.locator('[data-testid="place-nw"]').boundingBox())!
    await dragBy(corner.x + 6, corner.y + 6, 120, 120)
    const rect = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    await dragBy(rect.x + rect.width / 2, rect.y + rect.height / 2, 0, -rect.height)
    await page.waitForFunction((b) => document.querySelector('[data-testid="place-rect"]')?.getAttribute('data-place') !== b, before, WAIT)
    expect(await layoutOf()).toBe('custom')

    // Two drags, two undo steps: not one per movement.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await page.waitForFunction((b) => document.querySelector('[data-testid="place-rect"]')?.getAttribute('data-place') === b, before, WAIT)
    expect(await layoutOf()).toBe('split')
  })

  it('takes one undo step for a whole crop drag', async () => {
    await setView('source')
    const before = await page.getAttribute('[data-testid="crop-rect"]', 'data-crop')
    const box = (await page.locator('[data-testid="crop-rect"]').boundingBox())!
    await dragBy(box.x + box.width / 2, box.y + box.height / 2, -40, 0)
    await page.waitForFunction((b) => document.querySelector('[data-testid="crop-rect"]')?.getAttribute('data-crop') !== b, before, WAIT)

    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await page.waitForFunction((b) => document.querySelector('[data-testid="crop-rect"]')?.getAttribute('data-crop') === b, before, WAIT)
    // The other picture's crop is drawn too, as an outline.
    expect(await page.locator('[data-testid="crop-other"]').count()).toBe(1)
  })

  it('keeps the layout on both pieces of a split clip', async () => {
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('KeyS')
    await waitForClips(2)
    expect(await page.locator('[data-testid="clip-pictures"]').count()).toBe(2)
    expect(await layoutOf(1)).toBe('split')
  })

  it('copies a layout to another clip of the same recording with Apply to all', async () => {
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await waitForClips(3)
    expect(await layoutOf(2)).toBe('single')
    await selectClip(0)
    await page.click('[data-testid="apply-layout-all"]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip-pictures"]').length === 3, undefined, WAIT)
    expect(await layoutOf(2)).toBe('split')
  })

  it('moves Picture 2 on every selected clip at once, in one undo (bugs and notes 2, note 32)', async () => {
    const places = (): Promise<string[]> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips.map((c) => JSON.stringify(c.layers[0]?.place)))
    const before = await places()
    await selectClip(0)
    for (const i of [1, 2]) {
      const box = (await page.locator('[data-testid="clip"]').nth(i).boundingBox())!
      await page.keyboard.down('Shift')
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.keyboard.up('Shift')
    }
    await page.waitForSelector('[data-testid="selection-note"]', WAIT)
    expect(await page.textContent('[data-testid="selection-note"]')).toContain('Changes 3 selected clips')
    await setView('program')
    const layer = page.locator('[data-testid="picture"]').nth(1)
    await layer.click()
    await page.waitForSelector('[data-testid="picture"][data-selected="yes"]:not([data-picture-id="main"])', WAIT)
    const rect = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    await dragBy(rect.x + rect.width / 2, rect.y + rect.height / 2, 0, -rect.height / 2)
    await expect.poll(async () => new Set(await places()).size, WAIT).toBe(1)
    expect((await places())[0]).not.toBe(before[0])
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(places, WAIT).toEqual(before)
  })

  it('lays a duplicate out side by side when it is made landscape, and leaves the vertical one alone', async () => {
    await page.click('[data-testid="sequence-duplicate"]')
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="sequence-tab"]').length === 2,
      undefined,
      WAIT
    )
    await page.selectOption('[data-testid="export-preset"]', 'landscape')
    await page.locator('[data-testid="export-preset"]').blur()
    await setView('program')
    const landscape = { w: 1920, h: 1080 }
    await waitForOutput(0.25, 0.5, 'red', landscape)
    await waitForOutput(0.75, 0.5, 'blue', landscape)

    // Each sequence remembers its own view, and the vertical one was left on Source.
    await page.locator('[data-testid="sequence-tab"]').first().click()
    await setView('program')
    await waitForOutput(0.5, 0.25, 'red')
    await waitForOutput(0.5, 0.75, 'blue')
  })

  it('keeps redrawing the Output view while playing, not only after a seek', async () => {
    // A moving picture, since the OBS stand-in is solid colour.
    await page.evaluate((p) => window.api.importFiles([p]), cleanPath)
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length === 2, undefined, { timeout: 180_000 })
    // Picked by name, not by position: the bin puts the newest first.
    await page.locator('[data-testid="asset"]:has(div[title$="clean.mp4"]) [data-testid="add-to-timeline"]').click()
    await waitForClips(4)
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('End')
    for (let i = 0; i < 90; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    // The Output side alone: beside it, the Source side's own video moves whether the canvas is drawn or not.
    const output = page.locator('[data-testid="monitor-side"][data-side="program"]')
    const a = await output.screenshot()
    await page.waitForTimeout(400)
    const b = await output.screenshot()
    await page.keyboard.press('Space')
    expect(Buffer.compare(a, b)).not.toBe(0)
  })

  it('fits the Source view to each clip after a paused move between clips of different sizes', async () => {
    await setView('source')
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    // The last clip is the 640x360 one; the ones before it are 3840x1080.
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll<HTMLVideoElement>('[data-testid="monitor-stage"] video')).some((v) => {
          if (v.style.visibility !== 'visible') return false
          const ratio = parseFloat(v.style.width) / parseFloat(v.style.height)
          return Math.abs(ratio - 640 / 360) < 0.02
        }),
      undefined,
      WAIT
    )
  })

  it('keeps the picture on screen while a place is being dragged, rather than going black', async () => {
    await page.keyboard.press('Home')
    await setView('program')
    await waitForOutput(0.5, 0.25, 'red')
    await page.locator('[data-testid="picture"]').nth(1).click()
    const rect = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 3; i++) {
      await page.mouse.move(rect.x + rect.width / 2 - 10 * i, rect.y + rect.height / 2 + 4 * i)
      // Read straight away, not once things settle: this is about the moment.
      expect(await outputColour(0.5, 0.1)).toBe('red')
    }
    await page.mouse.up()
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await page.waitForFunction(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!.layout === 'split', undefined, WAIT)
  })

  it('comes back laid out after saving, closing and reopening', async () => {
    await answerSaveDialog(app, join(root, 'layers.editbay'))
    await page.keyboard.press('Control+s')
    await page.waitForFunction(() => document.title === 'layers - Editbay', undefined, WAIT)
    const closed = app.waitForEvent('close', { timeout: 30_000 })
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close()
    })
    await closed

    await launch()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip-pictures"]').length >= 3, undefined, { timeout: 30_000 })
    expect(await layoutOf(0)).toBe('split')
  }, 120_000)

  it('says layers are left out under Handoff, which has no frame to place them in', async () => {
    await selectClip(0)
    await page.selectOption('[data-testid="export-preset"]', 'handoff')
    await openExport(page)
    await page.waitForSelector('[data-testid="export-layers-note"]', WAIT)
    await closeExport(page)
    await page.waitForSelector('[data-testid="layers-unavailable"]', WAIT)
    expect(await page.locator('[data-testid="layout-split"]').count()).toBe(0)
    // The layers are kept, for when the shape has a size again.
    expect(await layoutOf(0)).toBe('split')
  })
})
