import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 90, the effects library through the real window: a folder chosen in
 * Settings shows in Sources as Effects; a green screen effect put over the
 * selected clip lands on the track above it, from where it starts, with its
 * background taken out and the clip still selected; a sound effect lands on a
 * free sound track; and an effect dragged onto the timeline lands where it is
 * let go.
 */

const fx = fixtureSet('ui-effects')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-effects-'))
const effectsDir = join(root, 'My effects')
let app: ElectronApplication
let page: Page

interface Placed {
  id: string
  track: string
  start: number
  removal: string | null
}

async function pictures(): Promise<Placed[]> {
  return page.evaluate(async () =>
    (await window.api.currentProject()).sequences[0]!.videoTracks.flatMap((t) =>
      t.clips.map((c) => ({ id: c.id, track: t.id, start: c.timelineStart, removal: c.removeBackground?.colour ?? null }))
    )
  )
}

async function sounds(): Promise<{ track: string; start: number; media: string }[]> {
  return page.evaluate(async () => {
    const p = await window.api.currentProject()
    return p.sequences[0]!.audioTracks.flatMap((t) =>
      t.clips.map((c) => ({ track: t.id, start: c.timelineStart, media: p.media.find((m) => m.id === c.mediaId)?.originalPath ?? '' }))
    )
  })
}

beforeAll(async () => {
  await mkdir(effectsDir, { recursive: true })
  const make = (args: string[], name: string): Promise<unknown> =>
    capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args, join(effectsDir, name)])
  await make(
    ['-f', 'lavfi', '-i', 'color=c=0x00B140:s=640x360:r=30:d=2', '-vf', 'drawbox=x=280:y=135:w=80:h=90:color=white:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast'],
    'green star.mp4'
  )
  await make(['-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=1'], 'ding.wav')
  const red = await fx.redClip()

  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), red)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"][data-kind="video"]')
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** The Effects entry in Sources, opened. */
async function openEffects(): Promise<void> {
  const entry = page.locator('[data-testid="source-folder"][data-kind="effects"]')
  await entry.waitFor(WAIT)
  if ((await entry.getAttribute('data-open')) !== 'yes') await entry.locator('[data-testid="folder-toggle"]').click()
  await page.waitForSelector('[data-testid="folder-file"][data-effect="yes"]', WAIT)
}

async function selectRed(): Promise<string> {
  const clip = page.locator('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').first()
  const box = (await clip.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForSelector('[data-testid="track"][data-track-id="v1"] [data-testid="clip"][data-selected="yes"]', WAIT)
  return (await clip.getAttribute('data-clip-id'))!
}

describe('the effects folder', () => {
  it('is chosen in Settings and shows in Sources as Effects', async () => {
    await app.evaluate(async ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, effectsDir)
    await page.click('[data-testid="open-settings"]')
    await page.click('[data-testid="settings-tab"][data-tab="Sources"]')
    await page.click('[data-testid="setting-effects-choose"]')
    await expect.poll(() => page.textContent('[data-testid="setting-effects-folder"]'), WAIT).toBe(effectsDir)
    await page.click('[data-testid="settings-close"]')
    await openEffects()
    expect(await page.locator('[data-testid="folder-file"][data-effect="yes"]').count()).toBe(2)
  })

  it('puts a green screen effect over the selected clip, on the track above, its background taken out, the clip still selected', async () => {
    // From part way in, so "where the clip starts" is not just the start of the sequence.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('End')
    const red = await selectRed()
    await openEffects()
    await page.click('[data-testid="folder-file"][data-name="green star.mp4"]', { button: 'right' })
    await page.click('[data-testid="effect-apply"]')
    await expect.poll(async () => (await pictures()).length, { timeout: 120_000 }).toBe(2)
    const effect = (await pictures()).find((c) => c.id !== red)!
    expect(effect.track).not.toBe('v1')
    expect(effect.start).toBe(0)
    await expect.poll(async () => (await pictures()).find((c) => c.id === effect.id)?.removal, WAIT).toBe('green')
    expect(await page.getAttribute(`[data-testid="clip"][data-clip-id="${red}"]`, 'data-selected')).toBe('yes')
    // Put on and keyed in one step: one Undo takes it all away, never leaving it green over the clip.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => (await pictures()).length, WAIT).toBe(1)
    await page.keyboard.press('ControlOrMeta+y')
    await expect.poll(async () => (await pictures()).find((c) => c.id === effect.id)?.removal, WAIT).toBe('green')
  })

  it('puts a sound effect on a free sound track, from where the clip starts', async () => {
    await selectRed()
    await page.click('[data-testid="folder-file"][data-name="ding.wav"]', { button: 'right' })
    await page.click('[data-testid="effect-apply"]')
    await expect.poll(async () => (await sounds()).filter((s) => s.media.endsWith('ding.wav')).length, { timeout: 120_000 }).toBe(1)
    const ding = (await sounds()).find((s) => s.media.endsWith('ding.wav'))!
    expect(ding.start).toBe(0)
    // Not on top of the red clip's own sound.
    const own = (await sounds()).find((s) => !s.media.endsWith('ding.wav'))!
    expect(ding.track).not.toBe(own.track)
  })

  it('puts an effect where it is dragged onto the timeline', async () => {
    const before = (await pictures()).length
    const track = page.locator('[data-testid="track"][data-track-id="v1"]')
    const box = (await track.boundingBox())!
    await page.locator('[data-testid="folder-file"][data-name="green star.mp4"]').dragTo(track, { targetPosition: { x: box.width - 20, y: box.height / 2 } })
    await expect.poll(async () => (await pictures()).length, { timeout: 120_000 }).toBe(before + 1)
    const dropped = (await pictures()).sort((a, b) => b.start - a.start)[0]!
    expect(dropped.track).toBe('v1')
    expect(dropped.start).toBeGreaterThan(0)
    expect(dropped.removal).toBe('green')
  })
})
