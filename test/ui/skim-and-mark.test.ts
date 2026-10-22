import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { answerSaveDialog, discardUnsavedWork } from './dialogs'

/**
 * Plan 21, step 2: a recording looked through before it lands. Add to timeline
 * used to put all of it on V1 and you cut it down from there.
 */

const fx = fixtureSet('ui-skim')
const root = await mkdtemp(join(tmpdir(), 'editbay-skim-'))
let app: ElectronApplication
let page: Page
let clip = ''
const WAIT = { timeout: 10_000 }

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}

beforeAll(async () => {
  clip = await fx.cleanClip()
  await launch()
  await page.evaluate((p) => window.api.importFiles([p]), clip)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true }).catch(() => {})
  await fx.cleanup()
})

/** The clips on V1, as their start and how long they are. */
async function v1(): Promise<[number, number][]> {
  return page.evaluate(async () =>
    (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips.map(
      (c) => [c.timelineStart, c.sourceOut - c.sourceIn] as [number, number]
    )
  )
}

/** The marks the project holds for the one recording in it. */
async function marks(): Promise<{ markIn?: number; markOut?: number }> {
  return page.evaluate(async () => {
    const m = (await window.api.currentProject()).media[0]!
    return { ...(m.markIn !== undefined ? { markIn: m.markIn } : {}), ...(m.markOut !== undefined ? { markOut: m.markOut } : {}) }
  })
}

async function openSkim(): Promise<void> {
  if ((await page.locator('[data-testid="source-strip"]').count()) > 0) return
  await page.click('[data-testid="asset-more"]')
  await page.click('[data-testid="asset-menu-skim"]')
  await page.waitForSelector('[data-testid="source-strip"]')
}

/** Move the pointer across the strip to a share of the way through. */
async function skimTo(part: number): Promise<void> {
  const strip = (await page.locator('[data-testid="source-filmstrip"]').boundingBox())!
  await page.mouse.move(strip.x + strip.width * part, strip.y + strip.height / 2)
}

describe('looking through a recording before it lands', () => {
  it('shows the recording along the strip, not an empty bar', async () => {
    await openSkim()
    const tiles = page.locator('[data-testid="source-tile"]')
    await expect.poll(() => tiles.count(), WAIT).toBeGreaterThan(1)
    const shown = await tiles.evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-tile'))))
    // The strip reads as a ruler over the recording: it starts at the start and
    // walks forwards.
    expect(shown[0]).toBe(0)
    expect(shown[shown.length - 1]).toBeGreaterThan(0)
    shown.forEach((tile, i) => i > 0 && expect(tile).toBeGreaterThanOrEqual(shown[i - 1]!))
  })

  it('draws the sound of the recording under it', async () => {
    await openSkim()
    await expect.poll(() => page.getAttribute('[data-testid="source-wave"]', 'data-heard'), WAIT).toBe('yes')
  })

  it('opens from the bin and follows the pointer across the strip', async () => {
    await openSkim()
    const at = (): Promise<number> =>
      page.evaluate(() => Number(document.querySelector('[data-testid="source-strip"]')?.getAttribute('data-at') ?? -1))
    await skimTo(0.1)
    await expect.poll(at, WAIT).toBeGreaterThanOrEqual(0)
    const early = await at()
    await skimTo(0.8)
    await expect.poll(at, WAIT).toBeGreaterThan(early)
  })

  it('sharpens to the real frame once the pointer stops, and goes back to tiles when it moves', async () => {
    await openSkim()
    const box = page.locator('[data-testid="source-frame"]')
    const sharp = (): Promise<string | null> => box.getAttribute('data-sharp')
    const at = (): Promise<number> =>
      page.evaluate(() => Number(document.querySelector('[data-testid="source-strip"]')?.getAttribute('data-at') ?? -1))

    // Held still: the real frame comes up over the tile.
    await skimTo(0.3)
    await expect.poll(sharp, WAIT).toBe('yes')
    const stopped = await at()

    // And it is the frame the pointer is on, not a neighbour.
    const seconds = await page.evaluate(
      () => (document.querySelector('[data-testid="source-sharp"]') as HTMLVideoElement).currentTime
    )
    const fps = await page.evaluate(async () => (await window.api.currentProject()).fps)
    expect(Math.abs(seconds * fps - stopped)).toBeLessThan(2)

    // Swept across, the tile is the picture again: what is on screen never
    // claims to be a frame the pointer has already left.
    await skimTo(0.31)
    await skimTo(0.5)
    await skimTo(0.7)
    expect(await sharp()).toBe('no')
    await expect.poll(sharp, WAIT).toBe('yes')
  })

  it('marks In and Out with the keys, and says how long the marked part is', async () => {
    await openSkim()
    await skimTo(0.25)
    await page.keyboard.press('i')
    await expect.poll(async () => (await marks()).markIn !== undefined, WAIT).toBe(true)
    await skimTo(0.75)
    await page.keyboard.press('o')
    await expect.poll(async () => (await marks()).markOut !== undefined, WAIT).toBe(true)

    const m = await marks()
    expect(m.markOut!).toBeGreaterThan(m.markIn!)
    // The strip follows the project, which comes back from main, so the figure
    // arrives a moment after the mark itself does.
    await expect
      .poll(async () => Number(await page.getAttribute('[data-testid="source-marked-length"]', 'data-frames')), WAIT)
      .toBe(m.markOut! - m.markIn!)
    await page.waitForSelector('[data-testid="source-marked"]')
  })

  it('adds the marked part rather than the whole recording', async () => {
    await openSkim()
    const m = await marks()
    const wanted = m.markOut! - m.markIn!
    expect(await v1()).toEqual([])
    await page.click('[data-testid="source-add"]')
    await page.waitForSelector('[data-testid="source-strip"]', { state: 'detached' })
    await expect.poll(async () => (await v1()).length, WAIT).toBe(1)
    const [placed] = await v1()
    expect(placed![1]).toBe(wanted)
  })

  it('still adds the whole recording when that is what is asked for', async () => {
    await openSkim()
    await page.click('[data-testid="source-add-whole"]')
    await page.waitForSelector('[data-testid="source-strip"]', { state: 'detached' })
    await expect.poll(async () => (await v1()).length, WAIT).toBe(2)
    const clips = await v1()
    // The whole thing is longer than the marked part added before it.
    expect(clips[1]![1]).toBeGreaterThan(clips[0]![1])
  })

  it('closes on Escape, leaving the marks where they were', async () => {
    const before = await marks()
    await openSkim()
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="source-strip"]', { state: 'detached' })
    expect(await marks()).toEqual(before)
  })

  it('lets go of the recording its player loaded once it closes', async () => {
    await openSkim()
    const video = await page.waitForSelector('[data-testid="source-sharp"]')
    // Loaded, as it is as soon as the strip opens: it is made to be seeked at once.
    await expect.poll(() => video.evaluate((el) => (el as HTMLVideoElement).readyState), WAIT).toBeGreaterThan(0)
    await page.click('[data-testid="source-close"]')
    await page.waitForSelector('[data-testid="source-strip"]', { state: 'detached' })
    // Out of the page, and emptied: a video only taken out keeps its file open and its frames decoded.
    const left = await video.evaluate((el) => {
      const v = el as HTMLVideoElement
      return { src: v.getAttribute('src'), readyState: v.readyState, networkState: v.networkState }
    })
    expect({ src: left.src, readyState: left.readyState }).toEqual({ src: null, readyState: 0 })
    // Empty on Windows; a Mac reports no source, which is as let go.
    expect([0, 3]).toContain(left.networkState)
  })
})

/** Where the playhead is, in frames. */
async function playhead(): Promise<number> {
  return Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
}

/** The frame the monitor is looking at, or null when it is on the playhead. */
async function lookingAt(): Promise<number | null> {
  const v = await page.getAttribute('[data-testid="monitor-stage"]', 'data-skim')
  return v === null || v === '' ? null : Number(v)
}

describe('looking through a clip already on the timeline', () => {
  it('shows the frame under the pointer and leaves the playhead where it was', async () => {
    const was = await playhead()
    const clip = page.locator('[data-testid="clip"]').first()
    const box = (await clip.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
    await expect.poll(lookingAt, WAIT).not.toBe(null)
    const early = (await lookingAt())!

    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2)
    await expect.poll(lookingAt, WAIT).toBeGreaterThan(early)
    // The one thing this must not do.
    expect(await playhead()).toBe(was)
    await page.waitForSelector('[data-testid="monitor-skimming"]')
  })

  it('puts the picture back on the playhead when the pointer leaves the clip', async () => {
    const was = await playhead()
    await page.mouse.move(10, 10)
    await expect.poll(lookingAt, WAIT).toBe(null)
    expect(await playhead()).toBe(was)
    expect(await page.locator('[data-testid="monitor-skimming"]').count()).toBe(0)
  })

  it('keeps out of the way of a drag: moving a clip does not skim it', async () => {
    const was = await playhead()
    const clip = page.locator('[data-testid="clip"]').first()
    const box = (await clip.boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 40, y)
    await page.mouse.move(box.x + box.width / 2 + 80, y)
    expect(await lookingAt()).toBe(null)
    await page.mouse.up()
    await page.keyboard.press('ControlOrMeta+z')
    expect(await playhead()).toBe(was)
    await page.mouse.move(10, 10)
  })
})

describe('the marks the recording keeps', () => {
  it('keeps the marks with the recording when the project is saved and opened again', async () => {
    const before = await marks()
    expect(before.markIn).toBeGreaterThan(0)
    const saved = join(root, 'marked.editbay')
    await answerSaveDialog(app, saved)
    await page.keyboard.press('ControlOrMeta+Shift+s')
    await page.waitForSelector('[data-testid="project-name"][data-changed="no"]', { timeout: 30_000 })

    await app.close()
    await launch()
    await page.evaluate((p) => window.api.openProject(p), saved)
    await page.waitForSelector('[data-testid="asset"]', { timeout: 60_000 })
    await expect.poll(marks, { timeout: 30_000 }).toEqual(before)
  }, 180_000)
})
