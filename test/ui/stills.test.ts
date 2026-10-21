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
 * Plan 42: a picture in the window. Brought in like a recording, described as
 * a picture, not offered for skimming, and drawn in the Output view with its
 * clear parts showing what is under it, which on V1 alone is black.
 */

const fx = fixtureSet('ui-stills')
const root = await mkdtemp(join(tmpdir(), 'editbay-stills-ui-'))
let app: ElectronApplication
let page: Page
let logoPath: string

beforeAll(async () => {
  logoPath = await fx.logoPng()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 300_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

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

const green = ([r, g, b]: [number, number, number]): boolean => g > 100 && r < 70 && b < 70
const black = ([r, g, b]: [number, number, number]): boolean => r < 30 && g < 30 && b < 30

describe('a picture', () => {
  it('comes in as an image, with its size, and has nothing to skim', async () => {
    await page.keyboard.press('ControlOrMeta+n')
    await page.evaluate((p) => window.api.importFiles([p]), logoPath)
    await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
    expect(await page.locator('[data-testid="asset-status"]').first().textContent()).toMatch(/^image\s+400x200\s+png$/)
    const media = await page.evaluate(async () => (await window.api.currentProject()).media[0]!)
    expect(media.still).toBe(true)

    await page.locator('[data-testid="asset"]').first().click({ button: 'right' })
    await page.waitForSelector('[data-testid="asset-menu"]')
    expect(await page.locator('[data-testid="asset-menu-skim"]').isDisabled()).toBe(true)
    await page.keyboard.press('Escape')
  })

  it('lands five seconds long, and says nothing of In and Out', async () => {
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForSelector('[data-testid="clip"]')
    expect(await page.getAttribute('[data-testid="clip"]', 'data-length-frames')).toBe('150')
    const clip = (await page.locator('[data-testid="clip"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
    await page.waitForSelector('[data-testid="picture-clip-panel"]')
    expect(await page.getAttribute('[data-testid="clip-length"]', 'data-frames')).toBe('150')
    expect(await page.locator('[data-testid="picture-clip-panel"]').textContent()).not.toMatch(/\bIn\b.*\bOut\b/)
  })

  it('is drawn in the Output view, black through its clear parts on V1', async () => {
    await page.keyboard.press('Home')
    await page.click('[data-testid="view-program"]')
    const box = (await page.locator('[data-testid="program-canvas"]').boundingBox())!
    // The 1080x1920 frame, fitted in the canvas and centred.
    const k = Math.min(box.width / 1080, box.height / 1920)
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await expect.poll(async () => green(await rgbAt(cx, cy)), { timeout: 10_000 }).toBe(true)
    // Output pixel 100 across, in the picture's clear part, and well above the picture.
    expect(black(await rgbAt(cx - 440 * k, cy))).toBe(true)
    expect(black(await rgbAt(cx, cy - 600 * k))).toBe(true)
    await page.screenshot({ path: join(process.env.EDITBAY_SHOTS ?? root, 'still-output.png') })
  })
})

describe('a picture placed freely', () => {
  const clipTransform = (): Promise<{ rotation?: number; opacity?: number }> =>
    page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!.transform)

  it('turns a quarter with the handle above its box, and the Output view turns it too', async () => {
    const box = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const knob = (await page.locator('[data-testid="place-turn"]').boundingBox())!
    await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2)
    await page.mouse.down()
    // From straight above the middle round to straight right of it: a quarter turn clockwise.
    const reach = cy - (knob.y + knob.height / 2)
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2)
      await page.mouse.move(cx + Math.sin(a) * reach, cy - Math.cos(a) * reach)
    }
    await page.mouse.up()
    await expect.poll(async () => (await clipTransform()).rotation, { timeout: 5000 }).toBe(90)
    expect(await page.getAttribute('[data-testid="place-rect"]', 'data-rotation')).toBe('90')
    expect(await page.inputValue('[data-testid="overlay-rotation"]')).toBe('90')

    const canvas = (await page.locator('[data-testid="program-canvas"]').boundingBox())!
    const k = Math.min(canvas.width / 1080, canvas.height / 1920)
    const mx = canvas.x + canvas.width / 2
    const my = canvas.y + canvas.height / 2
    // Upright, the green box is 540 wide and 270 tall about the middle; turned, 270 wide and 540 tall.
    await expect.poll(async () => green(await rgbAt(mx, my + 190 * k)), { timeout: 5000 }).toBe(true)
    expect(black(await rgbAt(mx + 200 * k, my))).toBe(true)
    // What a press picks it by is turned too: upright it is twice as wide as tall, turned twice as tall.
    const target = (await page.locator('[data-testid="monitor-picture"][data-picture-id="main"]').boundingBox())!
    expect(target.height / target.width).toBeCloseTo(2, 1)
    await page.screenshot({ path: join(process.env.EDITBAY_SHOTS ?? root, 'still-turned.png') })
  })

  it('is put upright again, and made see-through from the Inspector, in one undo each', async () => {
    await page.click('[data-testid="overlay-upright"]')
    await expect.poll(async () => (await clipTransform()).rotation, { timeout: 5000 }).toBeUndefined()
    await page.locator('[data-testid="overlay-opacity"]').fill('50')
    await expect.poll(async () => (await clipTransform()).opacity, { timeout: 5000 }).toBe(0.5)
    const canvas = (await page.locator('[data-testid="program-canvas"]').boundingBox())!
    const [, g] = await rgbAt(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
    // Green at 200 over black, half drawn.
    expect(g).toBeGreaterThan(60)
    expect(g).toBeLessThan(140)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => (await clipTransform()).opacity, { timeout: 5000 }).toBeUndefined()
  })
  it('pops in and fades out, picked in the Inspector, and the Output view draws it growing', async () => {
    const clip = (): Promise<{ enter?: { kind: string; length: number }; exit?: { kind: string; length: number } }> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!)
    await page.selectOption('[data-testid="appear-in"]', 'pop')
    await expect.poll(async () => (await clip()).enter, { timeout: 5000 }).toEqual({ kind: 'pop', length: 15 })
    // A second, typed.
    await page.fill('[data-testid="appear-in-seconds"]', '1')
    await page.press('[data-testid="appear-in-seconds"]', 'Enter')
    await expect.poll(async () => (await clip()).enter, { timeout: 5000 }).toEqual({ kind: 'pop', length: 30 })
    await page.selectOption('[data-testid="appear-out"]', 'fade')
    await expect.poll(async () => (await clip()).exit, { timeout: 5000 }).toEqual({ kind: 'fade', length: 15 })

    // Three frames in, it is about four tenths of its size about its middle:
    // the middle is green, and near the box's left edge is still black.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Home')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    const canvas = (await page.locator('[data-testid="program-canvas"]').boundingBox())!
    const k = Math.min(canvas.width / 1080, canvas.height / 1920)
    const cx = canvas.x + canvas.width / 2
    const cy = canvas.y + canvas.height / 2
    await expect.poll(async () => black(await rgbAt(cx - 230 * k, cy)), { timeout: 5000 }).toBe(true)
    expect(green(await rgbAt(cx, cy))).toBe(true)
    // Settled a second in, its own size.
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight')
    await expect.poll(async () => green(await rgbAt(cx - 230 * k, cy)), { timeout: 5000 }).toBe(true)

    // None takes it off again.
    await page.selectOption('[data-testid="appear-in"]', 'none')
    await expect.poll(async () => (await clip()).enter, { timeout: 5000 }).toBeUndefined()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => (await clip()).enter, { timeout: 5000 }).toEqual({ kind: 'pop', length: 30 })
  })
})

describe('an animated GIF', () => {
  it('plays in the Output view: its first frame where it lands, its second half a second on', async () => {
    await page.keyboard.press('ControlOrMeta+n')
    await page.evaluate((p) => window.api.importFiles([p]), await fx.animGif())
    await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
    expect(await page.locator('[data-testid="asset-status"]').first().textContent()).toMatch(/^animation\s+200x100\s+2fps\s+2 frames$/)
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForSelector('[data-testid="clip"]')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Home')
    if ((await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')) === 'source') await page.click('[data-testid="view-program"]')
    const box = (await page.locator('[data-testid="program-canvas"]').boundingBox())!
    const k = Math.min(box.width / 1080, box.height / 1920)
    // The opaque left half of the GIF, fitted 1080 wide: output x 270.
    const x = box.x + box.width / 2 - 270 * k
    const y = box.y + box.height / 2
    await expect.poll(async () => green(await rgbAt(x, y)), { timeout: 10_000 }).toBe(true)
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight')
    await expect
      .poll(async () => {
        const [r, g, b] = await rgbAt(x, y)
        return r > 180 && g < 70 && b > 180
      }, { timeout: 10_000 })
      .toBe(true)
  })
})

