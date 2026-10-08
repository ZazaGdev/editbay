import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * A long sound clip at the closest zoom still draws its waveform.
 *
 * 400 seconds at 30 fps is 12000 frames, and at 6 pixels a frame that is
 * 72000 pixels: past the 65535 a canvas may be on a side in Chromium. A
 * canvas sized to the whole clip went blank there, silently.
 */

const fx = fixtureSet('waveform-zoom-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-waveform-zoom-'))
const userData = join(root, 'user-data')
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  const long = await fx.solidClip('red', 440, 400)
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  const [asset] = await page.evaluate((p) => window.api.importFiles(p), [long])
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 180_000 })
  await page.locator(`[data-testid="asset"][data-asset-id="${asset!.id}"] [data-testid="add-to-timeline"]`).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="sound-clip"]')?.getAttribute('data-peaks') === 'yes', undefined, WAIT)
  await page.locator('[data-testid="timecode"]').click()
  while (Number(await page.getAttribute('[data-testid="zoom-out"]', 'data-zoom')) < 9) await page.keyboard.press('Equal')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/**
 * How many pixels of waveform are drawn in the part of the sound clip the
 * timeline shows, read off every canvas in it that is on screen.
 */
async function drawnOnScreen(): Promise<number> {
  return page.evaluate(() => {
    const view = document.querySelector('[data-testid="timeline-scroll"]')!.getBoundingClientRect()
    let drawn = 0
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-testid="sound-clip"] canvas')) {
      const box = canvas.getBoundingClientRect()
      if (box.right <= view.left || box.left >= view.right || canvas.width <= 1) continue
      try {
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) drawn++
      } catch {
        // A canvas too big to exist has nothing to read.
      }
    }
    return drawn
  })
}

async function scrollTo(fraction: number): Promise<void> {
  await page.locator('[data-testid="timeline-scroll"]').evaluate((el, f) => {
    el.scrollLeft = (el.scrollWidth - el.clientWidth) * f
  }, fraction)
}

describe('a waveform at the closest zoom', () => {
  it('is wider than a canvas may be, and draws anyway, at the start, the middle and the end', async () => {
    const width = await page.locator('[data-testid="sound-clip"]').evaluate((el) => el.getBoundingClientRect().width)
    expect(width).toBeGreaterThan(65535)
    for (const at of [0, 0.5, 0.97]) {
      await scrollTo(at)
      await expect.poll(drawnOnScreen, WAIT).toBeGreaterThan(1000)
    }
  })

  it('never makes a canvas past the size a canvas may be', async () => {
    const widest = await page.evaluate(() =>
      Math.max(...[...document.querySelectorAll<HTMLCanvasElement>('[data-testid="sound-clip"] canvas')].map((c) => c.width))
    )
    expect(widest).toBeLessThanOrEqual(4096)
  })
})
