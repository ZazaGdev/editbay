import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 38, entries 18 and 19: Unlink has a way back, a selection drags as one,
 * and an edit that left linked clips behind says so. Two copies of a four
 * second clip on V1, each with its sound on A1.
 */

const fx = fixtureSet('ui-linking')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-linking-'))
/** Pixels per frame at the zoom a new project starts at. */
const PX = 0.4
let app: ElectronApplication
let page: Page
let cleanPath: string

interface Placed {
  id: string
  start: number
  link?: string
}

async function tracks(): Promise<{ video: Placed[]; audio: Placed[] }> {
  return page.evaluate(async () => {
    const s = (await window.api.currentProject()).sequences[0]!
    const placed = (c: { id: string; timelineStart: number; link?: string }) => ({
      id: c.id,
      start: c.timelineStart,
      ...(c.link !== undefined ? { link: c.link } : {})
    })
    return { video: s.videoTracks[0]!.clips.map(placed), audio: s.audioTracks[0]!.clips.map(placed) }
  })
}

function picture(index: number) {
  return page.locator('[data-testid="track"][data-kind="video"][data-index="0"] [data-testid="clip"]').nth(index)
}

function sound(index: number) {
  return page.locator('[data-testid="track"][data-kind="audio"][data-index="0"] [data-testid="sound-clip"]').nth(index)
}

async function centre(locator: ReturnType<typeof picture>): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function clickOn(locator: ReturnType<typeof picture>, modifiers: ('Shift' | 'Alt')[] = []): Promise<void> {
  await locator.click({ modifiers })
}

/** A new project with the clip on V1 twice. */
async function fresh(): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Control+n')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0)
  await page.evaluate((p) => window.api.importFiles([p]), cleanPath)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  for (let n = 1; n <= 2; n++) {
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForFunction((k) => document.querySelectorAll('[data-testid="clip"]').length === k, n, WAIT)
  }
}

beforeAll(async () => {
  cleanPath = await fx.cleanClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

describe('linking clips back together', () => {
  it('links a picture to its sound again after Unlink, from the right click menu', async () => {
    await fresh()
    await clickOn(picture(0))
    await page.click('[data-testid="unlink"]')
    await expect.poll(async () => (await tracks()).video[0]!.link, WAIT).toBeUndefined()

    // Both selected, and the menu keeps the selection it was opened on.
    await clickOn(picture(0))
    await clickOn(sound(0), ['Shift'])
    await picture(0).click({ button: 'right' })
    await page.waitForSelector('[data-testid="clip-menu-link"]')
    expect(await page.isDisabled('[data-testid="clip-menu-link"]')).toBe(false)
    await page.click('[data-testid="clip-menu-link"]')
    await expect.poll(async () => (await tracks()).video[0]!.link, WAIT).toBeDefined()
    const t = await tracks()
    expect(t.audio[0]!.link).toBe(t.video[0]!.link)
    await page.waitForSelector('[data-testid="toast"][data-kind="link"]', WAIT)
  })

  it('offers Unlink rather than Link for a group that is linked already', async () => {
    await clickOn(picture(1))
    await picture(1).click({ button: 'right' })
    await page.waitForSelector('[data-testid="clip-menu-unlink"]')
    expect(await page.locator('[data-testid="clip-menu-link"]').count()).toBe(0)
    await page.keyboard.press('Escape')
  })
})

describe('dragging a selection', () => {
  it('moves every selected clip, each with its sound, by as much', async () => {
    await fresh()
    const before = await tracks()
    await clickOn(picture(0))
    await clickOn(picture(1), ['Shift'])
    const from = await centre(picture(1))
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    // Alt once the drag has begun, so nothing snaps; held from the press, it would take the clip alone.
    await page.keyboard.down('Alt')
    for (let i = 1; i <= 4; i++) await page.mouse.move(from.x + (40 * PX * i) / 4, from.y)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await expect.poll(async () => (await tracks()).video.map((c) => c.start), WAIT).toEqual(before.video.map((c) => c.start + 40))
    expect((await tracks()).audio.map((c) => c.start)).toEqual(before.audio.map((c) => c.start + 40))
  })

  it('narrows the selection to the clip when a press in it is only a click', async () => {
    await clickOn(picture(0))
    await clickOn(picture(1), ['Shift'])
    await clickOn(picture(0))
    await expect
      .poll(() => page.locator('[data-testid="track"][data-kind="video"] [data-testid="clip"][data-selected="yes"]').count(), WAIT)
      .toBe(1)
  })
})

describe('an edit that leaves linked clips behind', () => {
  it('says so when a cut takes one clip of a linked pair on its own', async () => {
    await fresh()
    await clickOn(picture(0), ['Alt'])
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('KeyS')
    await page.waitForSelector('[data-testid="toast"][data-kind="split"]', WAIT)
    expect(await page.textContent('[data-testid="toast"][data-kind="split"]')).toContain('clips linked to it were left as they were')
    // The picture is cut, its sound is not.
    const t = await tracks()
    expect(t.video.length).toBe(3)
    expect(t.audio.length).toBe(2)
  })
})
