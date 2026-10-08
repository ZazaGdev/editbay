import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 100: Follow face. A 1280 x 720 recording with a portrait (Neil
 * Armstrong's NASA photo, public domain, in test/fixtures/face.png) sliding
 * from left to right over three and a half seconds, cut to a vertical frame.
 * Follow face finds it on this PC and keyframes the crop: on the face at the
 * start, on the face at the end, in a few pans rather than a keyframe on every
 * frame. A recording with no face says so and changes nothing.
 */

const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-face-'))
const facePath = join(root, 'face.mp4')
const noFacePath = join(root, 'no-face.mp4')
const stillPath = join(root, 'still-face.mp4')
let app: ElectronApplication
let page: Page

/** Where the face's middle is in the 200 px portrait, and where the portrait is at the start and end. */
const FACE_IN_PORTRAIT = 137
const FROM_X = 100
const TO_X = 800
/** Where the portrait sits, still, in the recording Centre on face is tried on (task 100). */
const STILL_X = 700

beforeAll(async () => {
  await capture(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x556677:s=1280x720:r=30:d=5',
    '-i', join(process.cwd(), 'test', 'fixtures', 'face.png'),
    '-filter_complex', `[0][1]overlay=x='${FROM_X}+min(t\\,3.5)*${(TO_X - FROM_X) / 3.5}':y=200`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', facePath
  ])
  await capture(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x556677:s=1280x720:r=30:d=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', noFacePath
  ])
  await capture(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x556677:s=1280x720:r=30:d=3',
    '-i', join(process.cwd(), 'test', 'fixtures', 'face.png'),
    '-filter_complex', `[0][1]overlay=x=${STILL_X}:y=200`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', stillPath
  ])
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/** A new vertical project with `path` on V1, selected. */
async function fresh(path: string): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.evaluate(() => window.api.setAppSettings({ lastShape: 'vertical', lastFraming: null }))
  await page.keyboard.press('Control+n')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 0)
  await page.evaluate((p) => window.api.importFiles([p]), path)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]')
  const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
  await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
  await page.waitForSelector('[data-testid="follow-face"]')
}

async function mainZoom(): Promise<{ crop: { x: number; w: number }; keys: { at: number; crop: { x: number; w: number } }[] }> {
  return page.evaluate(async () => {
    const p = await window.api.currentProject()
    const c = p.sequences[0]!.videoTracks.flatMap((t) => t.clips)[0]!
    return { crop: c.transform.crop, keys: c.transform.keys ?? [] }
  })
}

const toast = (kind: string): Promise<string | null> => page.locator(`[data-kind="${kind}"]`).last().textContent(WAIT)

describe('Follow face', () => {
  it('keyframes the crop to keep a moving face in frame, in a few pans', async () => {
    await fresh(facePath)
    const before = await mainZoom()
    expect(before.keys).toHaveLength(0)
    await page.click('[data-testid="follow-face"]')
    expect(await toast('follow-face-done')).toContain('follows the face')
    await page.waitForSelector('[data-testid="follow-face"][data-busy="no"]')
    const { keys } = await mainZoom()
    expect(keys.length).toBeGreaterThanOrEqual(2)
    expect(keys.length).toBeLessThanOrEqual(6)
    const first = keys[0]!.crop
    const last = keys[keys.length - 1]!.crop
    // The crop keeps its size, and a face leaving the middle third is what moves it.
    expect(first.w).toBeCloseTo(before.crop.w, 0)
    const middle = (r: { x: number; w: number }): number => r.x + r.w / 2
    // At the start the face is near the left edge, so the crop is held at it.
    expect(middle(first)).toBeLessThan(FROM_X + FACE_IN_PORTRAIT + first.w / 6)
    expect(Math.abs(middle(last) - (TO_X + FACE_IN_PORTRAIT))).toBeLessThan(last.w / 6)
    await page.waitForSelector('[data-testid="zoom-group"][data-mode="keys"]', WAIT)
    // One undo takes it all back.
    await page.keyboard.press('Control+z')
    await page.waitForFunction(async () => {
      const p = await window.api.currentProject()
      return (p.sequences[0]!.videoTracks.flatMap((t) => t.clips)[0]!.transform.keys ?? []).length === 0
    }, undefined, WAIT)
  }, 120_000)

  it('says so when there is no face, and leaves the crop alone', async () => {
    await fresh(noFacePath)
    const before = await mainZoom()
    await page.click('[data-testid="follow-face"]')
    expect(await toast('follow-face-none')).toContain('No face found')
    expect(await mainZoom()).toEqual(before)
  }, 120_000)
})

describe('Centre on face', () => {
  it('moves the crop of every clip so the face is in its middle, one still place each, in one undo', async () => {
    await fresh(stillPath)
    // A second clip of the same recording.
    await page.locator('[data-testid="add-to-timeline"]').first().click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === 2)
    const crops = (): Promise<{ crop: { x: number; w: number }; keys: unknown[] }[]> =>
      page.evaluate(async () =>
        (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips.map((c) => ({ crop: c.transform.crop, keys: c.transform.keys ?? [] }))
      )
    const before = await crops()
    await page.click('[data-testid="centre-face"]')
    expect(await toast('centre-face-done')).toContain('middle on 2 clips')
    await page.waitForSelector('[data-testid="centre-face"][data-busy="no"]')
    const after = await crops()
    for (const [i, c] of after.entries()) {
      expect(Math.abs(c.crop.x + c.crop.w / 2 - (STILL_X + FACE_IN_PORTRAIT))).toBeLessThan(8)
      expect(c.crop.w).toBeCloseTo(before[i]!.crop.w, 0)
      // Still: no keyframes.
      expect(c.keys).toHaveLength(0)
    }
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(crops, WAIT).toEqual(before)
  }, 120_000)
})
