import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { fitInBox } from '../../src/shared/crop-geometry'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 16, driven through the real window: the Source and Output views side
 * by side on a vertical sequence, then Up and Down from cut to cut, and a
 * timeline that keeps the playhead in view.
 *
 * V1 holds a red recording with sound from 0 to 120, and V2, once added, a
 * green one without from 0 to 90, covering the whole frame.
 */

const fx = fixtureSet('faster-cutting-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-faster-cutting-'))
const userData = join(root, 'user-data')
let app: ElectronApplication
let page: Page
let shot = 0
const ids = { red: '', green: '' }

beforeAll(async () => {
  const [red, green] = [await fx.redClip(), await fx.greenClip()]
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  console.log('DBG size', JSON.stringify(await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]!; return [w.getSize(), w.getContentSize(), screen.getPrimaryDisplay().workArea] })))
  await discardUnsavedWork(app)
  const assets = await page.evaluate((p) => window.api.importFiles(p), [red, green])
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length === 2, undefined, {
    timeout: 180_000
  })
  ids.red = assets[0]!.id
  ids.green = assets[1]!.id
  await page.locator(`[data-testid="asset"][data-asset-id="${ids.red}"] [data-testid="add-to-timeline"]`).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === 1, undefined, WAIT)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

type Colour = 'red' | 'green' | 'black' | 'other'

/** The colour at a point of a picture of `frame`'s size fitted in one view's side of the monitor, as fractions of it. */
async function colourIn(side: 'source' | 'program', fx: number, fy: number, frame: { w: number; h: number }): Promise<Colour> {
  const el = page.locator(`[data-testid="monitor-side"][data-side="${side}"]`)
  const box = (await el.boundingBox())!
  shot += 1
  const file = join(root, `shot-${shot}.png`)
  await writeFile(file, await el.screenshot())
  const size = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const m = String(size).match(/, (\d+)x(\d+)/)
  const scale = m ? Number(m[1]) / box.width : 1
  const fit = fitInBox(frame.w, frame.h, box.width, box.height)
  const x = Math.round((fit.offsetX + fx * fit.width) * scale)
  const y = Math.round((fit.offsetY + fy * fit.height) * scale)
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  const [r = 0, g = 0, b = 0] = stdout
  if (r > 170 && g < 80 && b < 80) return 'red'
  if (g > 90 && r < 80 && b < 80) return 'green'
  if (r < 30 && g < 30 && b < 30) return 'black'
  return 'other'
}

async function boxOf(selector: string): Promise<{ x: number; y: number; width: number; height: number }> {
  return (await page.locator(selector).boundingBox())!
}

function inside(inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }): boolean {
  return inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1
}

/** A key pressed with nothing in particular focused, so it reaches the editor. */
async function press(key: string): Promise<void> {
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press(key)
}

const SOURCE = '[data-testid="monitor-side"][data-side="source"]'
const PROGRAM = '[data-testid="monitor-side"][data-side="program"]'

describe('the Source and Output side by side', () => {
  it('shows the recording on the left and the finished vertical frame on the right, each with its own box to drag', async () => {
    await page.waitForSelector('[data-testid="monitor-stage"][data-both="yes"]', WAIT)
    const source = await boxOf(SOURCE)
    const program = await boxOf(PROGRAM)
    expect(source.x + source.width).toBeLessThanOrEqual(program.x)
    // The Output side is the frame's shape at the monitor's height, inside the room kept round the
    // pictures (26 pixels above for the caption, 14 elsewhere), unless that would be more than half of it.
    const stage = await boxOf('[data-testid="monitor-stage"]')
    console.log('DBG boxes', JSON.stringify({ inner: await page.evaluate(() => [innerWidth, innerHeight]), stage, program, source, crop: await boxOf('[data-testid="crop-rect"]'), tc: await boxOf('[data-testid="timecode"]') }))
    expect(Math.abs(program.height - (stage.height - 40))).toBeLessThanOrEqual(1)
    expect(Math.abs(stage.x + stage.width - (program.x + program.width) - 14)).toBeLessThanOrEqual(1)
    expect(program.width).toBeLessThanOrEqual(stage.width / 2 + 1)
    if (program.width < stage.width / 2 - 1) expect(program.width / program.height).toBeCloseTo(1080 / 1920, 1)
    // The canvas is the Output side, and the crop and place boxes each in theirs.
    expect(inside(await boxOf('[data-testid="program-canvas"]'), program)).toBe(true)
    expect(inside(await boxOf('[data-testid="crop-rect"]'), source)).toBe(true)
    expect(inside(await boxOf('[data-testid="place-rect"]'), program)).toBe(true)
    await expect.poll(() => colourIn('source', 0.5, 0.5, { w: 640, h: 360 }), WAIT).toBe('red')
    await expect.poll(() => colourIn('program', 0.5, 0.5, { w: 1080, h: 1920 }), WAIT).toBe('red')
  })

  it('draws the picture on V2 on the Output side while the Source side shows the recording on V1', async () => {
    const track = '[data-testid="track"][data-kind="video"][data-index="1"]'
    await page.click('[data-testid="add-video-track"]')
    await page.waitForSelector(track, WAIT)
    const row = (await page.locator(track).boundingBox())!
    await page.dragAndDrop(`[data-testid="asset"][data-asset-id="${ids.green}"]`, track, { targetPosition: { x: 0.1, y: row.height / 2 } })
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === 2, undefined, WAIT)
    // Nothing selected: the Source side shows the lowest track's recording.
    await press('Escape')
    await press('Home')
    await expect.poll(() => colourIn('source', 0.5, 0.5, { w: 640, h: 360 }), WAIT).toBe('red')
    // The green video is laid out behind the canvas, and still gives the Output side its frames.
    await expect.poll(() => colourIn('program', 0.5, 0.5, { w: 1080, h: 1920 }), WAIT).toBe('green')

    // And goes on giving them while the sequence plays: a second of its 25 frames a second, counted.
    const v2 = await page.getAttribute(track, 'data-track-id')
    await page.evaluate((id) => {
      const w = window as unknown as { framesSeen: number }
      w.framesSeen = 0
      for (const v of Array.from(document.querySelectorAll(`video[data-testid="track-video"][data-track="${id}"]`)) as HTMLVideoElement[]) {
        const watch = (): void => {
          v.requestVideoFrameCallback(() => {
            w.framesSeen += 1
            watch()
          })
        }
        watch()
      }
    }, v2)
    await press('Space')
    await page.waitForTimeout(1000)
    await press('Space')
    expect(await page.evaluate(() => (window as unknown as { framesSeen: number }).framesSeen)).toBeGreaterThan(12)
    await press('Home')
  })

  it('acts with the keys on the view chosen, by V or a press in it, a nudge moving the crop or the place', async () => {
    await press('Escape')
    await press('Home')
    if ((await page.getAttribute(SOURCE, 'data-focused')) !== 'yes') await press('KeyV')
    await page.waitForSelector(`${SOURCE}[data-focused="yes"]`, WAIT)
    // The crop of V1's red recording, not yet moved; nothing selected, so the lowest track's clip is edited.
    const crop = await page.getAttribute('[data-testid="crop-rect"]', 'data-crop')
    await press('Alt+ArrowLeft')
    await page.waitForFunction((c) => document.querySelector('[data-testid="crop-rect"]')?.getAttribute('data-crop') !== c, crop, WAIT)

    // V moves the keys to the Output side, and the crop stays where it is.
    await press('KeyV')
    await page.waitForSelector(`${PROGRAM}[data-focused="yes"]`, WAIT)
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')).toBe('program')
    const moved = await page.getAttribute('[data-testid="crop-rect"]', 'data-crop')
    await press('Alt+ArrowLeft')
    await page.waitForTimeout(300)
    expect(await page.getAttribute('[data-testid="crop-rect"]', 'data-crop')).toBe(moved)

    // V2's picture made a small box in the corner, which has room to move: the nudge moves it, not its crop.
    const green = (await page.locator('[data-testid="track"][data-kind="video"][data-index="1"] [data-testid="clip"]').boundingBox())!
    await page.mouse.click(green.x + green.width / 2, green.y + green.height / 2)
    // Picture in picture turned on puts it in the corner box.
    await page.click('[data-testid="pip-on"]')
    await page.waitForSelector('[data-testid="pip-section"][data-on="yes"]', WAIT)
    await page.waitForSelector(`${PROGRAM}[data-focused="yes"]`, WAIT)
    const place = await page.getAttribute('[data-testid="place-rect"]', 'data-place')
    const greenCrop = await page.getAttribute('[data-testid="crop-rect"]', 'data-crop')
    await press('Alt+ArrowLeft')
    await page.waitForFunction((p) => document.querySelector('[data-testid="place-rect"]')?.getAttribute('data-place') !== p, place, WAIT)
    expect(await page.getAttribute('[data-testid="crop-rect"]', 'data-crop')).toBe(greenCrop)

    // A press on the Source side, away from the crop box, brings the keys back to it.
    const source = await boxOf(SOURCE)
    await page.mouse.click(source.x + 6, source.y + source.height - 6)
    await page.waitForSelector(`${SOURCE}[data-focused="yes"]`, WAIT)
    expect(await page.getAttribute('[data-testid="view-source"]', 'aria-pressed')).toBe('true')
    await press('ControlOrMeta+z')
  })

  it('shows one view at a time when Side by side is turned off, and both again when it is turned on', async () => {
    await page.click('[data-testid="side-by-side"]')
    await page.waitForSelector('[data-testid="monitor-stage"][data-both="no"]', WAIT)
    expect(await page.locator('[data-testid="monitor-side"]').count()).toBe(1)
    expect(await page.getAttribute('[data-testid="side-by-side"]', 'aria-pressed')).toBe('false')
    await page.click('[data-testid="side-by-side"]')
    await page.waitForSelector('[data-testid="monitor-stage"][data-both="yes"]', WAIT)
    expect(await page.locator('[data-testid="monitor-side"]').count()).toBe(2)
  })

  it('shows the view chosen alone on the whole screen', async () => {
    await page.click('[data-testid="fullscreen"]')
    await page.waitForSelector('[data-testid="monitor-stage"][data-fullscreen="yes"]', WAIT)
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-both')).toBe('no')
    expect(await page.locator('[data-testid="monitor-side"]').count()).toBe(1)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="monitor-stage"][data-fullscreen="no"]', WAIT)
    await page.waitForSelector('[data-testid="monitor-stage"][data-both="yes"]', WAIT)
    // Back to its size: a Mac brings the window back from the whole screen fitted to a small CI screen first (task 1388).
    await page.waitForFunction(() => window.innerWidth > 1300, undefined, WAIT)
  })

  it('shows one view at a time for a frame that is not taller than wide', async () => {
    await page.selectOption('[data-testid="export-preset"]', 'landscape')
    await page.waitForSelector('[data-testid="monitor-stage"][data-both="no"]', WAIT)
    expect(await page.locator('[data-testid="side-by-side"]').isDisabled()).toBe(true)
    await page.selectOption('[data-testid="export-preset"]', 'vertical')
    await page.waitForSelector('[data-testid="monitor-stage"][data-both="yes"]', WAIT)
  })
})

describe('jumping to a cut, and a timeline that keeps the playhead in view', () => {
  async function playhead(): Promise<number> {
    return Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
  }

  async function scrolled(): Promise<number> {
    return page.locator('[data-testid="timeline-scroll"]').evaluate((el) => el.scrollLeft)
  }

  it('goes from cut to cut with Down, and back with Up', async () => {
    // V1's red from 0 to 120 and V2's green from 0 to 90: cuts at 0, 90 and 120, the end.
    await press('Home')
    for (const want of [90, 120, 120]) {
      await press('ArrowDown')
      await expect.poll(playhead, WAIT).toBe(want)
    }
    for (const want of [90, 0, 0]) {
      await press('ArrowUp')
      await expect.poll(playhead, WAIT).toBe(want)
    }
  })

  it('leaves Up and Down to a focused set of radio buttons, which they move through', async () => {
    await press('Home')
    await page.click('[data-testid="guides-toggle"]')
    await page.click('[data-testid="guides-safe"][data-choice="tiktok"]')
    await page.waitForSelector('[data-testid="guides-safe"][data-choice="tiktok"]:checked', WAIT)
    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(() => document.querySelector('[data-testid="guides-safe"][data-choice="tiktok"]') instanceof HTMLInputElement && !(document.querySelector('[data-testid="guides-safe"][data-choice="tiktok"]') as HTMLInputElement).checked, undefined, WAIT)
    // The radio buttons moved on, and the playhead stayed where it was.
    expect(await playhead()).toBe(0)
    await page.keyboard.press('Escape')
    await page.click('[data-testid="guides-toggle"]')
    await page.click('[data-testid="guides-show"]')
    await page.keyboard.press('Escape')
  })

  it('scrolls to keep the playhead in view after a jump, and zooms about it', async () => {
    // Four more of the red recording on V1, to 600 frames, at the closest zoom.
    for (let n = 2; n <= 5; n++) {
      await page.locator(`[data-testid="asset"][data-asset-id="${ids.red}"] [data-testid="add-to-timeline"]`).click()
      await page.waitForFunction((want) => document.querySelectorAll('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').length === want, n, WAIT)
    }
    while (Number(await page.getAttribute('[data-testid="zoom-out"]', 'data-zoom')) < 9) await press('Equal')
    const view = await boxOf('[data-testid="timeline-scroll"]')
    const playheadX = async (): Promise<number> => (await boxOf('[data-testid="playhead-line"]')).x

    await press('End')
    await expect.poll(scrolled, WAIT).toBeGreaterThan(0)
    let x = await playheadX()
    expect(x).toBeGreaterThanOrEqual(view.x)
    expect(x).toBeLessThanOrEqual(view.x + view.width)

    await press('Home')
    await expect.poll(scrolled, WAIT).toBe(0)

    // Down to 360, off the right edge at this zoom: it comes into view.
    for (let i = 0; i < 4; i++) await press('ArrowDown')
    await expect.poll(playhead, WAIT).toBe(360)
    await expect.poll(scrolled, WAIT).toBeGreaterThan(0)
    x = await playheadX()
    expect(x).toBeGreaterThanOrEqual(view.x)
    expect(x).toBeLessThanOrEqual(view.x + view.width)

    // Zooming out keeps it where it is on screen.
    await press('Minus')
    await page.waitForSelector('[data-testid="zoom-out"][data-zoom="8"]', WAIT)
    await expect.poll(async () => Math.abs((await playheadX()) - x), WAIT).toBeLessThanOrEqual(2)
  })

  it('stays where it is while the playhead is dragged along the ruler close to its right edge', async () => {
    const before = await scrolled()
    const view = await boxOf('[data-testid="timeline-scroll"]')
    const ruler = await boxOf('[data-testid="ruler"]')
    const y = ruler.y + ruler.height / 2
    const x = view.x + view.width - 8
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 1, y)
    await page.mouse.move(x + 2, y)
    await page.mouse.up()
    // The playhead went where the pointer was, and the timeline did not run on under it.
    const at = await playhead()
    expect(at).toBeGreaterThan(0)
    expect(await scrolled()).toBe(before)
  })
})
