import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 17 step 1, driven through the real window: the wheel zooms the Source
 * view about the pointer, the crop box follows the zoomed picture, a drag on
 * the picture pans it, and double-click or Fit fits it again.
 *
 * V1 holds the OBS stand-in, a 3840x1080 canvas red on the left and blue on
 * the right, from 0 to 180, then a small 640x360 clip from 180. The sequence is
 * vertical, so the Source and Output views are side by side.
 */

const fx = fixtureSet('source-zoom-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-source-zoom-'))
const userData = join(root, 'user-data')
let app: ElectronApplication
let page: Page
let shot = 0

beforeAll(async () => {
  const [obs, clean] = [await fx.obsClip(), await fx.cleanClip()]
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  const assets = await page.evaluate((p) => window.api.importFiles(p), [obs, clean])
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length === 2, undefined, {
    timeout: 180_000
  })
  for (const [n, a] of assets.entries()) {
    await page.locator(`[data-testid="asset"][data-asset-id="${a.id}"] [data-testid="add-to-timeline"]`).click()
    await page.waitForFunction((want) => document.querySelectorAll('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').length === want, n + 1, WAIT)
  }
  await press('Home')
  await page.waitForSelector('[data-testid="monitor-stage"][data-both="yes"]', WAIT)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

type Box = { x: number; y: number; width: number; height: number }

async function boxOf(selector: string): Promise<Box> {
  return (await page.locator(selector).boundingBox())!
}

/** A key pressed with nothing in particular focused, so it reaches the editor. */
async function press(key: string): Promise<void> {
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press(key)
}

/** The crop in source pixels, as its box reports it. */
async function crop(): Promise<{ x: number; y: number; w: number; h: number }> {
  const [x = 0, y = 0, w = 0, h = 0] = ((await page.getAttribute('[data-testid="crop-rect"]', 'data-crop')) ?? '').split(',').map(Number)
  return { x, y, w, h }
}

/**
 * How the Source view maps source pixels to the screen just now, read from the
 * crop box: its screen edges against its source pixels.
 */
async function mapping(): Promise<{ scale: number; offset: number }> {
  const c = await crop()
  const b = await boxOf('[data-testid="crop-rect"]')
  const scale = b.width / c.w
  return { scale, offset: b.x - c.x * scale }
}

/** How light the screen is at a point, 0 to 255. */
async function lightnessAt(x: number, y: number): Promise<number> {
  const stage = page.locator('[data-testid="monitor-stage"]')
  const box = (await stage.boundingBox())!
  shot += 1
  const file = join(root, `shot-${shot}.png`)
  await writeFile(file, await stage.screenshot())
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const size = String(probe).match(/, (\d+)x(\d+)/)
  const scale = size ? Number(size[1]) / box.width : 1
  const px = Math.round((x - box.x) * scale)
  const py = Math.round((y - box.y) * scale)
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${px}:${py},format=gray`, '-f', 'rawvideo', 'pipe:1'])
  return stdout[0] ?? 0
}

/** The colour at a point of the screen: red, blue, dimmed red or blue, or anything else. */
async function colourAt(x: number, y: number): Promise<'red' | 'blue' | 'dim red' | 'dim blue' | 'other'> {
  const stage = page.locator('[data-testid="monitor-stage"]')
  const box = (await stage.boundingBox())!
  shot += 1
  const file = join(root, `shot-${shot}.png`)
  await writeFile(file, await stage.screenshot())
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const size = String(probe).match(/, (\d+)x(\d+)/)
  const scale = size ? Number(size[1]) / box.width : 1
  const px = Math.round((x - box.x) * scale)
  const py = Math.round((y - box.y) * scale)
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${px}:${py},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  const [r = 0, g = 0, b = 0] = stdout
  if (r > 170 && g < 80 && b < 80) return 'red'
  if (b > 170 && r < 80 && g < 80) return 'blue'
  if (r > 60 && r < 150 && g < 50 && b < 50) return 'dim red'
  if (b > 60 && b < 150 && r < 50 && g < 50) return 'dim blue'
  return 'other'
}

const SOURCE = '[data-testid="monitor-side"][data-side="source"]'

async function zoomLevel(): Promise<number> {
  if ((await page.locator('[data-testid="source-zoom"]').count()) === 0) return 1
  return Number(await page.getAttribute('[data-testid="source-zoom"]', 'data-zoom'))
}

describe('zooming the Source view', () => {
  it('dims the recording outside the crop', async () => {
    // The crop is in the middle of the canvas, red to its left and blue to its right.
    const c = await boxOf('[data-testid="crop-rect"]')
    const view = await boxOf(SOURCE)
    const y = c.y + c.height / 2
    // Waited for: the view is black until the recording's first frame is drawn.
    await expect.poll(() => colourAt((view.x + c.x) / 2, y), WAIT).toBe('dim red')
    expect(await colourAt((c.x + c.width + view.x + view.width) / 2, y)).toBe('dim blue')
    // And not inside it: just inside its left edge is red at full strength.
    expect(await colourAt(c.x + 4, y)).toBe('red')
  })

  it('zooms about the pointer with the wheel, the source pixel under it staying put', async () => {
    const view = await boxOf(SOURCE)
    const before = await mapping()
    // A point on the picture a little left of the middle, on the crop's left edge's row.
    const c = await boxOf('[data-testid="crop-rect"]')
    const pointer = { x: c.x - 30, y: c.y + c.height / 2 }
    expect(pointer.x).toBeGreaterThan(view.x)
    const sourceX = (pointer.x - before.offset) / before.scale
    await page.mouse.move(pointer.x, pointer.y)
    await page.mouse.wheel(0, -300)
    // Three notches of 1.25.
    await expect.poll(zoomLevel, WAIT).toBeCloseTo(1.953, 2)
    const after = await mapping()
    expect(after.scale / before.scale).toBeCloseTo(1.953, 2)
    // Within a few source pixels: a screen pixel is 2.5 of them here, and the page lays boxes out to whole pixels.
    expect(Math.abs((pointer.x - after.offset) / after.scale - sourceX)).toBeLessThan(4)
    expect(await page.textContent('[data-testid="source-zoom"]')).toContain('195%')
  })

  it('keeps the crop box over the part of the recording the crop names, zoomed in off the middle', async () => {
    // The red and blue meet at source x 1920, inside the crop: either side of where the crop box
    // puts that pixel on screen, red then blue.
    const { scale, offset } = await mapping()
    const boundary = offset + 1920 * scale
    const c = await boxOf('[data-testid="crop-rect"]')
    const y = c.y + c.height / 2
    expect(await colourAt(boundary - 4, y)).toBe('red')
    expect(await colourAt(boundary + 4, y)).toBe('blue')
  })

  it('does not zoom while the crop box is being dragged', async () => {
    const before = await zoomLevel()
    const start = await crop()
    const b = await boxOf('[data-testid="crop-rect"]')
    await page.keyboard.down('Alt')
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + 10, b.y + b.height / 2)
    await page.mouse.wheel(0, -100)
    await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    expect(await zoomLevel()).toBe(before)
    // The crop went where the pointer took it, 20 screen pixels, not somewhere a new zoom put it.
    const { scale } = await mapping()
    expect(Math.abs((await crop()).x - start.x - 20 / scale)).toBeLessThan(4)
    await press('Control+z')
    await expect.poll(async () => (await crop()).x, WAIT).toBe(start.x)
  })

  it('moves the crop by the source pixels the pointer moved over, zoomed in', async () => {
    const { scale } = await mapping()
    const start = await crop()
    const b = await boxOf('[data-testid="crop-rect"]')
    // Alt, so it goes where it is dragged rather than snapping to a line.
    await page.keyboard.down('Alt')
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(b.x + b.width / 2 + (40 * i) / 5, b.y + b.height / 2)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await expect.poll(async () => (await crop()).x, WAIT).not.toBe(start.x)
    expect((await crop()).x - start.x).toBeCloseTo(40 / scale, -0.5)
    await press('Control+z')
    await expect.poll(async () => (await crop()).x, WAIT).toBe(start.x)
  })

  it('pans with a drag on the picture outside the crop, leaving the crop where it is in the recording', async () => {
    const start = await crop()
    const before = await boxOf('[data-testid="crop-rect"]')
    const view = await boxOf(SOURCE)
    // Halfway down the left edge: clear of the crop box, the caption above and the zoom's readout at the top right.
    const from = { x: view.x + 12, y: view.y + view.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(from.x + (60 * i) / 5, from.y)
    await page.mouse.up()
    await expect.poll(async () => (await boxOf('[data-testid="crop-rect"]')).x - before.x, WAIT).toBeCloseTo(60, 0)
    expect(await crop()).toEqual(start)
  })

  it('pans with the middle button from anywhere, the crop box included, without moving the crop', async () => {
    const start = await crop()
    const before = await boxOf('[data-testid="crop-rect"]')
    const from = { x: before.x + before.width / 2, y: before.y + before.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down({ button: 'middle' })
    for (let i = 1; i <= 5; i++) await page.mouse.move(from.x - (40 * i) / 5, from.y)
    await page.mouse.up({ button: 'middle' })
    await expect.poll(async () => (await boxOf('[data-testid="crop-rect"]')).x - before.x, WAIT).toBeCloseTo(-40, 0)
    expect(await crop()).toEqual(start)
  })

  it('never shows the zoomed picture outside the Source view', async () => {
    const view = await boxOf(SOURCE)
    await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
    // At most three notches a turn of the wheel: two turns.
    await page.mouse.wheel(0, -300)
    await page.mouse.wheel(0, -300)
    await expect.poll(zoomLevel, WAIT).toBeGreaterThan(5)
    // The gap between the two views stays black, though the picture runs on past the Source view.
    const gapX = view.x + view.width + 4
    await expect.poll(() => lightnessAt(gapX, view.y + view.height / 2), WAIT).toBeLessThan(10)
    const video = await page.evaluate(() => {
      const v = Array.from(document.querySelectorAll('video[data-testid="track-video"]')).find((e) => (e as HTMLElement).style.clipPath !== '') as HTMLElement | undefined
      return v ? { clip: v.style.clipPath, right: v.getBoundingClientRect().right } : null
    })
    expect(video?.clip).toMatch(/^inset\(/)
    expect(video!.right).toBeGreaterThan(gapX)
  })

  it('fits again with Fit, and with a double-click on the picture', async () => {
    const fitted = async (): Promise<number> => (await boxOf('[data-testid="crop-rect"]')).width
    await page.click('[data-testid="source-fit"]')
    await expect.poll(zoomLevel, WAIT).toBe(1)
    const width = await fitted()
    const view = await boxOf(SOURCE)
    await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
    await page.mouse.wheel(0, -200)
    await expect.poll(zoomLevel, WAIT).toBeGreaterThan(1)
    await page.mouse.dblclick(view.x + 12, view.y + view.height / 2)
    await expect.poll(zoomLevel, WAIT).toBe(1)
    expect(Math.abs((await fitted()) - width)).toBeLessThanOrEqual(1)
  })

  it('fits the view again for another recording, and does not bring the zoom back on returning', async () => {
    const view = await boxOf(SOURCE)
    await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
    await page.mouse.wheel(0, -200)
    await expect.poll(zoomLevel, WAIT).toBeGreaterThan(1)
    // Down to the next cut: the small clip, another recording.
    await press('ArrowDown')
    await expect.poll(zoomLevel, WAIT).toBe(1)
    await press('ArrowUp')
    await page.waitForTimeout(300)
    expect(await zoomLevel()).toBe(1)
  })
})

describe('zooming the Output view (task 53)', () => {
  const OUTPUT = '[data-testid="monitor-side"][data-side="program"]'
  const VIEW = '[data-testid="monitor-view"][data-side="program"]'
  const outputZoom = async (): Promise<number> =>
    (await page.locator('[data-testid="program-zoom"]').count()) === 0 ? 1 : Number(await page.getAttribute('[data-testid="program-zoom"]', 'data-zoom'))
  const playing = async (): Promise<string | null> => page.getAttribute('[data-testid="play-pause"]', 'data-playing')

  it('zooms with Ctrl and the wheel only, shows how far at its top right, and cuts the picture to the view', async () => {
    const view = await boxOf(VIEW)
    await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
    await page.mouse.wheel(0, -300)
    await page.waitForTimeout(200)
    expect(await outputZoom()).toBe(1)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -300)
    await page.keyboard.up('Control')
    await expect.poll(outputZoom, WAIT).toBeCloseTo(1.953, 2)
    expect(await page.textContent('[data-testid="program-zoom"]')).toContain('195%')
    const chip = await boxOf('[data-testid="program-zoom"]')
    expect(chip.x + chip.width).toBeGreaterThan(view.x + view.width - 20)
    expect(chip.y).toBeLessThan(view.y + 20)
    const drawn = await boxOf(OUTPUT)
    expect(drawn.width).toBeGreaterThan(view.width * 1.9)
    const canvas = await page.evaluate(() => (document.querySelector('[data-testid="program-canvas"]') as HTMLElement).style.clipPath)
    expect(canvas).toMatch(/^inset\(/)
  })

  it('pans with the middle button and with Space held and a left drag, and Space tapped still plays', async () => {
    const view = await boxOf(VIEW)
    const left = async (): Promise<number> => (await boxOf(OUTPUT)).x
    const from = { x: view.x + view.width / 2, y: view.y + view.height / 2 }
    let before = await left()
    await page.mouse.move(from.x, from.y)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(from.x + 40, from.y, { steps: 4 })
    await page.mouse.up({ button: 'middle' })
    await expect.poll(left, WAIT).not.toBe(before)
    before = await left()
    await page.mouse.move(from.x, from.y)
    await page.keyboard.down('Space')
    await page.waitForSelector('[data-testid="monitor-hand"]', WAIT)
    await page.mouse.down()
    await page.mouse.move(from.x - 40, from.y, { steps: 4 })
    await page.mouse.up()
    await page.keyboard.up('Space')
    await expect.poll(left, WAIT).not.toBe(before)
    expect(await playing()).toBe('no')
    // Tapped over the zoomed view with no drag: play, then pause.
    await page.keyboard.press('Space')
    await expect.poll(playing, WAIT).toBe('yes')
    await page.keyboard.press('Space')
    await expect.poll(playing, WAIT).toBe('no')
  })

  it('fits again with Reset', async () => {
    await page.click('[data-testid="program-fit"]')
    await expect.poll(outputZoom, WAIT).toBe(1)
    const view = await boxOf(VIEW)
    const drawn = await boxOf(OUTPUT)
    expect(Math.abs(drawn.width - view.width)).toBeLessThanOrEqual(1)
  })
})
