import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { fitInBox } from '../../src/shared/crop-geometry'
import { discardUnsavedWork } from './dialogs'

/**
 * Pictures on video rows, driven through the real window: V1 holds two solid
 * red clips, and a solid green one is laid over them. What the monitor shows
 * is read from screenshots, pixel by pixel.
 */

const fx = fixtureSet('pictures-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-pictures-'))
const userData = join(root, 'user-data')
let app: ElectronApplication
let page: Page
let shot = 0
const ids = { red: '', green: '', clean: '', counting: '' }
/** Pixels per frame at the zoom a new project starts at. */
const PX = 0.4

beforeAll(async () => {
  const [red, green, clean, counting] = [await fx.redClip(), await fx.greenClip(), await fx.cleanClip(), await fx.countingClip()]
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  const assets = await page.evaluate((p) => window.api.importFiles(p), [red, green, clean, counting])
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length === 4, undefined, {
    timeout: 180_000
  })
  ids.red = assets[0]!.id
  ids.green = assets[1]!.id
  ids.clean = assets[2]!.id
  ids.counting = assets[3]!.id
  for (let i = 0; i < 2; i++) {
    await page.locator(`[data-testid="asset"][data-asset-id="${ids.red}"] [data-testid="add-to-timeline"]`).click()
  }
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2, undefined, WAIT)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

type Colour = 'red' | 'green' | 'black' | 'other'

/** A screenshot of the view shown: with both side by side, the one chosen with its button, whose side of the monitor it is. */
async function monitorShot(): Promise<{ file: string; box: { width: number; height: number } }> {
  const side = page.locator('[data-testid="monitor-side"][data-focused="yes"]')
  const stage = (await side.count()) > 0 ? side : page.locator('[data-testid="monitor-stage"]')
  const box = (await stage.boundingBox())!
  shot += 1
  const file = join(root, `shot-${shot}.png`)
  await writeFile(file, await stage.screenshot())
  return { file, box }
}

/** How light the monitor is at a point of a frame of `frame`'s size fitted in it, 0 to 255. */
async function lightnessAt(fx: number, fy: number, frame: { w: number; h: number }): Promise<number> {
  const { file, box } = await monitorShot()
  const size = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const m = String(size).match(/, (\d+)x(\d+)/)
  const scale = m ? Number(m[1]) / box.width : 1
  const fit = fitInBox(frame.w, frame.h, box.width, box.height)
  const x = Math.round((fit.offsetX + fx * fit.width) * scale)
  const y = Math.round((fit.offsetY + fy * fit.height) * scale)
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${x}:${y},format=gray`, '-f', 'rawvideo', 'pipe:1'])
  return stdout[0] ?? 0
}

/** The colour at a point of a frame of `frame`'s size fitted in the monitor, as fractions of it. */
async function colourAt(fx: number, fy: number, frame: { w: number; h: number }): Promise<Colour> {
  const { file, box } = await monitorShot()
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

const VERTICAL = { w: 1080, h: 1920 }
const LANDSCAPE = { w: 1920, h: 1080 }
/** The middle of the frame, and a point inside the corner box in the top right. */
const MIDDLE = [0.5, 0.5] as const
const CORNER = [0.85, 0.04] as const

async function waitFor(point: readonly [number, number], want: Colour, frame = VERTICAL): Promise<void> {
  await expect.poll(() => colourAt(point[0], point[1], frame), { timeout: 15_000 }).toBe(want)
}

async function setView(view: 'source' | 'program'): Promise<void> {
  await page.locator(`[data-testid="view-${view}"]`).click()
  await page.waitForFunction((v) => document.querySelector('[data-testid="monitor-stage"]')?.getAttribute('data-view') === v, view, WAIT)
}

async function playheadAt(frame: number): Promise<void> {
  await page.waitForFunction((f) => document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead') === String(f), frame, WAIT)
}

async function focusTimeline(): Promise<void> {
  await page.locator('[data-testid="timecode"]').click()
}

/** The clips on V2, or on the video track numbered `index` from V1's 0. */
function onVideoTrack(index = 1): ReturnType<Page['locator']> {
  return page.locator(`[data-testid="track"][data-kind="video"][data-index="${index}"] [data-testid="clip"]`)
}

/**
 * Drag a source from the bin onto a video track, adding the track first when
 * it is not there, and let it go at `frame`.
 */
async function dropOnVideoTrack(assetId: string, index: number, frame: number): Promise<void> {
  const track = `[data-testid="track"][data-kind="video"][data-index="${index}"]`
  if ((await page.locator(track).count()) === 0) {
    await page.click('[data-testid="add-video-track"]')
    await page.waitForSelector(track, WAIT)
  }
  const box = (await page.locator(track).boundingBox())!
  await page.dragAndDrop(`[data-testid="asset"][data-asset-id="${assetId}"]`, track, {
    targetPosition: { x: frame * PX + 0.1, y: box.height / 2 }
  })
}

async function selectPicture(): Promise<void> {
  const box = (await onVideoTrack().first().boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForSelector('[data-testid="picture-clip-panel"]', WAIT)
}

async function placeOf(): Promise<string> {
  return (await page.getAttribute('[data-testid="place-rect"]', 'data-place')) ?? ''
}

describe('a picture on a video row', () => {
  it('covers the Output view when dropped on V2', async () => {
    await focusTimeline()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await playheadAt(30)
    await dropOnVideoTrack(ids.green, 1, 30)
    await page.waitForSelector('[data-testid="picture-clip-panel"]', WAIT)
    expect(await page.locator('[data-testid="track"][data-kind="video"]').count()).toBe(2)
    expect(await onVideoTrack().first().getAttribute('data-start')).toBe('30')
    await setView('program')
    await waitFor(MIDDLE, 'green')
  })

  it('moves to the corner box with Corner', async () => {
    // Picture in picture turned on puts it in the corner box.
    await page.click('[data-testid="pip-on"]')
    await page.waitForSelector('[data-testid="pip-section"][data-on="yes"]', WAIT)
    await waitFor(MIDDLE, 'red')
    await waitFor(CORNER, 'green')
  })

  it('shows its own recording in the Source view while it is selected, and V1\'s otherwise', async () => {
    await setView('source')
    await waitFor(MIDDLE, 'green', { w: 640, h: 360 })
    const v1 = (await page.locator('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').first().boundingBox())!
    await page.mouse.click(v1.x + v1.width / 2, v1.y + v1.height / 2)
    await waitFor(MIDDLE, 'red', { w: 640, h: 360 })
    await selectPicture()
    await waitFor(MIDDLE, 'green', { w: 640, h: 360 })
  })

  it('moves its place when dragged in the Output view, and one undo puts it back', async () => {
    await setView('program')
    const before = await placeOf()
    const rect = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    const x = rect.x + rect.width / 2
    const y = rect.y + rect.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(x - 20 * i, y + 40 * i)
    await page.mouse.up()
    await expect.poll(placeOf).not.toBe(before)
    await focusTimeline()
    await page.keyboard.press('Control+z')
    await expect.poll(placeOf).toBe(before)
  })

  it('is drawn where the playhead lands, by every way of moving it while paused', async () => {
    await focusTimeline()
    // Keys: the picture runs from frame 30 to 120.
    await page.keyboard.press('Home')
    await playheadAt(0)
    await waitFor(CORNER, 'red')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await playheadAt(60)
    await waitFor(CORNER, 'green')

    // The ruler.
    const ruler = (await page.locator('[data-testid="ruler"]').boundingBox())!
    await page.mouse.click(ruler.x + 150 * PX, ruler.y + ruler.height / 2)
    await playheadAt(150)
    await waitFor(CORNER, 'red')
    await page.mouse.click(ruler.x + 45 * PX, ruler.y + ruler.height / 2)
    await playheadAt(45)
    await waitFor(CORNER, 'green')

    // An empty stretch of V2.
    const row = (await page.locator('[data-testid="track"][data-kind="video"][data-index="1"]').boundingBox())!
    await page.mouse.click(row.x + 200 * PX, row.y + row.height / 2)
    await playheadAt(200)
    await waitFor(CORNER, 'red')
    await page.mouse.click(ruler.x + 45 * PX, ruler.y + ruler.height / 2)
    await playheadAt(45)
    await waitFor(CORNER, 'green')

    // The document changing under a still playhead: the picture moved away, and back with undo.
    await selectPicture()
    const clip = (await onVideoTrack().first().boundingBox())!
    const cx = clip.x + clip.width / 2
    const cy = clip.y + clip.height / 2
    // Alt held, so it lands exactly where it is let go rather than snapping.
    await page.keyboard.down('Alt')
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 1; i <= 4; i++) await page.mouse.move(cx + 12 * i, cy)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await expect.poll(() => onVideoTrack().first().getAttribute('data-start')).toBe('150')
    await waitFor(CORNER, 'red')
    await focusTimeline()
    await page.keyboard.press('Control+z')
    await expect.poll(() => onVideoTrack().first().getAttribute('data-start')).toBe('30')
    await waitFor(CORNER, 'green')
  })

  it('fills a landscape copy of the sequence as a cutaway, and the vertical one is untouched', async () => {
    await selectPicture()
    // Picture in picture turned off puts it over the whole frame.
    await page.click('[data-testid="pip-on"]')
    await page.waitForSelector('[data-testid="pip-section"][data-on="no"]', WAIT)
    await page.click('[data-testid="sequence-duplicate"]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="sequence-tab"]').length === 2, undefined, WAIT)
    await page.selectOption('[data-testid="export-preset"]', 'landscape')
    await page.locator('[data-testid="export-preset"]').blur()
    await setView('program')
    await waitFor([0.1, 0.5], 'green', LANDSCAPE)
    await waitFor([0.9, 0.5], 'green', LANDSCAPE)

    // Back on the vertical sequence, it still covers the vertical frame.
    await page.locator('[data-testid="sequence-tab"]').first().click()
    await page.waitForFunction(() => document.querySelector('[data-testid="sequence-tab"]')?.getAttribute('data-active') === 'yes', undefined, WAIT)
    await setView('program')
    await focusTimeline()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await waitFor([0.5, 0.2], 'green')
    await waitFor([0.5, 0.8], 'green')
  })

  it('keeps being drawn while the sequence plays', async () => {
    // A moving picture on a track of its own, over everything.
    await focusTimeline()
    await page.keyboard.press('Home')
    await dropOnVideoTrack(ids.clean, 2, 0)
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="track"][data-kind="video"][data-index="2"] [data-testid="clip"]').length === 1,
      undefined,
      WAIT
    )
    await setView('program')
    await focusTimeline()
    await page.keyboard.press('Space')
    await page.waitForTimeout(700)
    const first = await readFile((await monitorShot()).file)
    await page.waitForTimeout(500)
    const second = await readFile((await monitorShot()).file)
    await page.keyboard.press('Space')
    expect(first.equals(second)).toBe(false)
  })

  it('shows the frame of a picture under the playhead, after playing into it, pausing and jumping', async () => {
    // A sequence of its own: red on V1, and from 1 s a picture whose every
    // frame is lighter than the one before, so which is drawn can be read.
    await page.click('[data-testid="sequence-add"]')
    await page.click('[data-testid="sequence-add-shape"][data-shape="vertical"]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="sequence-tab"]').length === 3, undefined, WAIT)
    for (let i = 0; i < 2; i++) {
      await page.locator(`[data-testid="asset"][data-asset-id="${ids.red}"] [data-testid="add-to-timeline"]`).click()
    }
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2, undefined, WAIT)
    await focusTimeline()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await playheadAt(30)
    await dropOnVideoTrack(ids.counting, 1, 30)
    await page.waitForSelector('[data-testid="picture-clip-panel"]', WAIT)
    await setView('program')

    // Leave the sequence with the playhead before the picture and come back,
    // so the row's players start afresh, the picture waiting in the second.
    await focusTimeline()
    await page.keyboard.press('Home')
    await playheadAt(0)
    await page.locator('[data-testid="sequence-tab"]').first().click()
    await page.waitForFunction(() => document.querySelector('[data-testid="sequence-tab"]')?.getAttribute('data-active') === 'yes', undefined, WAIT)
    await page.locator('[data-testid="sequence-tab"]').nth(2).click()
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="sequence-tab"]')[2]?.getAttribute('data-active') === 'yes',
      undefined,
      WAIT
    )
    await setView('program')
    await playheadAt(0)

    // Play into the picture, stop, go back to the start, then jump to 2.5 s.
    await focusTimeline()
    await page.keyboard.press('Space')
    await page.waitForFunction(
      () => Number(document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead')) > 50,
      undefined,
      WAIT
    )
    await page.keyboard.press('Space')
    await page.keyboard.press('Home')
    await playheadAt(0)
    const ruler = (await page.locator('[data-testid="ruler"]').boundingBox())!
    await page.mouse.click(ruler.x + 75 * PX, ruler.y + ruler.height / 2)
    await playheadAt(75)
    // 1.5 s into the picture is its frame 37, drawn about 86 of 255. Its
    // first frame, left standing, would be black.
    await expect.poll(() => lightnessAt(0.5, 0.5, VERTICAL), { timeout: 15_000 }).toBeGreaterThan(60)
    const parked = await lightnessAt(0.5, 0.5, VERTICAL)
    expect(parked).toBeLessThan(115)

    // And it moves on from there when played.
    await focusTimeline()
    await page.keyboard.press('Space')
    await page.waitForTimeout(500)
    const playing = await lightnessAt(0.5, 0.5, VERTICAL)
    await page.keyboard.press('Space')
    expect(playing).toBeGreaterThan(parked + 8)
  })
})

describe('past the end of V1', () => {
  it('shows a picture on a row over black, and plays on to its end', async () => {
    await setView('program')
    await focusTimeline()
    await page.keyboard.press('End')
    const end = Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
    await dropOnVideoTrack(ids.green, 1, end)
    await page.waitForSelector('[data-testid="picture-clip-panel"]', WAIT)
    // Picture in picture turned on puts it in the corner box.
    await page.click('[data-testid="pip-on"]')
    await page.waitForSelector('[data-testid="pip-section"][data-on="yes"]', WAIT)
    await expect.poll(() => page.getAttribute('[data-testid="timecode"]', 'data-total').then(Number)).toBe(end + 90)

    await focusTimeline()
    await page.keyboard.press('Shift+ArrowRight')
    await playheadAt(end + 30)
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-has-picture')).toBe('yes')
    await waitFor(CORNER, 'green')
    await waitFor(MIDDLE, 'black')

    await page.keyboard.press('Space')
    await playheadAt(end + 90)
  })
})
