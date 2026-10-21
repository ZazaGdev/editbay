import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Closing up that would push a clip out of step is refused, and says why,
 * driven through the real window.
 *
 * V1 holds the 4 second clean clip twice, A (0 to 120) and X (120 to 240),
 * then the 3 second OBS stand-in, B, from 240, its second stream on A2. A one second
 * sound on A2 from 100 to 130 runs across X's start: taking X out, or its
 * end, and closing up would bring B's second stream up against it, and the
 * track would push that stream along, out of step with B's picture.
 */

const fx = fixtureSet('close-up-blocked-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-close-up-blocked-'))
const userData = join(root, 'user-data')
/** Pixels per frame at the closest zoom, which the sound is dropped at. */
const PX = 6
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  const [clean, obs, beep] = [await fx.cleanClip(), await fx.obsClip(), await fx.beepWav()]
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  const assets = await page.evaluate((p) => window.api.importFiles(p), [clean, obs, beep])
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length === 3, undefined, {
    timeout: 180_000
  })
  for (const [n, id] of [assets[0]!.id, assets[0]!.id, assets[1]!.id].entries()) {
    await page.locator(`[data-testid="asset"][data-asset-id="${id}"] [data-testid="add-to-timeline"]`).click()
    await page.waitForFunction((want) => document.querySelectorAll('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').length === want, n + 1, WAIT)
  }
  while (Number(await page.getAttribute('[data-testid="zoom-out"]', 'data-zoom')) < 9) await press('Equal')
  await press('Home')
  const a2 = '[data-testid="track"][data-kind="audio"][data-index="1"]'
  const row = (await page.locator(a2).boundingBox())!
  await page.dragAndDrop(`[data-testid="asset"][data-asset-id="${assets[2]!.id}"]`, a2, { targetPosition: { x: 100 * PX + 0.1, y: row.height / 2 } })
  await page.waitForFunction(
    async () => ((await window.api.currentProject()).sequences[0]!.audioTracks[1]?.clips ?? []).some((c) => c.timelineStart === 100),
    undefined,
    WAIT
  )
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

/** V1's clips, each as its start and its length. */
async function v1(): Promise<[number, number][]> {
  return page.evaluate(async () =>
    (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips.map((c) => [c.timelineStart, c.sourceOut - c.sourceIn] as [number, number])
  )
}

/** A2's clips, each as its start and its length. */
async function sound(): Promise<[number, number][]> {
  return page.evaluate(async () =>
    ((await window.api.currentProject()).sequences[0]!.audioTracks[1]?.clips ?? []).map((c) => [c.timelineStart, c.sourceOut - c.sourceIn] as [number, number])
  )
}

async function selectX(): Promise<void> {
  const x = (await page.locator('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').nth(1).boundingBox())!
  await page.mouse.click(x.x + x.width / 2, x.y + x.height / 2)
  await page.waitForSelector('[data-testid="track"][data-track-id="v1"] [data-testid="clip"][data-selected="yes"]', WAIT)
}

describe('closing up with a clip in the way', () => {
  it('refuses Shift+Delete, saying which track, and changes nothing', async () => {
    const before = { v1: await v1(), a2: await sound() }
    expect(before.v1.slice(0, 2)).toEqual([
      [0, 120],
      [120, 120]
    ])
    expect(before.v1[2]![0]).toBe(240)
    await selectX()
    await press('Shift+Delete')
    await expect.poll(() => page.locator('[data-testid="toast"]').filter({ hasText: 'cannot be removed closing up' }).count(), WAIT).toBe(1)
    expect(await page.locator('[data-testid="toast"]').filter({ hasText: 'on A2 out of step' }).count()).toBe(1)
    expect(await v1()).toEqual(before.v1)
    expect(await sound()).toEqual(before.a2)
  })

  it('refuses O on V1 that would close up past the sound, and changes nothing', async () => {
    const before = await v1()
    // The playhead at 125, inside X: O would take out 125 to 240.
    await press('Home')
    await press('ArrowDown')
    await press('ArrowDown')
    for (let i = 0; i < 5; i++) await press('ArrowRight')
    await expect.poll(() => page.getAttribute('[data-testid="timecode"]', 'data-playhead'), WAIT).toBe('125')
    await selectX()
    await press('KeyO')
    await expect.poll(() => page.locator('[data-testid="toast"]').filter({ hasText: 'This trim cannot close up' }).count(), WAIT).toBe(1)
    expect(await v1()).toEqual(before)
  })

  it('still takes X out with Delete, leaving a gap, since that closes nothing up', async () => {
    const before = await v1()
    await selectX()
    await press('Delete')
    await expect.poll(v1, WAIT).toEqual([before[0], before[2]])
    await press('ControlOrMeta+z')
    await expect.poll(async () => (await v1()).length, WAIT).toBe(3)
  })
})
