import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * A sound clip's volume, set from its right click menu as the Inspector sets
 * it, and a gap taken out from its own. One clip on V1, its sound on A1.
 */

const fx = fixtureSet('ui-clip-menu-volume')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-clip-menu-volume-'))
let app: ElectronApplication
let page: Page

/** The gain of the first clip on A1. */
async function gain(): Promise<number> {
  return page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.audioTracks[0]!.clips[0]!.gain)
}

const sound = () => page.locator('[data-testid="track"][data-kind="audio"][data-index="0"] [data-testid="sound-clip"]').first()
const picture = () => page.locator('[data-testid="track"][data-kind="video"][data-index="0"] [data-testid="clip"]').first()

beforeAll(async () => {
  const cleanPath = await fx.cleanClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), cleanPath)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="sound-clip"]', WAIT)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

describe('the volume in a sound clip\'s right click menu', () => {
  it('shows the clip\'s volume, and sets it from a typed figure with the menu left open', async () => {
    await sound().click({ button: 'right' })
    await page.waitForSelector('[data-testid="clip-menu-volume"]', WAIT)
    expect(await page.getAttribute('[data-testid="clip-menu-volume"]', 'data-value')).toBe('100')
    const box = page.locator('[data-testid="clip-menu-volume-typed"]')
    await box.fill('')
    // Typed a key at a time: a digit must not close the menu.
    await box.pressSequentially('150')
    await page.keyboard.press('Enter')
    await expect.poll(gain, WAIT).toBeCloseTo(1.5)
    expect(await page.isVisible('[data-testid="clip-menu"]')).toBe(true)
    await expect.poll(() => page.getAttribute('[data-testid="clip-menu-volume"]', 'data-value'), WAIT).toBe('150')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="clip-menu"]', { state: 'detached', ...WAIT })
  })

  it('keeps a typed figure when the menu is closed by clicking elsewhere', async () => {
    const was = await gain()
    await sound().click({ button: 'right' })
    const box = page.locator('[data-testid="clip-menu-volume-typed"]')
    await box.fill('')
    await box.pressSequentially('70')
    // A press on the ruler, outside the menu, with nothing pressed to send the figure.
    const ruler = (await page.locator('[data-testid="ruler"]').boundingBox())!
    await page.mouse.click(ruler.x + ruler.width - 20, ruler.y + ruler.height / 2)
    await page.waitForSelector('[data-testid="clip-menu"]', { state: 'detached', ...WAIT })
    await expect.poll(gain, WAIT).toBeCloseTo(0.7)
    expect(was).not.toBeCloseTo(0.7)
  })

  it('takes a drag of the slider back in one undo', async () => {
    const was = await gain()
    await sound().click({ button: 'right' })
    const slider = (await page.locator('[data-testid="clip-menu-volume"]').boundingBox())!
    const y = slider.y + slider.height / 2
    await page.mouse.move(slider.x + slider.width * 0.2, y)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(slider.x + slider.width * (0.2 + i * 0.12), y)
    await page.mouse.up()
    await expect.poll(gain, WAIT).not.toBeCloseTo(was)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="clip-menu"]', { state: 'detached', ...WAIT })
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(gain, WAIT).toBeCloseTo(was)
  })

  it('is not offered for a picture', async () => {
    await picture().click({ button: 'right' })
    await page.waitForSelector('[data-testid="clip-menu"]', WAIT)
    expect(await page.locator('[data-testid="clip-menu-volume"]').count()).toBe(0)
    await page.keyboard.press('Escape')
  })
})

describe('a gap\'s right click menu', () => {
  /** Where each clip on V1 starts. */
  async function starts(): Promise<number[]> {
    return page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips.map((c) => c.timelineStart))
  }

  it('removes the empty stretch it was opened on, closing up what comes after', async () => {
    // A second copy after the first, then the first deleted leaving a gap before it.
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2, undefined, WAIT)
    const second = (await starts())[1]!
    await picture().click()
    await picture().click({ button: 'right' })
    await page.click('[data-testid="clip-menu-delete"]')
    await expect.poll(starts, WAIT).toEqual([second])
    // The project has the clip gone a moment before the timeline is drawn
    // again without it. Measured before then, the press below lands on the
    // clip taken away rather than on the gap.
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="track"][data-kind="video"][data-index="0"] [data-testid="clip"]').length === 1,
      undefined,
      WAIT
    )

    const row = (await page.locator('[data-testid="track"][data-kind="video"][data-index="0"]').boundingBox())!
    const clip = (await picture().boundingBox())!
    // Half way between the start of the track and the clip.
    await page.mouse.click((row.x + clip.x) / 2, row.y + row.height / 2, { button: 'right' })
    await page.waitForSelector('[data-testid="gap-menu"]', WAIT)
    await page.click('[data-testid="gap-menu-remove"]')
    await expect.poll(starts, WAIT).toEqual([0])
    await page.waitForSelector('[data-testid="gap-menu"]', { state: 'detached', ...WAIT })
  })

  it('opens no menu past the last clip, where there is no gap to close', async () => {
    const row = (await page.locator('[data-testid="track"][data-kind="video"][data-index="0"]').boundingBox())!
    const clip = (await picture().boundingBox())!
    await page.mouse.click(Math.min(row.x + row.width - 5, clip.x + clip.width + 40), row.y + row.height / 2, { button: 'right' })
    await page.waitForTimeout(300)
    expect(await page.locator('[data-testid="gap-menu"]').count()).toBe(0)
  })
})
