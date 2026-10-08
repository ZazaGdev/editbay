import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { answerSaveDialog, discardUnsavedWork } from './dialogs'

/**
 * Recording a voice over from Chromium's fake microphone, which plays a
 * steady tone. The project is saved first, so every take goes in the
 * `Voice overs` folder beside it and never in the real Documents folder.
 *
 * V1 holds the 4 second clean clip, 0 to 120, its sound on A1.
 */

const fx = fixtureSet('voice-over-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-voice-over-'))
const userData = join(root, 'user-data')
const saved = join(root, 'talk.editbay')
const takes = join(root, 'Voice overs')
let app: ElectronApplication
let page: Page
let tone = ''

async function launch(): Promise<void> {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${tone}`],
    cwd: process.cwd()
  })
  page = await app.firstWindow()
  await page.waitForSelector('main')
}

interface Sound {
  id: string
  mediaId: string
  start: number
  length: number
}

beforeAll(async () => {
  const clean = await fx.cleanClip()
  tone = await fx.toneWav()
  await launch()
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), clean)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 180_000 })
  await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForSelector('[data-testid="clip"]', WAIT)
  await answerSaveDialog(app, saved)
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press('Control+s')
  await page.waitForFunction(() => document.title.startsWith('talk '), undefined, WAIT)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** Every sound clip on every audio track, track by track. */
async function sounds(): Promise<Sound[][]> {
  return page.evaluate(async () =>
    (await window.api.currentProject()).sequences[0]!.audioTracks.map((r) =>
      r.clips.map((c) => ({ id: c.id, mediaId: c.mediaId, start: c.timelineStart, length: c.sourceOut - c.sourceIn }))
    )
  )
}

/** The takes on the timeline: sound clips of WAVs in the Voice overs folder. */
async function takesOnTimeline(): Promise<Sound[]> {
  const media = await page.evaluate(async () => (await window.api.currentProject()).media.map((m) => ({ id: m.id, path: m.originalPath })))
  const ours = new Set(media.filter((m) => m.path.includes('Voice overs') && m.path.endsWith('.wav')).map((m) => m.id))
  return (await sounds()).flat().filter((s) => ours.has(s.mediaId))
}

async function playheadTo(frame: number): Promise<void> {
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press('Home')
  for (let i = 0; i < Math.floor(frame / 30); i++) await page.keyboard.press('Shift+ArrowRight')
  for (let i = 0; i < frame % 30; i++) await page.keyboard.press('ArrowRight')
  await expect.poll(async () => Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))).toBe(frame)
}

async function recording(on: boolean): Promise<void> {
  await page.waitForSelector(`[data-testid="record"][data-recording="${on ? 'yes' : 'no'}"]`, WAIT)
}

async function wavsSaved(): Promise<string[]> {
  try {
    return (await readdir(takes)).filter((f) => f.endsWith('.wav'))
  } catch {
    return []
  }
}

describe('recording a voice over', () => {
  it('lands on the first free audio track at the frame where recording began, selected, saved beside the project', async () => {
    await playheadTo(30)
    await page.keyboard.press('KeyR')
    await recording(true)
    // The meter shows the microphone hears something.
    await expect.poll(async () => Number(await page.getAttribute('[data-testid="record-level"]', 'data-level')), WAIT).toBeGreaterThan(0.05)
    await page.waitForTimeout(2000)
    await page.keyboard.press('KeyR')
    await recording(false)
    await expect.poll(async () => (await takesOnTimeline()).length, { timeout: 60_000 }).toBe(1)
    const [take] = await takesOnTimeline()
    expect(take!.start).toBe(30)
    // About two seconds, within a quarter of a second.
    expect(take!.length).toBeGreaterThanOrEqual(53)
    expect(take!.length).toBeLessThanOrEqual(67)
    // A1 has the clip's own sound over 30 to 90, so it goes on a new track below.
    const tracks = await sounds()
    expect(tracks[0]!.some((s) => s.mediaId === take!.mediaId)).toBe(false)
    expect(tracks[1]!.map((s) => s.id)).toEqual([take!.id])
    await page.waitForSelector(`[data-testid="sound-clip"][data-clip-id="${take!.id}"][data-selected="yes"]`, WAIT)
    expect(await wavsSaved()).toHaveLength(1)
    // What it recorded is the tone, not silence.
    const loudest = await page.evaluate(async (id) => {
      const data = await window.api.loadPeaks(id, 0)
      let most = 0
      for (const v of data.peaks) most = Math.max(most, Math.abs(v))
      return most
    }, take!.mediaId)
    expect(loudest).toBeGreaterThan(1000)
  })

  it('takes one undo off the timeline, leaving the take in the bin', async () => {
    const [take] = await takesOnTimeline()
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await takesOnTimeline()).length).toBe(0)
    const inBin = await page.evaluate(async (id) => (await window.api.currentProject()).media.some((m) => m.id === id), take!.mediaId)
    expect(inBin).toBe(true)
    await page.keyboard.press('Control+y')
    await expect.poll(async () => (await takesOnTimeline()).length).toBe(1)
  })

  it('stops and keeps with Space', async () => {
    await playheadTo(0)
    await page.keyboard.press('KeyR')
    await recording(true)
    await page.waitForTimeout(1000)
    await page.keyboard.press('Space')
    await recording(false)
    await expect.poll(async () => (await takesOnTimeline()).length, { timeout: 60_000 }).toBe(2)
    expect((await takesOnTimeline()).some((t) => t.start === 0)).toBe(true)
    expect(await wavsSaved()).toHaveLength(2)
  })

  it('throws a take away with Esc, leaving no clip and no file, and edits nothing while it records', async () => {
    const clips = await page.locator('[data-testid="clip"]').count()
    await playheadTo(60)
    await page.keyboard.press('KeyR')
    await recording(true)
    await page.waitForTimeout(500)
    // S would split V1's clip at 60, and the top bar's Undo would take the last take off: while recording, neither does anything.
    await page.keyboard.press('KeyS')
    const undo = (await page.locator('[data-testid="undo"]').boundingBox())!
    await page.mouse.click(undo.x + undo.width / 2, undo.y + undo.height / 2)
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await recording(false)
    await page.waitForTimeout(1500)
    expect(await page.locator('[data-testid="clip"]').count()).toBe(clips)
    expect(await takesOnTimeline()).toHaveLength(2)
    expect(await wavsSaved()).toHaveLength(2)
    expect((await readdir(takes)).some((f) => f.endsWith('.raw') || f.endsWith('.part'))).toBe(false)
  })

  it('holds the playhead while the microphone opens, and takes Space then to mean never mind', async () => {
    // A microphone that takes a second to answer, as a real one can.
    await page.evaluate(() => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = (c) => new Promise((r) => setTimeout(() => r(real(c)), 1000))
    })
    const before = await wavsSaved()
    await playheadTo(0)
    await page.keyboard.press('KeyR')
    await page.waitForSelector('[data-testid="record"][data-recording="starting"]', WAIT)
    expect(await page.locator('[data-testid="home"]').isDisabled()).toBe(true)
    await page.keyboard.press('Space')
    await page.waitForTimeout(2000)
    expect(Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))).toBe(0)
    expect(await page.getAttribute('[data-testid="record"]', 'data-recording')).toBe('no')
    expect(await wavsSaved()).toEqual(before)
    expect((await readdir(takes)).some((f) => f.includes('(recording)'))).toBe(false)
    expect(await takesOnTimeline()).toHaveLength(2)
  })

  it('remembers Mute the sequence while recording, after a restart', async () => {
    await page.locator('[data-testid="record-menu-toggle"]').click()
    await page.waitForSelector('[data-testid="record-menu"]', WAIT)
    // The fake microphones are listed beside the default, once they have been looked up.
    await expect.poll(() => page.locator('[data-testid="record-mic"]').count(), WAIT).toBeGreaterThan(1)
    await page.locator('[data-testid="record-mute"]').check()
    await expect.poll(async () => (await page.evaluate(() => window.api.appSettings())).muteWhileRecording).toBe(true)
    await page.keyboard.press('Escape')

    const closed = app.waitForEvent('close', { timeout: 30_000 })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await closed
    await launch()
    await page.locator('[data-testid="record-menu-toggle"]').click()
    await page.waitForSelector('[data-testid="record-menu"]', WAIT)
    await expect.poll(() => page.locator('[data-testid="record-mute"]').isChecked(), WAIT).toBe(true)
  })
})
