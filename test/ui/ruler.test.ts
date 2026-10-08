import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Idea 40: the ruler stays in view. With more tracks than the timeline has
 * room for, they scroll up under it, and the ruler and the corner beside it
 * stay at the top, where the playhead is dragged from.
 */

const fx = fixtureSet('ui-ruler')
const root = await mkdtemp(join(tmpdir(), 'editbay-ruler-'))
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  const clip = await fx.cleanClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), clip)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]')
}, 300_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

describe('the ruler', () => {
  it('stays at the top while many tracks scroll up under it', async () => {
    for (let i = 0; i < 7; i++) await page.locator('[data-testid="add-video-track"]').click()
    const tracks = page.locator('[data-testid="timeline-tracks"]')
    // More than fits: it scrolls.
    await expect.poll(() => tracks.evaluate((el) => el.scrollHeight > el.clientHeight + 40)).toBe(true)
    await tracks.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect.poll(() => tracks.evaluate((el) => el.scrollTop)).toBeGreaterThan(40)
    const box = (await tracks.boundingBox())!
    const ruler = (await page.locator('[data-testid="ruler-pin"]').boundingBox())!
    const corner = (await page.locator('[data-testid="ruler-corner"]').boundingBox())!
    expect(Math.abs(ruler.y - box.y)).toBeLessThan(2)
    expect(Math.abs(corner.y - box.y)).toBeLessThan(2)
    // Scrolled to the bottom, the lowest tracks are there beside their names, not cut off.
    const a1 = (await page.locator('[data-testid="track-header"]').last().boundingBox())!
    const sound = (await page.locator('[data-testid="sound-clip"]').first().boundingBox())!
    expect(Math.abs(sound.y + sound.height / 2 - (a1.y + a1.height / 2))).toBeLessThan(a1.height / 2)
    // And it still moves the playhead from up there.
    await page.mouse.click(ruler.x + 200, ruler.y + ruler.height / 2)
    await expect.poll(async () => Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))).toBeGreaterThan(0)
  })
})

describe('zoomed all the way in', () => {
  it('labels frames on the ruler and marks each frame, and zooming out comes back to the old levels', async () => {
    const zoomOf = async (): Promise<number> => Number(await page.getAttribute('[data-testid="zoom-out"]', 'data-zoom'))
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const before = await zoomOf()
    for (let i = 0; i < 16; i++) await page.keyboard.press('Equal')
    await expect.poll(zoomOf).toBe(12)
    await page.waitForSelector('[data-testid="ruler-frame-ticks"]')
    // Labels a few frames apart, not a second apart.
    const frames = (await page.locator('[data-testid="ruler-label"]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-frame')))))
    expect(frames.some((f) => f % 30 !== 0)).toBe(true)
    await page.screenshot({ path: join(process.env.EDITBAY_SHOTS ?? root, 'zoomed-to-frames.png') })
    for (let i = 0; i < 12 - before; i++) await page.keyboard.press('Minus')
    await expect.poll(zoomOf).toBe(before)
    expect(await page.locator('[data-testid="ruler-frame-ticks"]').count()).toBe(0)
  })
})
