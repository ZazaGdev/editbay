import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { pxPerFrameAt } from '../../src/shared/timeline-layout'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 17 step 2, driven through the real window: Ctrl+wheel zooms the
 * timeline smoothly about the pointer, a drag held near the timeline's edge
 * scrolls it and lands where the pointer is, and the handles and buttons are
 * big enough to hit.
 *
 * V1 holds the 4 second clean clip five times over, 0 to 600, at the closest
 * zoom, 6 pixels a frame.
 */

const fx = fixtureSet('timeline-handling-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-timeline-handling-'))
const userData = join(root, 'user-data')
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  const clean = await fx.cleanClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  const [asset] = await page.evaluate((p) => window.api.importFiles(p), [clean])
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 180_000 })
  for (let n = 1; n <= 5; n++) {
    await page.locator(`[data-testid="asset"][data-asset-id="${asset!.id}"] [data-testid="add-to-timeline"]`).click()
    await page.waitForFunction((want) => document.querySelectorAll('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').length === want, n, WAIT)
  }
  while ((await zoom()) < 9) await press('Equal')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** A key pressed with nothing in particular focused, so it reaches the editor. */
async function press(key: string): Promise<void> {
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press(key)
}

async function zoom(): Promise<number> {
  return Number(await page.getAttribute('[data-testid="zoom-out"]', 'data-zoom'))
}

async function scrolled(): Promise<number> {
  return page.locator('[data-testid="timeline-scroll"]').evaluate((el) => el.scrollLeft)
}

async function scrollTo(left: number): Promise<void> {
  await page.locator('[data-testid="timeline-scroll"]').evaluate((el, x) => {
    el.scrollLeft = x
  }, left)
}

async function boxOf(selector: string): Promise<{ x: number; y: number; width: number; height: number }> {
  return (await page.locator(selector).first().boundingBox())!
}

function v1Clip(index: number): string {
  return `[data-testid="track"][data-track-id="v1"] [data-testid="clip"] >> nth=${index}`
}

/** A trim handle of V1's clip numbered `index`. */
async function handleOf(index: number, edge: 'start' | 'end'): Promise<{ x: number; y: number; width: number; height: number }> {
  const clip = page.locator('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').nth(index)
  return (await clip.locator(`[data-testid="trim-${edge}"]`).boundingBox())!
}

async function v1(): Promise<[number, number][]> {
  return page.evaluate(async () =>
    (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips.map((c) => [c.timelineStart, c.sourceOut - c.sourceIn] as [number, number])
  )
}

async function undo(): Promise<void> {
  await press('Control+z')
}

describe('Ctrl+wheel over the timeline', () => {
  it('zooms smoothly, between the steps, keeping the frame under the pointer where it is', async () => {
    await scrollTo(1000)
    const view = await boxOf('[data-testid="timeline-scroll"]')
    const pointer = { x: view.x + view.width / 2, y: view.y + 60 }
    const frameUnder = async (): Promise<number> => ((await scrolled()) + pointer.x - view.x) / pxPerFrameAt(await zoom())
    const before = await frameUnder()
    await page.mouse.move(pointer.x, pointer.y)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, 100)
    await page.keyboard.up('Control')
    // A third of a step out, not a whole one.
    await expect.poll(zoom, WAIT).toBeCloseTo(9 - 1 / 3, 3)
    expect(Math.abs((await frameUnder()) - before)).toBeLessThan(1)
    // The zoom buttons go on from there a whole step at a time: out to 8, not a step below where it is.
    await page.click('[data-testid="zoom-out"]')
    await expect.poll(zoom, WAIT).toBe(8)
    await page.click('[data-testid="zoom-in"]')
    await expect.poll(zoom, WAIT).toBe(9)
  })

  /**
   * Ctrl+wheel notches sent over the timeline `x` pixels into it, all in one
   * go as a quick turn of the wheel sends them, or a few milliseconds apart as
   * a smooth wheel or a touchpad does. `x` is whole, as a pointer's place is.
   */
  async function wheelAt(x: number, deltas: number[], apart: number): Promise<void> {
    await page.evaluate(
      async ({ x, deltas, apart }) => {
        const el = document.querySelector('[data-testid="timeline-scroll"]')!
        const r = el.getBoundingClientRect()
        const at = { clientX: r.left + x, clientY: r.top + 60 }
        const target = document.elementFromPoint(at.clientX, at.clientY) ?? el
        for (const deltaY of deltas) {
          target.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, ...at, bubbles: true, cancelable: true }))
          if (apart > 0) await new Promise((done) => setTimeout(done, apart))
        }
      },
      { x, deltas, apart }
    )
  }

  it('keeps the frame under a pointer off the middle there, and takes every notch of a quick turn', async () => {
    while ((await zoom()) > 8) await press('Minus')
    await scrollTo(400)
    const view = await boxOf('[data-testid="timeline-scroll"]')
    // A fifth of the way in, off the middle, so zooming about the middle would show.
    const x = Math.round(view.x + view.width / 5) - view.x
    const frameUnder = async (): Promise<number> => ((await scrolled()) + x) / pxPerFrameAt(await zoom())
    const before = await frameUnder()
    // Six notches in at once: two whole steps, not the one the first of them asked for.
    await wheelAt(x, Array(6).fill(-100), 0)
    await expect.poll(zoom, WAIT).toBeCloseTo(10, 3)
    expect(Math.abs((await frameUnder()) - before) * pxPerFrameAt(10)).toBeLessThan(2)
    // A smooth wheel's forty small steps out, and the frame is still under the pointer.
    await wheelAt(x, Array(40).fill(10), 5)
    await expect.poll(zoom, WAIT).toBeCloseTo(10 - 4 / 3, 3)
    expect(Math.abs((await frameUnder()) - before) * pxPerFrameAt(await zoom())).toBeLessThan(2)
    // The buttons still step a whole step at a time from there.
    await page.click('[data-testid="zoom-in"]')
    await expect.poll(zoom, WAIT).toBe(9)
  })
})

describe('a drag near the edge of the timeline', () => {
  it('scrolls the timeline while held there, and the clip lands under the pointer', async () => {
    await scrollTo(0)
    const view = await boxOf('[data-testid="timeline-scroll"]')
    const clip = await boxOf(v1Clip(0))
    const grab = { x: clip.x + 100, y: clip.y + clip.height / 2 }
    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    // Alt once moving, so it lands where it is let go rather than snapping; it still takes its linked sound.
    await page.keyboard.down('Alt')
    const edgeX = view.x + view.width - 10
    for (let i = 1; i <= 8; i++) await page.mouse.move(grab.x + ((edgeX - grab.x) * i) / 8, grab.y)
    await page.waitForTimeout(600)
    const scrolledBy = await scrolled()
    expect(scrolledBy).toBeGreaterThan(100)
    // Back out of the edge, so it stops, and let go.
    const letGo = view.x + view.width - 200
    await page.mouse.move(letGo, grab.y)
    const at = await scrolled()
    await page.mouse.up()
    await page.keyboard.up('Alt')
    // Grabbed 100 pixels into the clip: its start is 100 pixels left of where it was let go, in the scrolled timeline.
    const px = pxPerFrameAt(9)
    const want = Math.round((letGo - view.x + at - 100) / px)
    await expect.poll(async () => (await v1()).some(([start]) => Math.abs(start - want) <= 2), WAIT).toBe(true)
    await undo()
    await expect.poll(async () => (await v1())[0], WAIT).toEqual([0, 120])
  })

  it('scrolls the timeline while a trim is held there, and the edge lands under the pointer', async () => {
    // The second clip, 120 to 240, starts 720 pixels in at the start of the timeline. Its start is
    // dragged to the right edge and held there, which scrolls the timeline; the end of V1 stays at
    // 600, so the timeline stays as wide as it was.
    await scrollTo(0)
    await expect.poll(scrolled, WAIT).toBe(0)
    const view = await boxOf('[data-testid="timeline-scroll"]')
    const handle = await handleOf(1, 'start')
    const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.keyboard.down('Alt')
    // Ctrl: a trim only, leaving a gap, rather than the rest following (plan 82).
    await page.keyboard.down('Control')
    const edgeX = view.x + view.width - 10
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((edgeX - from.x) * i) / 8, from.y)
    await expect.poll(scrolled, WAIT).toBeGreaterThan(0)
    // Out of the edge, so it stops, then let go over frame 180, inside the clip.
    await page.mouse.move(view.x + view.width / 2, from.y)
    const at = await scrolled()
    const px = pxPerFrameAt(9)
    const want = 180
    // Where the pointer took the handle, less where on the handle it was taken.
    const letGo = view.x + want * px - at + (from.x - handle.x)
    expect(letGo).toBeGreaterThan(view.x + 60)
    expect(letGo).toBeLessThan(view.x + view.width - 60)
    await page.mouse.move(letGo, from.y)
    await page.mouse.up()
    await page.keyboard.up('Control')
    await page.keyboard.up('Alt')
    // The second clip now starts where it was let go, leaving a gap before it.
    await expect.poll(async () => Math.abs((await v1())[1]![0] - want), WAIT).toBeLessThanOrEqual(1)
    await undo()
    await expect.poll(async () => (await v1())[1], WAIT).toEqual([120, 120])
  })
})

describe('targets big enough to hit', () => {
  it('has trim handles 12 pixels wide on a clip with room, and takes an empty track away from its menu', async () => {
    expect((await handleOf(0, 'end')).width).toBe(12)
    await page.click('[data-testid="add-video-track"]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-header"]').length >= 3)
    // Removing a track is in the track's own menu now, not a bare cross under
    // its name, which is where you click to select it.
    const v2 = page.locator('[data-testid="track-header"][data-track="V2"]')
    const open = v2.locator('[data-testid="track-menu-open"]')
    const button = (await open.boundingBox())!
    expect(button.width).toBeGreaterThanOrEqual(18)
    expect(button.height).toBeGreaterThanOrEqual(18)
    await open.click()
    await page.waitForSelector('[data-testid="track-menu"]')
    await page.click('[data-testid="track-remove"]')
    await expect.poll(() => page.locator('[data-testid="track-header"][data-track="V2"]').count(), WAIT).toBe(0)
  })

  it('says why a track cannot be taken away rather than offering a dead command', async () => {
    const v1Menu = page.locator('[data-testid="track-header"][data-track="V1"] [data-testid="track-menu-open"]')
    await v1Menu.click()
    await page.waitForSelector('[data-testid="track-menu"]')
    const off = page.locator('[data-testid="track-remove"]')
    expect(await off.isDisabled()).toBe(true)
    expect(await off.getAttribute('title')).toContain('V1')
    await page.keyboard.press('Escape')
  })
})

describe('the wheel over the timeline', () => {
  it('scrolls it sideways, which is the direction a timeline goes', async () => {
    await scrollTo(0)
    const view = await boxOf('[data-testid="timeline-scroll"]')
    await page.mouse.move(view.x + view.width / 2, view.y + 60)
    await page.mouse.wheel(0, 240)
    await expect.poll(scrolled, WAIT).toBeGreaterThan(0)
    const forward = await scrolled()
    await page.mouse.wheel(0, -240)
    await expect.poll(scrolled, WAIT).toBeLessThan(forward)
  })

  it('zooms rather than scrolls with Ctrl held, so the two never fight', async () => {
    await scrollTo(400)
    const was = await zoom()
    const view = await boxOf('[data-testid="timeline-scroll"]')
    await page.mouse.move(view.x + view.width / 2, view.y + 60)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, 240)
    await page.keyboard.up('Control')
    await expect.poll(zoom, WAIT).toBeLessThan(was)
  })
})
