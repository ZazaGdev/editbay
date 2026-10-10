import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'

/**
 * Ctrl+wheel over the timeline zooms about the pointer, notch after notch
 * (task 125). On a long edit it held for a notch or two and then jumped
 * minutes back.
 */

const root = await mkdtemp(join(tmpdir(), 'editbay-wheel-zoom-'))
const FRAMES = 12 * 60 * 30
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  // Twelve minutes, as the owner's edit was, small and quick to make.
  const long = join(root, 'long.mp4')
  await capture(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=720',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=720',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '300', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', long
  ])
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('main')
  const [asset] = await page.evaluate((p) => window.api.importFiles(p), [long])
  await page.waitForSelector(`[data-testid="asset"][data-asset-id="${asset!.id}"][data-status="ready"]`, { timeout: 180_000 })
  await page.locator(`[data-testid="asset"][data-asset-id="${asset!.id}"] [data-testid="add-to-timeline"]`).click()
  await page.waitForSelector('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]')
}, 300_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const SCROLL = '[data-testid="timeline-scroll"]'
const CLIP = '[data-testid="track"][data-track-id="v1"] [data-testid="clip"]'

/** The frame under a point `x` pixels into the timeline's view, read from the clip that runs the whole edit. */
function frameAt(x: number): Promise<number> {
  return page.evaluate(
    ({ x, frames, scroll, clip }) => {
      const view = document.querySelector(scroll)!.getBoundingClientRect()
      const c = document.querySelector(clip)!.getBoundingClientRect()
      return ((view.left + x - c.left) / c.width) * frames
    },
    { x, frames: FRAMES, scroll: SCROLL, clip: CLIP }
  )
}

/** Pixels per frame on screen now. */
function pxPerFrame(): Promise<number> {
  return page.evaluate(({ frames, clip }) => document.querySelector(clip)!.getBoundingClientRect().width / frames, { frames: FRAMES, clip: CLIP })
}

/** Ctrl+wheel `notches` times at `x` in the view, `pause` milliseconds apart: up zooms in, down zooms out. */
async function wheel(x: number, notches: number, dy: number, pause: number): Promise<void> {
  const view = (await page.locator(SCROLL).boundingBox())!
  await page.mouse.move(view.x + x, view.y + 30)
  await page.keyboard.down('Control')
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, dy)
    if (pause > 0) await page.waitForTimeout(pause)
  }
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
}

describe('Ctrl+wheel over a long timeline', () => {
  for (const pause of [0, 500]) {
    it(`keeps the moment under the pointer where it is, in and out, notches ${pause} ms apart`, async () => {
      // Scrolled to about four minutes in, with the playhead left at the start.
      await page.evaluate((s) => {
        const el = document.querySelector(s) as HTMLElement
        el.scrollLeft = 0
      }, SCROLL)
      await page.locator('[data-testid="timecode"]').click()
      await page.keyboard.press('Home')
      await page.evaluate((s) => {
        const el = document.querySelector(s) as HTMLElement
        el.scrollLeft = el.scrollWidth * 0.33
      }, SCROLL)
      await page.waitForTimeout(200)
      const x = 700
      const held = await frameAt(x)
      const seen: string[] = []
      for (const [notches, dy] of [[10, -100], [14, 100], [6, -100]] as const) {
        await wheel(x, notches, dy, pause)
        const now = await frameAt(x)
        const ppf = await pxPerFrame()
        seen.push(`${notches}x${dy}: frame ${now.toFixed(1)} at ${ppf.toFixed(3)} px/frame`)
        // Within two pixels on screen.
        expect(Math.abs(now - held) * ppf, `${held.toFixed(1)} -> ${seen.join('; ')}`).toBeLessThan(2)
      }
    }, 120_000)
  }
  it('keeps the moment under the pointer while it plays, the playhead well before it', async () => {
    await page.evaluate((s) => {
      ;(document.querySelector(s) as HTMLElement).scrollLeft = 0
    }, SCROLL)
    await page.waitForTimeout(200)
    // The playhead about a minute before the pointer, and playing.
    const view = (await page.locator(SCROLL).boundingBox())!
    await page.mouse.click(view.x + 150, view.y + 8)
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    const x = 900
    const held = await frameAt(x)
    await wheel(x, 10, -100, 120)
    const now = await frameAt(x)
    await page.keyboard.press('Space')
    expect(Math.abs(now - held) * (await pxPerFrame()), `${held.toFixed(1)} -> ${now.toFixed(1)}`).toBeLessThan(2)
  }, 120_000)
})
