import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { fitInBox } from '../../src/shared/crop-geometry'
import { LOOKS } from '../../src/shared/looks'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 85: every look, a strength and each slider, read back from the Output
 * view and from an exported frame at the same moment, over four bands of
 * colour. The two must agree, because a preview that disagrees with the file
 * is worse than no look at all. Plan 35 measured Black and white 4 levels
 * apart at worst; 6 is allowed here.
 */

const TOLERANCE = 6
const fx = fixtureSet('ui-looks')
const root = await mkdtemp(join(tmpdir(), 'editbay-looks-'))
let app: ElectronApplication
let page: Page
let shots = 0

beforeAll(async () => {
  const bands = await fx.colourBands()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate(() => window.api.setAppSettings({ lastShape: 'landscape' }))
  await page.keyboard.press('ControlOrMeta+n')
  await page.evaluate((p) => window.api.importFiles([p]), bands)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]')
  const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
  await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
  await page.waitForSelector('[data-testid="look-section"]')
  await page.click('[data-testid="view-program"]')
  await page.waitForSelector('[data-testid="monitor-stage"][data-view="program"]')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

type Rgb = [number, number, number]
/** The middle of each band, as shares of the frame across and down. */
const POINTS = [0.125, 0.375, 0.625, 0.875].map((y) => [0.5, y] as const)

/** A PNG's pixels at the points, the points given as shares of `frame` within the picture. */
async function pixels(file: string, frame: (w: number, h: number) => { x: number; y: number; w: number; h: number }, points: readonly (readonly [number, number])[] = POINTS): Promise<Rgb[]> {
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const [, w = '0', h = '0'] = String(probe).match(/, (\d+)x(\d+)/) ?? []
  const f = frame(Number(w), Number(h))
  const out: Rgb[] = []
  for (const [px, py] of points) {
    const x = Math.round(f.x + px * f.w)
    const y = Math.round(f.y + py * f.h)
    const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
    out.push([stdout[0]!, stdout[1]!, stdout[2]!])
  }
  return out
}

/** The Output view at the points, from a picture of its canvas as the screen shows it. */
async function inOutputView(points: readonly (readonly [number, number])[] = POINTS): Promise<Rgb[]> {
  const file = join(root, `view-${++shots}.png`)
  await writeFile(file, await page.locator('[data-testid="program-canvas"]').screenshot())
  return pixels(file, (w, h) => {
    const fit = fitInBox(1920, 1080, w, h)
    return { x: fit.offsetX, y: fit.offsetY, w: fit.width, h: fit.height }
  }, points)
}

/** The same moment exported as a frame. */
async function inExport(points: readonly (readonly [number, number])[] = POINTS): Promise<Rgb[]> {
  const saved = await page.evaluate(async (dir) => {
    const p = await window.api.currentProject()
    return window.api.saveFrame({ sequenceId: p.sequences[0]!.id, frame: 15, outputDir: dir })
  }, join(root, 'frames'))
  expect(saved.error).toBeUndefined()
  return pixels(saved.path!, (w, h) => ({ x: 0, y: 0, w, h }), points)
}

/** How far apart the two are, at worst, in levels of 255. */
function apart(a: Rgb[], b: Rgb[]): number {
  return Math.max(...a.flatMap((p, i) => p.map((v, c) => Math.abs(v - b[i]![c]!))))
}

/** The clip's colour as the Output view and the export give it, once the view has drawn the change. */
async function both(points: readonly (readonly [number, number])[] = POINTS): Promise<{ view: Rgb[]; file: Rgb[] }> {
  const file = await inExport(points)
  // The view redraws a moment after an edit: wait for it to agree, or give its last reading.
  let view = await inOutputView(points)
  for (let i = 0; i < 20 && apart(view, file) > TOLERANCE; i++) {
    await page.waitForTimeout(150)
    view = await inOutputView(points)
  }
  return { view, file }
}

async function edit(e: object): Promise<void> {
  await page.evaluate(async (change) => {
    const p = await window.api.currentProject()
    const clipId = p.sequences[0]!.videoTracks[0]!.clips[0]!.id
    await window.api.applyEdit(0, { sequenceId: p.sequences[0]!.id, clipId, ...change } as never)
  }, e)
}

describe('every look, the Output view against the export', () => {
  it('offers None and every look in one Colour dropdown (task 57)', async () => {
    const values = await page.locator('[data-testid="look-select"] option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))
    expect(values).toEqual(['none', ...LOOKS.map((l) => l.id)])
    expect(values).toHaveLength(8)
    expect(await page.locator('[data-testid="look"]').count()).toBe(0)
  })

  it('draws the Colour dropdown as wide as the slider tracks, lined up with them (task 79)', async () => {
    const linedUp = async (): Promise<void> => {
      // The dropdown's frame, which is what you see, around the select itself.
      const select = (await page.locator('[data-testid="look-select"]').locator('..').boundingBox())!
      for (const id of ['brightness', 'contrast', 'saturation', 'warmth']) {
        const track = (await page.locator(`[data-testid="adjust-${id}"]`).boundingBox())!
        expect(Math.abs(select.x - track.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(select.x + select.width - (track.x + track.width))).toBeLessThanOrEqual(1)
      }
    }
    await linedUp()

    // And in a narrow window.
    const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentSize())
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 720))
    await page.waitForFunction(() => window.innerWidth <= 1102, undefined, { timeout: 5000 })
    await linedUp()
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size[0]!, size[1]!), before)
  })

  it('starts as recorded, the two agreeing', async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const { view, file } = await both()
    expect(apart(view, file)).toBeLessThanOrEqual(TOLERANCE)
  })

  for (const look of LOOKS) {
    it(`agrees for ${look.name}, at full strength and at half`, async () => {
      await page.locator('[data-testid="look-select"]').selectOption(look.id)
      await expect.poll(() => page.getAttribute('[data-testid="clip-look"]', 'data-look')).toBe(look.id)
      const full = await both()
      expect(apart(full.view, full.file)).toBeLessThanOrEqual(TOLERANCE)
      await page.locator('[data-testid="look-strength"]').fill('50')
      await expect.poll(() => page.getAttribute('[data-testid="look-strength"]', 'data-value')).toBe('50')
      const half = await both()
      expect(apart(half.view, half.file)).toBeLessThanOrEqual(TOLERANCE)
      // Half way really is between: not the same as full.
      expect(apart(half.file, full.file)).toBeGreaterThan(3)
      await page.locator('[data-testid="look-strength"]').fill('100')
    })
  }
})

describe('each slider, the Output view against the export', () => {
  for (const id of ['brightness', 'contrast', 'saturation', 'warmth']) {
    it(`agrees for ${id} at both ends`, async () => {
      await page.locator('[data-testid="look-select"]').selectOption('none')
      for (const value of [100, -100]) {
        await page.locator(`[data-testid="adjust-${id}"]`).fill(String(value))
        await expect.poll(() => page.getAttribute(`[data-testid="adjust-${id}"]`, 'data-value')).toBe(String(value))
        const { view, file } = await both()
        expect(apart(view, file), `${id} at ${value}`).toBeLessThanOrEqual(TOLERANCE)
      }
      await page.click('[data-testid="adjust-reset"]')
      await page.waitForSelector('[data-testid="adjust-reset"]', { state: 'detached' })
    })
  }

  it('agrees for a look with every slider moved', async () => {
    await page.locator('[data-testid="look-select"]').selectOption('faded')
    await edit({ kind: 'setColourAdjust', change: { brightness: 30, contrast: 40, saturation: -20, warmth: 60 } })
    const { view, file } = await both()
    expect(apart(view, file)).toBeLessThanOrEqual(TOLERANCE)
  })
})

/**
 * The blue down one column of a PNG, at `x` across `frame`, from `top` to
 * `bottom` of it, as shares of the frame's height and the values found.
 */
async function column(file: string, frame: (w: number, h: number) => { x: number; y: number; w: number; h: number }, x: number, top: number, bottom: number): Promise<[number, number][]> {
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const [, w = '0', h = '0'] = String(probe).match(/, (\d+)x(\d+)/) ?? []
  const f = frame(Number(w), Number(h))
  const y0 = Math.round(f.y + top * f.h)
  const y1 = Math.round(f.y + bottom * f.h)
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:${y1 - y0}:${Math.round(f.x + x * f.w)}:${y0},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  const out: [number, number][] = []
  for (let i = 0; i + 2 < stdout.length; i += 3) out.push([(y0 + i / 3 - f.y) / f.h, stdout[i + 2]!])
  return out
}

/** How wide an edge from one level to another is, from a quarter of the way to three quarters, as a share of the frame's height. */
function edgeWidth(profile: [number, number][]): number {
  const first = profile[0]![1]
  const last = profile.at(-1)![1]
  const at = (part: number): number => {
    const level = first + (last - first) * part
    const i = profile.findIndex(([, v]) => (last > first ? v >= level : v <= level))
    return profile[Math.max(0, i)]![0]
  }
  return at(0.75) - at(0.25)
}

/** The edge between the green and blue bands at `x`, in the Output view and the export. */
async function edges(x: number): Promise<{ view: number; file: number; onScreen: number }> {
  const saved = await page.evaluate(async (dir) => {
    const p = await window.api.currentProject()
    return window.api.saveFrame({ sequenceId: p.sequences[0]!.id, frame: 15, outputDir: dir })
  }, join(root, 'frames'))
  const file = edgeWidth(await column(saved.path!, (w, h) => ({ x: 0, y: 0, w, h }), x, 0.4, 0.6))
  const shot = join(root, `view-${++shots}.png`)
  await page.waitForTimeout(300)
  await writeFile(shot, await page.locator('[data-testid="program-canvas"]').screenshot())
  let onScreen = 0
  const view = edgeWidth(
    await column(shot, (w, h) => {
      const fit = fitInBox(1920, 1080, w, h)
      onScreen = fit.height
      return { x: fit.offsetX, y: fit.offsetY, w: fit.width, h: fit.height }
    }, x, 0.4, 0.6)
  )
  return { view, file, onScreen }
}

describe('blur, the Output view against the export', () => {
  /** Where an edge is as wide in both: within a tenth, or a few pixels of the screen, which a smaller monitor makes coarser. */
  function sameEdge(e: { view: number; file: number; onScreen: number }): void {
    expect(Math.abs(e.view - e.file)).toBeLessThanOrEqual(Math.max(0.1 * e.file, 3 / e.onScreen))
  }

  it('blurs a box over the line between two colours, and nothing outside it', async () => {
    await page.locator('[data-testid="look-select"]').selectOption('none')
    await edit({ kind: 'setColourAdjust', change: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 } })
    await page.click('[data-testid="blur-box-add"]')
    await page.waitForSelector('[data-testid="blur-box-row"][data-editing="yes"]')
    // Its box is on the Source view, in place of the crop, to be moved.
    await page.waitForSelector('[data-testid="monitor-stage"][data-view="source"]')
    await page.click('[data-testid="view-program"]')
    const inside = await edges(0.5)
    const outside = await edges(0.1)
    sameEdge(inside)
    // Inside, the edge is spread over many pixels; outside, it stays sharp.
    expect(inside.file).toBeGreaterThan(0.01)
    expect(outside.file).toBeLessThan(0.006)
    expect(outside.view).toBeLessThan(0.01)
  })

  it('blurs the whole picture the same in both', async () => {
    await page.locator('[data-testid="blur-whole"]').fill('40')
    await expect.poll(() => page.getAttribute('[data-testid="blur-whole"]', 'data-value')).toBe('40')
    const outside = await edges(0.1)
    sameEdge(outside)
    // Read in whole pixels of the frame, so a step is 0.0009: the same blur
    // read 12 pixels from ffmpeg 6.1's footage and 10 from 9.0's, whose bands
    // are a few levels truer (plan 89). A sharp edge reads under 0.006.
    expect(outside.file).toBeGreaterThan(0.008)
  })

  it('moves a box dragged on the Source view, as a crop is moved', async () => {
    await page.click('[data-testid="blur-box-edit"]')
    await page.click('[data-testid="blur-box-edit"]')
    await page.waitForSelector('[data-testid="monitor-stage"][data-view="source"]')
    const boxAt = (): Promise<number> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!.blurBoxes![0]!.x)
    const before = await boxAt()
    const r = (await page.locator('[data-testid="crop-rect"]').boundingBox())!
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(r.x + r.width / 2 - 12 * i, r.y + r.height / 2, { steps: 2 })
    await page.mouse.up()
    await expect.poll(boxAt, { timeout: 5000 }).toBeLessThan(before - 0.02)
  })
})

// Each colour taken out, the Output view against the export, is checked on real green, blue and
// black screens in remove-background-detect.test.ts (task 32): the bands stand on none of them.
describe('a background taken out (plan 90)', () => {
  // The blur above taken off first: under a blur that strong the two blur a few
  // levels apart already, and a key beside bright bands makes that many more.
  beforeAll(async () => {
    await page.locator('[data-testid="blur-whole"]').fill('0')
    while ((await page.locator('[data-testid="blur-box-remove"]').count()) > 0) await page.locator('[data-testid="blur-box-remove"]').first().click()
    await page.waitForFunction(async () => {
      const c = (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!
      return c.blur === undefined && c.blurBoxes === undefined
    })
  }, 60_000)

  it('is offered from the clip menu too, under Tools, and leaves bands with no plain background as they were', async () => {
    await page.click('[data-testid="tool-remove-background-none"]')
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2, { button: 'right' })
    await page.hover('[data-testid="clip-menu-tools"]')
    await page.click('[data-testid="clip-menu-tool-remove-background-remove"]')
    await page.waitForSelector('[data-kind="background-none"]')
    expect(await page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!.removeBackground)).toBeUndefined()
  })
})
