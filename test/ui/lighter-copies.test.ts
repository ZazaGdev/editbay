import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { fitInBox } from '../../src/shared/crop-geometry'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 67: Play lighter copies. Turned on in Settings, the Output view plays a
 * small copy of the recording, with the same part of it in the same place;
 * turned off, the recording again.
 *
 * The recording is 3840 wide, red on its left half and blue on its right, so
 * the vertical frame shows red on its left and blue on its right, and a crop
 * taken at the wrong scale from the copy would show one colour or the other.
 */

const fx = fixtureSet('ui-lighter')
const root = await mkdtemp(join(tmpdir(), 'editbay-lighter-'))
const WAIT = { timeout: 30_000 }
let app: ElectronApplication
let page: Page
let shot = 0

beforeAll(async () => {
  const obs = await fx.obsClip(30)
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), obs)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]')
  await page.keyboard.press('Home')
  if ((await page.getAttribute('[data-testid="monitor-stage"]', 'data-view')) !== 'program') await page.click('[data-testid="view-program"]')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

type Colour = 'red' | 'blue' | 'other'

/** The colour at a point of the output frame, as the Output view draws it now. */
async function colourAt(fx0: number, fy0: number): Promise<Colour> {
  const side = page.locator('[data-testid="monitor-side"][data-focused="yes"]')
  const stage = (await side.count()) > 0 ? side : page.locator('[data-testid="monitor-stage"]')
  const box = (await stage.boundingBox())!
  shot += 1
  const file = join(root, `shot-${shot}.png`)
  await writeFile(file, await stage.screenshot())
  const { stderr } = await capture(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? '' }))
  const m = String(stderr).match(/, (\d+)x(\d+)/)
  const scale = m ? Number(m[1]) / box.width : 1
  const fit = fitInBox(1080, 1920, box.width, box.height)
  const x = Math.round((fit.offsetX + fx0 * fit.width) * scale)
  const y = Math.round((fit.offsetY + fy0 * fit.height) * scale)
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  const [r = 0, g = 0, b = 0] = stdout
  if (r > 150 && g < 80 && b < 80) return 'red'
  if (b > 150 && r < 80 && g < 80) return 'blue'
  return 'other'
}

/** The files the Output view's players have loaded. */
const playing = (): Promise<string[]> => page.evaluate(() => [...document.querySelectorAll('video')].map((v) => decodeURIComponent(v.src)))

async function setLighter(on: boolean): Promise<void> {
  await page.click('[data-testid="open-settings"]')
  await page.click('[data-testid="settings-tab"][data-tab="Monitor"]')
  await page.waitForSelector('[data-testid="settings-pane"][data-tab="Monitor"]')
  const box = page.locator('[data-testid="setting-lighter-copies"]')
  if (on) await box.check()
  else await box.uncheck()
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="settings"]', { state: 'detached' })
}

describe('lighter copies', () => {
  it('plays the recording itself while off, which is how the app starts', async () => {
    await expect.poll(async () => (await playing()).some((p) => /lighter\./.test(p)), WAIT).toBe(false)
    await expect.poll(() => colourAt(0.3, 0.5), WAIT).toBe('red')
    await expect.poll(() => colourAt(0.7, 0.5), WAIT).toBe('blue')
  })

  it('plays a small copy once turned on, with the same part of the picture in the same place', async () => {
    await setLighter(true)
    await expect.poll(async () => (await playing()).some((p) => /lighter\.mkv$/.test(p)), WAIT).toBe(true)
    await expect.poll(() => colourAt(0.3, 0.5), WAIT).toBe('red')
    expect(await colourAt(0.7, 0.5)).toBe('blue')
    // The line between the two halves where it was: just either side of the frame's middle.
    expect(await colourAt(0.47, 0.5)).toBe('red')
    expect(await colourAt(0.53, 0.5)).toBe('blue')
  })

  it('plays the recording again once turned off', async () => {
    await setLighter(false)
    // The player showing the clip loads the recording again. Each track keeps a second player
    // ready for the next clip, which can still hold the copy until it is next needed.
    const loaded = (): Promise<boolean> =>
      page.evaluate(() => [...document.querySelectorAll('video')].some((v) => /obs-30\.mkv$/.test(decodeURIComponent(v.src)) && v.readyState >= 2))
    await expect.poll(loaded, WAIT).toBe(true)
    await expect.poll(() => colourAt(0.3, 0.5), WAIT).toBe('red')
  })
})
