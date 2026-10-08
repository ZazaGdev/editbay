import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 97: a face cam's box moving out of the way. The picture in picture
 * toolbar's Move out of the way slides it to a free corner and back over a
 * second and a half, the box on the Output view following it as the
 * playhead moves; the clip menu fades it; a drag of a box with keyframes
 * makes a keyframe on the frame under the playhead; the diamonds on the clip
 * show them.
 */

const fx = fixtureSet('ui-moving-box')
const root = await mkdtemp(join(tmpdir(), 'editbay-moving-box-'))
let app: ElectronApplication
let page: Page
const WAIT = { timeout: 10_000 }

type Key = { at: number; place: { x: number; y: number; w: number; h: number }; opacity?: number }

/** The small picture's box keyframes. */
async function boxKeys(): Promise<Key[]> {
  return page.evaluate(async () => {
    const c = (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!
    return (c.layers[0]?.boxKeys ?? []) as Key[]
  })
}

/** Put the playhead on a frame. */
async function seek(frame: number): Promise<void> {
  await page.click('[data-testid="monitor-timecode"]')
  await page.fill('[data-testid="timecode-input"]', `${frame}f`)
  await page.press('[data-testid="timecode-input"]', 'Enter')
  await expect.poll(() => page.getAttribute('[data-testid="timecode"]', 'data-playhead'), WAIT).toBe(String(frame))
}

/** The small picture's box on the Output view, as shares of the frame there: the view's layout can move on screen. */
async function shownBox(): Promise<{ x: number; y: number; width: number; height: number }> {
  const frame = (await page.locator('[data-testid="frame-outline"]').boundingBox())!
  const box = (await page.locator('[data-testid="place-rect"]').boundingBox())!
  return { x: (box.x - frame.x) / frame.width, y: (box.y - frame.y) / frame.height, width: box.width / frame.width, height: box.height / frame.height }
}

/** Off the timecode box, so a key goes to the app. */
async function blur(): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

async function selectSmall(): Promise<void> {
  await page.click('[data-testid="picture"][data-picture-id]:not([data-picture-id="main"])')
  await page.waitForSelector('[data-testid="pip-toolbar"]', WAIT)
}

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
  // The recording's camera view as a small box in a corner.
  await page.click('[data-testid="pip-on"]')
  await page.waitForSelector('[data-testid="pip-section"][data-on="yes"]', WAIT)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

describe('moving a face cam out of the way', () => {
  it('slides it to the corner beside it and back from the toolbar, the box on the view following it', async () => {
    await seek(10)
    await selectSmall()
    const before = await shownBox()
    await page.click('[data-testid="pip-toolbar-away"]')
    await page.click('[data-testid="pip-toolbar-away-slide"]')
    await expect.poll(async () => (await boxKeys()).length, WAIT).toBe(4)
    const keys = await boxKeys()
    expect(keys[0]!.at).toBe(10)
    // A second and a half at 30 frames a second.
    expect(keys[3]!.at).toBe(55)
    expect(keys[1]!.place.x).not.toBeCloseTo(keys[0]!.place.x, 2)
    // Held away in the middle, the box on the view is there too; back after it.
    await seek(32)
    await expect.poll(async () => Math.abs((await shownBox()).x - before.x), WAIT).toBeGreaterThan(before.width)
    await seek(60)
    await expect.poll(async () => Math.abs((await shownBox()).x - before.x), WAIT).toBeLessThan(0.01)
    // Its keyframes are diamonds on the clip.
    expect(await page.locator('[data-testid="clip-keyframe"]').count()).toBeGreaterThan(0)
  })

  it('makes a keyframe where the box is dragged to, on the frame under the playhead', async () => {
    await seek(80)
    await selectSmall()
    const box = await shownBox()
    const frame = (await page.locator('[data-testid="frame-outline"]').boundingBox())!
    const cx = frame.x + (box.x + box.width / 2) * frame.width
    const cy = frame.y + (box.y + box.height / 2) * frame.height
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx - 30, cy + 40, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => (await boxKeys()).some((k) => k.at === 80), WAIT).toBe(true)
    const keys = await boxKeys()
    // Earlier keyframes stay where they were.
    expect(keys.filter((k) => k.at <= 55).length).toBe(4)
  })

  it('fades it out and back in from the clip menu, over the marked range', async () => {
    await seek(58)
    await blur()
    await page.keyboard.press('Shift+KeyI')
    await seek(75)
    await blur()
    await page.keyboard.press('Shift+KeyO')
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2, { button: 'right' })
    await page.hover('[data-testid="clip-menu-framing"]')
    await page.click('[data-testid="clip-menu-fade-out-of-the-way"]')
    await expect.poll(async () => (await boxKeys()).some((k) => k.at > 58 && k.at < 75 && k.opacity === 0), WAIT).toBe(true)
    const faded = (await boxKeys()).filter((k) => k.at >= 58 && k.at <= 75)
    expect(faded.map((k) => k.opacity ?? 1)).toEqual([1, 0, 0, 1])
  })
})
