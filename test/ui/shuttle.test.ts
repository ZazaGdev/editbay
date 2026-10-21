import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 17 step 3, driven through the real window: L plays and plays faster,
 * J plays backwards, K stops, K held with J or L steps a frame, the speed
 * chosen in the transport bar is what Space plays at, and Loop repeats the
 * selected clip.
 *
 * V1 holds the 4 second clean clip three times over, 0 to 360.
 */

const fx = fixtureSet('shuttle-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-shuttle-'))
const userData = join(root, 'user-data')
let app: ElectronApplication
let page: Page
/** Frames played in a second at 1x on this machine just now, which the other speeds are measured against. */
let oneSecond = 0

beforeAll(async () => {
  const clean = await fx.cleanClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  const [asset] = await page.evaluate((p) => window.api.importFiles(p), [clean])
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 180_000 })
  for (let n = 1; n <= 3; n++) {
    await page.locator(`[data-testid="asset"][data-asset-id="${asset!.id}"] [data-testid="add-to-timeline"]`).click()
    await page.waitForFunction((want) => document.querySelectorAll('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').length === want, n, WAIT)
  }
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

async function playhead(): Promise<number> {
  return Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
}

async function playing(): Promise<boolean> {
  return (await page.getAttribute('[data-testid="play-pause"]', 'data-playing')) === 'yes'
}

/** How many frames the playhead moves in `ms`, once it has got going. */
async function advance(ms: number): Promise<number> {
  // Measured once the playhead is on its way: the first moments of playing
  // from a seek are the player reading the file, which is not its speed.
  const start = await playhead()
  await expect.poll(async () => Math.abs((await playhead()) - start), WAIT).toBeGreaterThan(5)
  await page.waitForTimeout(200)
  const from = await playhead()
  await page.waitForTimeout(ms)
  return (await playhead()) - from
}

/** How light the middle of the Output view is, 0 to 255: the picture, or black. */
async function outputLightness(): Promise<number> {
  const side = page.locator('[data-testid="monitor-side"][data-side="program"]')
  const file = join(root, `shot-${Date.now()}.png`)
  await writeFile(file, await side.screenshot())
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const size = String(probe).match(/, (\d+)x(\d+)/)
  const [w = 2, h = 2] = size ? [Number(size[1]), Number(size[2])] : []
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${Math.round(w / 2)}:${Math.round(h / 2)},format=gray`, '-f', 'rawvideo', 'pipe:1'])
  return stdout[0] ?? 0
}

async function stop(): Promise<void> {
  if (await playing()) await press('KeyK')
  await expect.poll(playing, WAIT).toBe(false)
}

describe('J, K and L', () => {
  it('plays with L, and faster with L again', async () => {
    await press('Home')
    await press('KeyL')
    await expect.poll(playing, WAIT).toBe(true)
    oneSecond = await advance(1000)
    expect(oneSecond).toBeGreaterThan(15)
    await page.keyboard.press('KeyL')
    await expect.poll(() => page.getAttribute('[data-testid="shuttle-rate"]', 'data-rate'), WAIT).toBe('1.5')
    const faster = await advance(1000)
    expect(faster / oneSecond).toBeGreaterThan(1.2)
    expect(faster / oneSecond).toBeLessThan(1.8)
  })

  it('stops with K', async () => {
    await press('KeyK')
    await expect.poll(playing, WAIT).toBe(false)
    const at = await playhead()
    await page.waitForTimeout(300)
    expect(await playhead()).toBe(at)
  })

  it('plays backwards with J, and K stops it', async () => {
    await press('End')
    const from = await playhead()
    await press('KeyJ')
    await expect.poll(() => page.getAttribute('[data-testid="shuttle-rate"]', 'data-rate'), WAIT).toBe('-1')
    await expect.poll(playhead, WAIT).toBeLessThan(from - 10)
    // The picture shows while it goes backwards, not black.
    expect(await playing()).toBe(true)
    expect(await outputLightness()).toBeGreaterThan(20)
    await stop()
  })

  it('steps one frame with J or L while K is held', async () => {
    await press('Home')
    await press('ArrowRight')
    await expect.poll(playhead, WAIT).toBe(1)
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.down('KeyK')
    await page.keyboard.press('KeyL')
    await page.keyboard.press('KeyL')
    await expect.poll(playhead, WAIT).toBe(3)
    await page.keyboard.press('KeyJ')
    await expect.poll(playhead, WAIT).toBe(2)
    await page.keyboard.up('KeyK')
    expect(await playing()).toBe(false)
    // Let go of K, L plays again.
    await page.keyboard.press('KeyL')
    await expect.poll(playing, WAIT).toBe(true)
    await stop()
  })
})

describe('the speed and Loop', () => {
  it('plays at the speed chosen when Space is pressed', async () => {
    await page.selectOption('[data-testid="speed"]', '2')
    await press('Home')
    await press('Space')
    await expect.poll(playing, WAIT).toBe(true)
    const frames = await advance(1000)
    expect(frames / oneSecond).toBeGreaterThan(1.5)
    expect(frames / oneSecond).toBeLessThan(2.5)
    await press('Space')
    await expect.poll(playing, WAIT).toBe(false)
    await page.selectOption('[data-testid="speed"]', '1')
  })

  it('repeats the selected clip with Loop on, and Ctrl+L turns it off', async () => {
    // The second clip, 120 to 240.
    const clip = (await page.locator('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').nth(1).boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
    await press('ControlOrMeta+KeyL')
    await expect.poll(() => page.getAttribute('[data-testid="loop"]', 'aria-pressed'), WAIT).toBe('true')
    await press('Home')
    await press('Space')
    // Played from outside the clip, it starts at its start at once; four and a half seconds later it has gone round.
    await expect.poll(playhead, { timeout: 1000 }).toBeGreaterThanOrEqual(120)
    await page.waitForTimeout(4500)
    expect(await playing()).toBe(true)
    const at = await playhead()
    expect(at).toBeGreaterThanOrEqual(120)
    expect(at).toBeLessThan(240)
    await press('Space')
    await press('ControlOrMeta+KeyL')
    await expect.poll(() => page.getAttribute('[data-testid="loop"]', 'aria-pressed'), WAIT).toBe('false')
  })
})
