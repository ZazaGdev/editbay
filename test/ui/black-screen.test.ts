import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Item 24: a black screen for an end card, from Shift+B, the button next to
 * Add text, and the gap menu, with its colour changed in the Inspector and
 * text laid over it with T.
 */

const fx = fixtureSet('ui-black-screen')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-black-screen-'))
let app: ElectronApplication
let page: Page
let clipPath: string

interface Placed {
  id: string
  track: number
  start: number
  length: number
  colour?: string
}

/** Every clip on the video tracks, with its track's index and its source's colour. */
async function pictures(): Promise<Placed[]> {
  return page.evaluate(async () => {
    const p = await window.api.currentProject()
    const s = p.sequences[0]!
    return s.videoTracks.flatMap((r, track) =>
      r.clips.map((c) => {
        const colour = p.media.find((m) => m.id === c.mediaId)?.colour
        return { id: c.id, track, start: c.timelineStart, length: c.sourceOut - c.sourceIn, ...(colour ? { colour } : {}) }
      })
    )
  })
}

async function fresh(copies: number): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Control+n')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0)
  await page.evaluate((p) => window.api.importFiles([p]), clipPath)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  for (let n = 1; n <= copies; n++) {
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForFunction((k) => document.querySelectorAll('[data-testid="clip"]').length === k, n, WAIT)
  }
}

beforeAll(async () => {
  clipPath = await fx.cleanClip()
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

describe('a black screen', () => {
  it('goes after the last clip with Shift+B at the end, three seconds long, selected, and not in the bin', async () => {
    await fresh(1)
    const [footage] = await pictures()
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+B')
    await expect.poll(async () => (await pictures()).length, WAIT).toBe(2)
    const black = (await pictures()).find((c) => c.colour)!
    expect(black).toMatchObject({ track: 0, start: footage!.start + footage!.length, length: 90, colour: '#000000' })
    await page.waitForSelector('[data-testid="colour-section"]', WAIT)
    expect(await page.locator('[data-testid="asset"]').count()).toBe(1)
  })

  it('takes a colour from the Inspector', async () => {
    // What is edited on it comes first; where it comes from comes last.
    const groups = await page.locator('[data-inspector-group]').evaluateAll((els) => els.map((e) => e.getAttribute('data-group')))
    expect(groups.at(0)).toBe('Colour')
    expect(groups.at(-1)).toBe('Source')
    await page.locator('[data-testid="colour-value"]').fill('#ff0000')
    await expect.poll(async () => (await pictures()).find((c) => c.colour)?.colour, WAIT).toBe('#ff0000')
  })

  it('has text laid over it with T, on the track above', async () => {
    const black = (await pictures()).find((c) => c.colour)!
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('t')
    await expect.poll(async () => (await pictures()).length, WAIT).toBe(3)
    const words = (await pictures()).find((c) => c.id !== black.id && c.track === 1)
    expect(words?.start).toBe(black.start)
    await page.waitForSelector('[data-testid="text-section"]', WAIT)
    const groups = await page.locator('[data-inspector-group], [data-testid="text-section"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-group')))
    expect(groups.at(0)).toBe('Text')
    expect(groups.at(-1)).toBe('Source')
  })

  it('comes from the button next to Add text too, both in the header of the timeline, not in Sources', async () => {
    // With the timecode, in the header of the timeline, where the clips they make go.
    for (const id of ['add-text', 'add-black-screen']) {
      const inTimeline = await page.locator(`[data-testid="${id}"]`).evaluate((el) => el.closest('header')?.querySelector('[data-testid="timecode"]') !== null)
      expect(inTimeline).toBe(true)
    }
    const before = (await pictures()).length
    await page.locator('[data-testid="add-black-screen"]').click()
    await expect.poll(async () => (await pictures()).length, WAIT).toBe(before + 1)
  })

  it('fills a gap exactly from the gap menu', async () => {
    await fresh(2)
    // The first copy deleted, leaving a gap before the second.
    const first = page.locator('[data-testid="track"][data-kind="video"][data-index="0"] [data-testid="clip"]').first()
    await first.click()
    await first.click({ button: 'right' })
    await page.click('[data-testid="clip-menu-delete"]')
    await expect.poll(async () => (await pictures()).length, WAIT).toBe(1)
    const [second] = await pictures()
    const row = (await page.locator('[data-testid="track"][data-kind="video"][data-index="0"]').boundingBox())!
    const clip = (await page.locator('[data-testid="track"][data-kind="video"][data-index="0"] [data-testid="clip"]').first().boundingBox())!
    await page.mouse.click((row.x + clip.x) / 2, row.y + row.height / 2, { button: 'right' })
    await page.waitForSelector('[data-testid="gap-menu"]', WAIT)
    await page.click('[data-testid="gap-menu-black"]')
    await expect.poll(async () => (await pictures()).length, WAIT).toBe(2)
    const black = (await pictures()).find((c) => c.colour)!
    expect(black).toMatchObject({ track: 0, start: 0, length: second!.start })
  })
})
