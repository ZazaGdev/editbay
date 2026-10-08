import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 62: picture in picture in one place. The Inspector's section and the
 * toolbar beside the small picture on the Output view change the same place
 * and style, and a drag of the small picture snaps into a corner.
 */

const fx = fixtureSet('ui-pip')
const root = await mkdtemp(join(tmpdir(), 'editbay-pip-'))
const WAIT = { timeout: 15_000 }
const W = 1080
const H = 1920
let app: ElectronApplication
let page: Page

type Box = { x: number; y: number; w: number; h: number }
type Style = { radius?: number; border?: number; shadow?: boolean }

/** The small picture's place and style, from the project. */
async function small(): Promise<{ place: Box; style: Style | undefined; layout: string }> {
  return page.evaluate(async () => {
    const c = (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!
    const l = c.layers[0]!
    return { place: l.place, style: l.style, layout: c.layout }
  })
}
const where = (): Promise<string | null> => page.textContent('[data-testid="pip-where"]')

beforeAll(async () => {
  const obs = await fx.obsClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), obs)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]')
  const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
  await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
  await page.waitForSelector('[data-testid="picture-clip-panel"]')
  await page.keyboard.press('Home')
  await page.click('[data-testid="view-program"]')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

describe('the Picture in picture section', () => {
  it('turns it on for a two view recording, in the top right corner, with the right view small', async () => {
    await page.waitForSelector('[data-testid="pip-section"][data-on="no"]', WAIT)
    await page.click('[data-testid="pip-on"]')
    await page.waitForSelector('[data-testid="pip-section"][data-on="yes"]', WAIT)
    expect((await small()).layout).toBe('pip')
    expect(await where()).toBe('Top right')
    // The clip says so on the timeline.
    // A mark of its own on a wide clip, or among the "fx" count on a short one: either way it says so on hover.
    await page.waitForSelector('[data-testid="clip"] [title*="Picture in picture"]', WAIT)
    expect(await page.getAttribute('[data-testid="pip-which-right"]', 'aria-pressed')).toBe('true')
  })

  it('puts it in each corner the margin in, and takes a size keeping its corner', async () => {
    await page.click('[data-testid="pip-corner-bl"]')
    await expect.poll(where, WAIT).toBe('Bottom left')
    await page.locator('[data-testid="pip-margin"]').fill('40')
    await expect.poll(async () => Math.round((await small()).place.x * W), WAIT).toBe(40)
    const p = (await small()).place
    expect(Math.round((1 - p.y - p.h) * H)).toBe(40)
    await page.locator('[data-testid="pip-size"]').fill('50')
    await expect.poll(async () => (await small()).place.w, WAIT).toBeCloseTo(0.5, 2)
    expect(await where()).toBe('Bottom left')
  })

  it('makes it a circle, square on the frame, and gives it its shape back', async () => {
    await page.click('[data-testid="pip-shape-circle"]')
    await expect.poll(async () => {
      const p = (await small()).place
      return Math.abs(p.w * W - p.h * H) <= 2
    }, WAIT).toBe(true)
    await page.click('[data-testid="pip-shape-rounded"]')
    await expect.poll(async () => {
      const p = (await small()).place
      return Math.round(((p.w * W) / (p.h * H)) * 100) / 100
    }, WAIT).toBeGreaterThan(1)
  })

  it('takes a square, tall or wide box, and a width and height typed (bugs and notes 2, note 34)', async () => {
    const shape = async (): Promise<number> => {
      const p = (await small()).place
      return (p.w * W) / (p.h * H)
    }
    await page.click('[data-testid="pip-box-square"]')
    await expect.poll(async () => Math.round((await shape()) * 100) / 100, WAIT).toBe(1)
    await page.click('[data-testid="pip-box-tall"]')
    await expect.poll(async () => Math.round((await shape()) * 100) / 100, WAIT).toBe(0.56)
    // The width alone, typed: the height stays.
    const h = Math.round((await small()).place.h * H)
    await page.fill('[data-testid="pip-width"]', '400')
    await page.press('[data-testid="pip-width"]', 'Enter')
    await expect.poll(async () => Math.round((await small()).place.w * W), WAIT).toBe(400)
    expect(Math.abs(Math.round((await small()).place.h * H) - h)).toBeLessThanOrEqual(2)
    await page.click('[data-testid="pip-box-own"]')
    await expect.poll(async () => Math.round((await shape()) * 100) / 100, WAIT).toBe(1.78)
  })

  it('gives it a border and a shadow, always in view', async () => {
    await page.click('[data-testid="pip-border"]')
    await expect.poll(async () => (await small()).style?.border ?? 0, WAIT).toBeGreaterThan(0)
    await page.click('[data-testid="pip-shadow"]')
    await expect.poll(async () => (await small()).style?.shadow === true, WAIT).toBe(true)
  })
})

describe('the small picture on the Output view', () => {
  async function selectSmall(): Promise<void> {
    await page.click('[data-testid="picture"][data-picture-id]:not([data-picture-id="main"])')
    await page.waitForSelector('[data-testid="pip-toolbar"]', WAIT)
  }

  it('has a toolbar beside it whose changes the Inspector shows at once', async () => {
    await selectSmall()
    const before = Number(await page.getAttribute('[data-testid="pip-size"]', 'value'))
    await page.click('[data-testid="pip-toolbar-larger"]')
    await expect.poll(async () => Number(await page.getAttribute('[data-testid="pip-size"]', 'value')), WAIT).toBe(before + 2)
    expect(await page.textContent('[data-testid="pip-toolbar-size"]')).toBe(`${before + 2}%`)
    await page.click('[data-testid="pip-toolbar-corner"]')
    await page.click('[data-testid="pip-toolbar-corners-tl"]')
    await expect.poll(where, WAIT).toBe('Top left')
    await page.click('[data-testid="pip-toolbar-shape"]')
    await expect.poll(() => page.getAttribute('[data-testid="pip-shape-circle"]', 'aria-pressed'), WAIT).toBe('true')
    // One box on the Output view however many changes: none left behind from before.
    expect(await page.locator('[data-testid="place-rect"]').count()).toBe(1)
  })

  it('stays where a drag leaves it, snaps into a corner it is let go near, and one undo takes a drag back', async () => {
    await selectSmall()
    const drag = async (toX: number, toY: number): Promise<void> => {
      const box = (await page.locator('[data-testid="place-rect"]').boundingBox())!
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((toX - from.x) * i) / 8, from.y + ((toY - from.y) * i) / 8)
      await page.mouse.up()
    }
    const frame = (await page.locator('[data-testid="frame-outline"]').boundingBox())!
    // To the middle of the frame: left there, and Custom.
    await drag(frame.x + frame.width / 2, frame.y + frame.height / 2)
    await expect.poll(where, WAIT).toBe('Custom')
    const custom = (await small()).place
    // Near the bottom right corner: into it.
    const box = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    await drag(frame.x + frame.width - box.width / 2 - 8, frame.y + frame.height - box.height / 2 - 8)
    await expect.poll(where, WAIT).toBe('Bottom right')
    // The drag and its snap are one step.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await small()).place.x, WAIT).toBeCloseTo(custom.x, 3)
    await expect.poll(where, WAIT).toBe('Custom')
  })

  it('goes back to one picture over the whole frame when turned off', async () => {
    await page.click('[data-testid="pip-on"]')
    await page.waitForSelector('[data-testid="pip-section"][data-on="no"]', WAIT)
    expect(await page.locator('[data-testid="pip-toolbar"]').count()).toBe(0)
  })
})

describe('the picture chosen, from one clip to the next', () => {
  const clipAt = async (i: number): Promise<void> => {
    const b = (await page.locator('[data-testid="clip"][data-kind="video"]').nth(i).boundingBox())!
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  }
  const chosen = (): Promise<string | null> => page.getAttribute('[data-testid="picture"][data-selected="yes"]', 'data-picture-id')

  it('stays on Picture 2 when the next clip has one, and goes back to the main picture when it has not', async () => {
    await page.click('[data-testid="pip-on"]')
    await page.waitForSelector('[data-testid="pip-section"][data-on="yes"]', WAIT)
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === 2, undefined, WAIT)
    await clipAt(1)
    await page.click('[data-testid="pip-on"]')
    await page.waitForSelector('[data-testid="pip-section"][data-on="yes"]', WAIT)

    await clipAt(0)
    await page.click('[data-testid="picture"][data-picture-id]:not([data-picture-id="main"])')
    await expect.poll(chosen, WAIT).not.toBe('main')
    await clipAt(1)
    await expect.poll(chosen, WAIT).not.toBe('main')
    // Its own second picture, not the first clip's.
    const second = await page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[1]!.layers[0]!.id)
    expect(await chosen()).toBe(second)

    // A clip with one picture: the main one.
    await page.click('[data-testid="pip-on"]')
    await page.waitForSelector('[data-testid="pip-section"][data-on="no"]', WAIT)
    await clipAt(0)
    await expect.poll(chosen, WAIT).toBe('main')
  })
})

describe('lines while dragging', () => {
  it('shows the frame centre line while a dragged picture is snapped to it, and none once let go', async () => {
    await page.click('[data-testid="picture"][data-picture-id]:not([data-picture-id="main"])')
    await page.waitForSelector('[data-testid="place-rect"]', WAIT)
    const frame = (await page.locator('[data-testid="frame-outline"]').boundingBox())!
    const box = (await page.locator('[data-testid="place-rect"]').boundingBox())!
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    // Its middle to the frame's middle across, a little below the frame's middle down.
    const to = { x: frame.x + frame.width / 2 + 2, y: frame.y + frame.height * 0.62 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10)
    await page.waitForSelector('[data-testid="snap-line"][data-axis="x"][data-at="540"]', WAIT)
    await page.mouse.up()
    await expect.poll(() => page.locator('[data-testid="snap-line"]').count(), WAIT).toBe(0)
    // Let go on the line: exactly centred across.
    const p = await page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!.layers[0]!.place)
    expect(Math.round((p.x + p.w / 2) * 1080)).toBe(540)
  })

  it('shows the line a dragged side snaps to while resizing, and lets go on it', async () => {
    await page.waitForSelector('[data-testid="place-w"]', WAIT)
    const frame = (await page.locator('[data-testid="frame-outline"]').boundingBox())!
    const side = (await page.locator('[data-testid="place-w"]').boundingBox())!
    const from = { x: side.x + side.width / 2, y: side.y + side.height / 2 }
    // The left side to a few pixels short of the frame's middle.
    const to = { x: frame.x + frame.width / 2 - 3, y: from.y }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y)
    await page.waitForSelector('[data-testid="snap-line"][data-axis="x"][data-at="540"]', WAIT)
    await page.mouse.up()
    await expect.poll(() => page.locator('[data-testid="snap-line"]').count(), WAIT).toBe(0)
    await expect.poll(async () => Math.round((await small()).place.x * W), WAIT).toBe(540)
  })

  it('draws no line and does not snap while Alt is held', async () => {
    const frame = (await page.locator('[data-testid="frame-outline"]').boundingBox())!
    const side = (await page.locator('[data-testid="place-w"]').boundingBox())!
    const from = { x: side.x + side.width / 2, y: side.y + side.height / 2 }
    // Away from the middle, then back to a few pixels short of it, with Alt down.
    const to = { x: frame.x + frame.width / 2 - 3, y: from.y }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x - 40, from.y)
    await page.keyboard.down('Alt')
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x - 40 + ((to.x - from.x + 40) * i) / 10, from.y)
    expect(await page.locator('[data-testid="snap-line"]').count()).toBe(0)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await expect.poll(async () => Math.round((await small()).place.x * W), WAIT).not.toBe(540)
  })

  // Bugs and notes 2, note 23.
  it('snaps nothing with Snap off under the monitor, snaps while Alt is held then, and remembers it', async () => {
    const drag = async (alt: boolean): Promise<void> => {
      const frame = (await page.locator('[data-testid="frame-outline"]').boundingBox())!
      const side = (await page.locator('[data-testid="place-w"]').boundingBox())!
      const from = { x: side.x + side.width / 2, y: side.y + side.height / 2 }
      const to = { x: frame.x + frame.width / 2 - 3, y: from.y }
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(from.x - 40, from.y)
      if (alt) await page.keyboard.down('Alt')
      for (let i = 1; i <= 10; i++) await page.mouse.move(from.x - 40 + ((to.x - from.x + 40) * i) / 10, from.y)
      // What Alt does is said while dragging.
      await page.waitForSelector('[data-testid="place-alt-hint"]', WAIT)
      await page.mouse.up()
      if (alt) await page.keyboard.up('Alt')
    }
    await page.click('[data-testid="place-snap"]')
    await page.waitForSelector('[data-testid="place-rect"][data-snap="no"]', WAIT)
    expect(await page.evaluate(() => window.localStorage.getItem('editbay.window') ?? '')).toContain('"placeSnap":false')
    await drag(false)
    await expect.poll(async () => Math.round((await small()).place.x * W), WAIT).not.toBe(540)
    // Alt snaps it, the other way round.
    await drag(true)
    await expect.poll(async () => Math.round((await small()).place.x * W), WAIT).toBe(540)
    await page.click('[data-testid="place-snap"]')
    await page.waitForSelector('[data-testid="place-rect"][data-snap="yes"]', WAIT)
  })
})
