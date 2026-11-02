import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Remove silences, driven through the real window: the pauses in a
 * recording's talking found and shaded on the timeline, one kept by clicking
 * it, the rest taken out closing up, and all of it back with one undo.
 *
 * The recording is 6 seconds at 30 fps of a steady tone, silent from 1.5 to
 * 2.5 s, from 3.0 to 3.3 s, and from 4 to 5 s: two pauses at the defaults
 * (0.5 s or longer), and a third once pauses of 0.2 s count.
 */

const fx = fixtureSet('silences-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-silences-'))
const userData = join(root, 'user-data')
let app: ElectronApplication
let page: Page

async function talking(): Promise<string> {
  await mkdir(fx.dir, { recursive: true })
  const out = join(fx.dir, 'talking.mp4')
  await capture(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
    '-af', "volume=enable='between(t,1.5,2.5)+between(t,3,3.3)+between(t,4,5)':volume=0",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2',
    '-shortest',
    out
  ])
  return out
}

beforeAll(async () => {
  const file = await talking()
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  const [asset] = await page.evaluate((p) => window.api.importFiles(p), [file])
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length === 1, undefined, {
    timeout: 180_000
  })
  await page.locator(`[data-testid="asset"][data-asset-id="${asset!.id}"] [data-testid="add-to-timeline"]`).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').length === 1, undefined, WAIT)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** V1's clips, each as its start, and its stretch of the recording. */
async function v1(): Promise<[number, number, number][]> {
  return page.evaluate(async () =>
    (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips.map(
      (c) => [c.timelineStart, c.sourceIn, c.sourceOut] as [number, number, number]
    )
  )
}

/** The pauses shaded on the timeline, as their first frame, the frame after, and whether kept. */
async function shaded(): Promise<{ from: number; to: number; kept: boolean }[]> {
  return page.locator('[data-testid="pause"]').evaluateAll((els) =>
    els.map((el) => ({
      from: Number(el.getAttribute('data-from')),
      to: Number(el.getAttribute('data-to')),
      kept: el.getAttribute('data-kept') === 'yes'
    }))
  )
}

async function open(): Promise<void> {
  if ((await page.locator('[data-testid="silence-panel"]').count()) > 0) return
  await page.locator('[data-testid="remove-silences"]').click()
  await page.waitForSelector('[data-testid="silence-panel"]', WAIT)
}

/** A key pressed with nothing in particular focused, so it reaches the editor. */
async function press(key: string): Promise<void> {
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press(key)
}

describe('Remove silences', () => {
  it('shades the pauses in the talking, leaving a little of each, and a shorter one only once told to count it', async () => {
    await open()
    await expect.poll(async () => (await shaded()).length, WAIT).toBe(2)
    const [first, second] = await shaded()
    // Silent from 45 to 75 and from 120 to 150, 3 frames of each left either side, give or take a frame of the sound's encoding.
    expect(Math.abs(first!.from - 48)).toBeLessThanOrEqual(2)
    expect(Math.abs(first!.to - 72)).toBeLessThanOrEqual(2)
    expect(Math.abs(second!.from - 123)).toBeLessThanOrEqual(2)
    expect(Math.abs(second!.to - 147)).toBeLessThanOrEqual(2)
    expect(await page.locator('[data-testid="silence-remove"]').textContent()).toBe('Take 2 pauses out')

    // The three numbers sit behind the named judgement now, so they are opened
    // before they can be typed into.
    await page.click('[data-testid="pause-numbers"]')
    await page.waitForSelector('[data-testid="silence-shortest"]')
    await page.locator('[data-testid="silence-shortest"]').fill('0.2')
    await expect.poll(async () => (await shaded()).length, WAIT).toBe(3)
    await page.locator('[data-testid="silence-shortest"]').fill('0.5')
    await page.locator('[data-testid="silence-shortest"]').press('Enter')
    await expect.poll(async () => (await shaded()).length, WAIT).toBe(2)
  })

  it('closes with Esc, changing nothing', async () => {
    await open()
    const before = await v1()
    await press('Escape')
    await expect.poll(() => page.locator('[data-testid="silence-panel"]').count(), WAIT).toBe(0)
    expect(await page.locator('[data-testid="pause"]').count()).toBe(0)
    expect(await v1()).toEqual(before)
  })

  it('closes from the X in its corner, which does what Cancel does', async () => {
    await open()
    const before = await v1()

    // In the corner of the panel rather than down beside Cancel.
    const panel = (await page.locator('[data-testid="silence-panel"]').boundingBox())!
    const x = (await page.locator('[data-testid="silence-close"]').boundingBox())!
    expect(x.y - panel.y).toBeLessThan(16)
    expect(panel.x + panel.width - (x.x + x.width)).toBeLessThan(16)

    // The panel is open with pauses marked to be taken, so a close that
    // applied anything would show up in the cuts on V1 afterwards.
    await page.click('[data-testid="silence-close"]')
    await expect.poll(() => page.locator('[data-testid="silence-panel"]').count(), WAIT).toBe(0)
    expect(await page.locator('[data-testid="pause"]').count()).toBe(0)
    expect(await v1()).toEqual(before)
  })

  it('keeps a pause clicked, takes the rest out closing up, and brings it all back with one undo', async () => {
    await open()
    await expect.poll(async () => (await shaded()).length, WAIT).toBe(2)
    const [first, second] = await shaded()

    await page.locator(`[data-testid="pause"][data-from="${first!.from}"]`).click()
    await expect.poll(async () => (await shaded()).map((p) => p.kept), WAIT).toEqual([true, false])
    // The playhead goes to the pause, so it can be played.
    expect(Number(await page.locator('[data-testid="timecode"]').getAttribute('data-playhead'))).toBe(first!.from)
    expect(await page.locator('[data-testid="silence-remove"]').textContent()).toBe('Take 1 pause out')

    await page.locator('[data-testid="silence-remove"]').click()
    await expect.poll(() => page.locator('[data-testid="silence-panel"]').count(), WAIT).toBe(0)
    const cut = second!.to - second!.from
    await expect.poll(v1, WAIT).toEqual([
      [0, 0, second!.from],
      [second!.from, second!.to, 180]
    ])
    expect(Number(await page.locator('[data-testid="timecode"]').getAttribute('data-total'))).toBe(180 - cut)
    await expect.poll(() => page.locator('[data-testid="toast"]').filter({ hasText: 'Removed 1 pause' }).count(), WAIT).toBe(1)

    await press('ControlOrMeta+z')
    await expect.poll(v1, WAIT).toEqual([[0, 0, 180]])
  })
})

describe('Remove silences as a review step', () => {
  it('says what the edit will be afterwards, and by how much it shrinks', async () => {
    await open()
    await expect.poll(async () => (await shaded()).length, WAIT).toBe(2)
    const after = page.locator('[data-testid="silence-after"]')
    const now = Number(await after.getAttribute('data-now'))
    const saved = Number(await after.getAttribute('data-saved'))
    expect(now).toBeGreaterThan(0)
    expect(saved).toBeGreaterThan(0)
    expect(Number(await after.getAttribute('data-after'))).toBe(now - saved)
  })

  it('offers three named ways to judge a pause, each setting the three numbers behind it', async () => {
    await open()
    await expect.poll(async () => (await shaded()).length, WAIT).toBe(2)
    // Normal is what the app starts on, and its numbers are the defaults.
    expect(await page.getAttribute('[data-testid="pause-judgement-normal"]', 'aria-pressed')).toBe('true')
    await page.click('[data-testid="pause-numbers"]')
    await page.waitForSelector('[data-testid="silence-shortest"]')
    expect(await page.inputValue('[data-testid="silence-shortest"]')).toBe('0.5')

    // Careful is stricter about what counts, so it finds no more than Normal does.
    await page.click('[data-testid="pause-judgement-careful"]')
    await expect.poll(() => page.inputValue('[data-testid="silence-shortest"]'), WAIT).toBe('0.8')
    await expect.poll(async () => (await shaded()).length, WAIT).toBeLessThanOrEqual(2)

    await page.click('[data-testid="pause-judgement-tight"]')
    await expect.poll(() => page.inputValue('[data-testid="silence-shortest"]'), WAIT).toBe('0.3')

    // A number typed by hand belongs to none of the three.
    await page.locator('[data-testid="silence-shortest"]').fill('0.44')
    await page.locator('[data-testid="silence-shortest"]').press('Enter')
    await expect.poll(() => page.getAttribute('[data-testid="pause-judgement-tight"]', 'aria-pressed'), WAIT).toBe('false')

    await page.click('[data-testid="pause-judgement-normal"]')
    await expect.poll(async () => (await shaded()).length, WAIT).toBe(2)
    await page.click('[data-testid="pause-numbers"]')
  })

  it('lists every pause, walks them with the arrows, and keeps the one Enter is pressed on', async () => {
    await open()
    await expect.poll(async () => (await shaded()).length, WAIT).toBe(2)
    expect(await page.locator('[data-testid="pause-row"]').count()).toBe(2)

    await page.click('[data-testid="pause-list"]')
    await page.keyboard.press('ArrowDown')
    expect(await page.getAttribute('[data-testid="pause-row"][data-row="1"]', 'aria-selected')).toBe('true')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await shaded()).map((p) => p.kept), WAIT).toEqual([false, true])
    // Kept, so only one is left to take.
    expect(await page.locator('[data-testid="silence-remove"]').textContent()).toBe('Take 1 pause out')

    await page.keyboard.press('Enter')
    await expect.poll(async () => (await shaded()).map((p) => p.kept), WAIT).toEqual([false, false])
  })

  it('keeps all of them, and takes all of them again', async () => {
    await open()
    await expect.poll(async () => (await shaded()).length, WAIT).toBe(2)
    await page.click('[data-testid="pause-keep-all"]')
    await expect.poll(async () => (await shaded()).every((p) => p.kept), WAIT).toBe(true)
    expect(await page.locator('[data-testid="silence-remove"]').isDisabled()).toBe(true)
    await page.click('[data-testid="pause-take-all"]')
    await expect.poll(async () => (await shaded()).some((p) => p.kept), WAIT).toBe(false)
    await press('Escape')
    await page.waitForSelector('[data-testid="silence-panel"]', { state: 'detached' })
  })

  it('explains its keys behind a "?" that opens its tutorial, not in a line of text (task 60)', async () => {
    await open()
    expect(await page.textContent('[data-testid="silence-panel"]')).not.toContain('Up and Down step through them')
    const help = page.locator('[data-testid="silence-help"]')
    expect(await help.getAttribute('title')).toContain('Up and Down step through them')
    await help.click()
    await page.waitForSelector('[data-testid="tutorials"]')
    await expect.poll(() => page.textContent('[data-testid="tutorial-body"] h2')).toBe('Remove silences')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="tutorials"]', { state: 'detached' })
    await press('Escape')
    await page.waitForSelector('[data-testid="silence-panel"]', { state: 'detached' })
  })
})
