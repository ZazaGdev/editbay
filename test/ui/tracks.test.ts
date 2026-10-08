import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * A recording's own streams on audio tracks of their own, driven through the
 * real window, on a file shaped like an OBS recording with three streams: a
 * 440 Hz tone, an 880 Hz tone, and a beep. Dropped from the bin, it lands as
 * its picture on V1 and its three streams on A1 to A3, all linked.
 *
 * The recording is a little over 3 seconds: its third stream starts 20 ms late
 * and runs to its end, so it is 91 frames at the project's 30 fps.
 */

const fx = fixtureSet('tracks-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-tracks-'))
const userData = join(root, 'user-data')
/** Pixels per frame at the zoom a new project starts at, and two steps in. */
const PX = 0.4
const ZOOMED = 1.5
let app: ElectronApplication
let page: Page

interface Placed {
  id: string
  start: number
  length: number
  muted?: boolean
  gain?: number
  link?: string
}

/** Every track's clips as main has them, V1 first then up, A1 first then down. */
async function tracks(): Promise<{ video: Placed[][]; audio: Placed[][] }> {
  return page.evaluate(async () => {
    const s = (await window.api.currentProject()).sequences[0]!
    const placed = (c: { id: string; timelineStart: number; sourceIn: number; sourceOut: number; link?: string }) => ({
      id: c.id,
      start: c.timelineStart,
      length: c.sourceOut - c.sourceIn,
      ...(c.link !== undefined ? { link: c.link } : {})
    })
    return {
      video: s.videoTracks.map((r) => r.clips.map(placed)),
      audio: s.audioTracks.map((r) => r.clips.map((c) => ({ ...placed(c), muted: c.muted, gain: c.gain })))
    }
  })
}

async function undo(): Promise<void> {
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press('Control+z')
}

async function playheadAt(frame: number): Promise<void> {
  await page.waitForFunction((f) => document.querySelector('[data-testid="timecode"]')?.getAttribute('data-playhead') === String(f), frame, WAIT)
}

/** Put the playhead on a frame, a frame at a time from the start, waiting for each. */
async function goTo(frame: number): Promise<void> {
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press('Home')
  await playheadAt(0)
  for (let f = 1; f <= frame; f++) {
    await page.keyboard.press('ArrowRight')
    if (f % 10 === 0 || f === frame) await playheadAt(f)
  }
}

function clipOn(kind: 'video' | 'audio', track: number, index: number) {
  return page
    .locator(`[data-testid="track"][data-kind="${kind}"][data-index="${track}"]`)
    .locator(kind === 'video' ? '[data-testid="clip"]' : '[data-testid="sound-clip"]')
    .nth(index)
}

async function centre(locator: ReturnType<typeof clipOn>): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * Drag by pixels in several movements, as a hand does, with Alt held once the
 * drag has begun so nothing snaps. Held from before the press, Alt would take
 * the clip on its own, without its linked clips.
 */
async function dragFrom(from: { x: number; y: number }, ...to: { dx: number; dy?: number }[]): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.keyboard.down('Alt')
  let at = { x: from.x, y: from.y }
  for (const step of to) {
    const next = { x: from.x + step.dx, y: from.y + (step.dy ?? 0) }
    for (let i = 1; i <= 4; i++) await page.mouse.move(at.x + ((next.x - at.x) * i) / 4, at.y + ((next.y - at.y) * i) / 4)
    at = next
  }
  await page.mouse.up()
  await page.keyboard.up('Alt')
}

beforeAll(async () => {
  const recording = await fx.obsTracksClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), recording)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 180_000 })
  // Every stream's waveform, so the window can tell which have sound in them.
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"]').length === 1, undefined, WAIT)
  await page.waitForTimeout(500)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/**
 * How far the playing copy of a stream is from where the picture says it
 * should be, sampled every 50 ms for `ms` while it plays. Each sample reads
 * both players in one go, so the reading itself adds almost nothing.
 *
 * Returns the median of the samples from `settledAfter` on, once the stream
 * has had time to be brought into step, and the worst of them all. A stream
 * starts a few tens of milliseconds behind its picture, at the start and at
 * every cut, and is eased into step over the next second or so.
 */
async function drift(ms: number, settledAfter: number): Promise<{ settled: number; worst: number }> {
  const startSec = await page.evaluate(async () => (await window.api.currentProject()).media[0]!.startSec ?? 0)
  const drifts = await page.evaluate(
    async ({ ms, startSec }) => {
      const out: { at: number; drift: number }[] = []
      const from = performance.now()
      const until = from + ms
      while (performance.now() < until) {
        await new Promise((r) => setTimeout(r, 50))
        const video = Array.from(document.querySelectorAll<HTMLVideoElement>('[data-testid="monitor-stage"] video')).find((v) => !v.paused)
        const players = Array.from(document.querySelectorAll<HTMLAudioElement>('[data-testid="track-player"]')).filter((a) => !a.paused)
        if (!video || players.length !== 1 || video.readyState < 3) continue
        out.push({ at: performance.now() - from, drift: players[0]!.currentTime - (video.currentTime - startSec) })
      }
      return out
    },
    { ms, startSec }
  )
  const settled = drifts
    .filter((d) => d.at >= settledAfter)
    .map((d) => Math.abs(d.drift))
    .sort((a, b) => a - b)
  if (settled.length <= 5) console.log(drifts.map((d) => `${Math.round(d.at)}:${(d.drift * 1000).toFixed(0)}`).join(' '))
  expect(settled.length).toBeGreaterThan(5)
  return { settled: settled[Math.floor(settled.length / 2)]!, worst: Math.max(...drifts.map((d) => Math.abs(d.drift))) }
}

describe('a recording with three streams, dropped on V1', () => {
  it('lands as its picture on V1 and its streams on A1 to A3, only the first heard, all linked', async () => {
    const v1 = page.locator('[data-testid="track"][data-track-id="v1"]')
    const box = (await v1.boundingBox())!
    await page.dragAndDrop('[data-testid="asset"]', '[data-testid="track"][data-track-id="v1"]', {
      targetPosition: { x: 0.1, y: box.height / 2 }
    })
    await page.waitForSelector('[data-testid="clip"][data-selected="yes"]', WAIT)
    const t = await tracks()
    expect(t.video[0]!.map((c) => [c.start, c.length])).toEqual([[0, 91]])
    expect(t.audio.map((r) => r.map((c) => [c.start, c.length, c.muted]))).toEqual([
      [[0, 91, false]],
      [[0, 91, true]],
      [[0, 91, true]]
    ])
    const link = t.video[0]![0]!.link
    expect(link).toBeDefined()
    expect(t.audio.every((r) => r[0]!.link === link)).toBe(true)
  })

  it('selects all four when any one of them is clicked', async () => {
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Escape')
    await page.mouse.click(...(Object.values(await centre(clipOn('audio', 1, 0))) as [number, number]))
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="clip"][data-selected="yes"], [data-testid="sound-clip"][data-selected="yes"]').length === 4,
      undefined,
      WAIT
    )
    await page.waitForSelector('[data-testid="sound-section"]', WAIT)
    expect(await page.locator('[data-testid="linked-sound"]').count()).toBe(3)
    expect(await page.getAttribute('[data-testid="linked-count"]', 'data-count')).toBe('4')
    // The Inspector shows the one clicked: the sound, then the picture of the same group.
    expect(await page.locator('[data-testid="sound-clip-panel"]').count()).toBe(1)
    // One Sound section, with the clicked sound's own row picked out and no second volume.
    expect(await page.locator('[data-testid="sound-section"]').count()).toBe(1)
    expect(await page.locator('[data-testid="linked-sound"][data-selected="yes"]').count()).toBe(1)
    expect(await page.locator('[data-testid="linked-sound-level"]').count()).toBe(3)
    await page.mouse.click(...(Object.values(await centre(clipOn('video', 0, 0))) as [number, number]))
    await page.waitForSelector('[data-testid="picture-clip-panel"]', WAIT)
    // The same section for the picture of the same recording.
    expect(await page.locator('[data-testid="sound-section"]').count()).toBe(1)
    expect(await page.locator('[data-testid="linked-sound"]').count()).toBe(3)
    expect(await page.locator('[data-testid="clip"][data-selected="yes"], [data-testid="sound-clip"][data-selected="yes"]').count()).toBe(4)
  })

  it('hears A2 when its Heard box is ticked, and its slider turns it up, one undo step per drag', async () => {
    await page.locator('[data-testid="linked-sound-heard"]').nth(1).click()
    await expect.poll(async () => (await tracks()).audio[1]![0]!.muted).toBe(false)

    const slider = (await page.locator('[data-testid="linked-sound-level"]').nth(1).boundingBox())!
    const y = slider.y + slider.height / 2
    await page.mouse.move(slider.x + slider.width * 0.25, y)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(slider.x + slider.width * (0.25 + i * 0.08), y)
    await page.mouse.up()
    await expect.poll(async () => (await tracks()).audio[1]![0]!.gain).toBeGreaterThan(2)
    await page.waitForSelector('[data-testid="louder-note"]', WAIT)
    await undo()
    await expect.poll(async () => (await tracks()).audio[1]![0]!.gain).toBe(1)
    expect((await tracks()).audio[1]![0]!.muted).toBe(false)

    // Only A2 heard from here on, for the players below.
    await page.locator('[data-testid="linked-sound-heard"]').nth(0).click()
    await expect.poll(async () => (await tracks()).audio[0]![0]!.muted).toBe(true)
  })

  it('takes a volume typed into the box, exactly, where the slider cannot reach it', async () => {
    const gain = async (): Promise<number> => (await tracks()).audio[1]![0]!.gain!
    const box = page.locator('[data-testid="linked-sound-level-typed"]').nth(1)
    await box.fill('250')
    await box.press('Enter')
    await expect.poll(gain, WAIT).toBe(2.5)

    // One pixel of the slider is nearly 5%, so this is a figure only the box can set.
    await box.fill('137')
    await box.press('Enter')
    await expect.poll(gain, WAIT).toBeCloseTo(1.37, 5)

    // Left rather than entered, and meant just the same.
    await box.fill('80')
    await page.locator('[data-testid="timecode"]').click()
    await expect.poll(gain, WAIT).toBeCloseTo(0.8, 5)
  })

  it('puts a volume back to 100% on a double click, in one undo step', async () => {
    const gain = async (): Promise<number> => (await tracks()).audio[1]![0]!.gain!
    const box = page.locator('[data-testid="linked-sound-level-typed"]').nth(1)
    await box.fill('300')
    await box.press('Enter')
    await expect.poll(gain, WAIT).toBe(3)

    await page.locator('[data-testid="linked-sound-level"]').nth(1).dblclick()
    await expect.poll(gain, WAIT).toBe(1)

    // The double click jumps the thumb before it resets. One undo, not two.
    await undo()
    await expect.poll(gain, WAIT).toBe(3)
    await page.locator('[data-testid="linked-sound-level"]').nth(1).dblclick()
    await expect.poll(gain, WAIT).toBe(1)
  })

  it('keeps stream 2 in step with the picture while it plays', async () => {
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    await playheadAt(0)
    await page.keyboard.press('Space')
    // Within a frame at 60 fps once settled, and so within 12 ms: taking the
    // file's start into account wrongly, or not at all, would leave it 21 ms
    // out. Never far out on the way.
    const d = await drift(2600, 1400)
    expect(d.settled).toBeLessThan(0.012)
    expect(d.worst).toBeLessThan(0.1)
    await page.keyboard.press('Space')
  })

  it('splits all four with S, and keeps stream 2 in step across the cut', async () => {
    await goTo(30)
    await page.keyboard.press('KeyS')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2, undefined, WAIT)
    const t = await tracks()
    expect(t.video[0]!.map((c) => [c.start, c.length])).toEqual([
      [0, 30],
      [30, 61]
    ])
    for (const r of t.audio) expect(r.map((c) => [c.start, c.length])).toEqual([
      [0, 30],
      [30, 61]
    ])
    // The second pieces are linked to each other, not to the first.
    const second = t.video[0]![1]!.link
    expect(second).toBeDefined()
    expect(second).not.toBe(t.video[0]![0]!.link)
    expect(t.audio.every((r) => r[1]!.link === second)).toBe(true)

    // The cut is 1 s in; the stream after it is settled well before the end.
    await page.keyboard.press('Home')
    await playheadAt(0)
    await page.keyboard.press('Space')
    const d = await drift(2800, 2100)
    expect(d.settled).toBeLessThan(0.012)
    expect(d.worst).toBeLessThan(0.1)
    await page.keyboard.press('Space')
  })

  it('leaves a gap on all four tracks with Delete, which a click on it and Delete close up', async () => {
    // Pieces at 0, 30 and 60: take out the middle one.
    await goTo(60)
    await page.keyboard.press('KeyS')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 3, undefined, WAIT)
    await page.mouse.click(...(Object.values(await centre(clipOn('video', 0, 1))) as [number, number]))
    await page.keyboard.press('Delete')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2, undefined, WAIT)
    let t = await tracks()
    expect(t.video[0]!.map((c) => c.start)).toEqual([0, 60])
    for (const r of t.audio) expect(r.map((c) => c.start)).toEqual([0, 60])

    const v1 = (await page.locator('[data-testid="track"][data-track-id="v1"]').boundingBox())!
    await page.mouse.click(v1.x + 45 * PX, v1.y + v1.height / 2)
    await page.waitForSelector('[data-testid="selected-gap"][data-from="30"][data-to="60"]', WAIT)
    await page.keyboard.press('Delete')
    await page.waitForFunction(() => document.querySelector('[data-testid="timecode"]')?.getAttribute('data-total') === '61', undefined, WAIT)
    t = await tracks()
    expect(t.video[0]!.map((c) => c.start)).toEqual([0, 30])
    for (const r of t.audio) expect(r.map((c) => c.start)).toEqual([0, 30])
  })

  it('closes up in one step with Shift+Delete', async () => {
    await undo()
    await undo()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 3, undefined, WAIT)
    await page.mouse.click(...(Object.values(await centre(clipOn('video', 0, 1))) as [number, number]))
    await page.keyboard.press('Shift+Delete')
    await page.waitForFunction(() => document.querySelector('[data-testid="timecode"]')?.getAttribute('data-total') === '61', undefined, WAIT)
    const t = await tracks()
    expect(t.video[0]!.map((c) => c.start)).toEqual([0, 30])
    for (const r of t.audio) expect(r.map((c) => c.start)).toEqual([0, 30])
    await undo()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 3, undefined, WAIT)
  })

  it('removes only the A2 piece that Alt+click took on its own', async () => {
    await page.keyboard.down('Alt')
    await page.mouse.click(...(Object.values(await centre(clipOn('audio', 1, 0))) as [number, number]))
    await page.keyboard.up('Alt')
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="clip"][data-selected="yes"], [data-testid="sound-clip"][data-selected="yes"]').length === 1,
      undefined,
      WAIT
    )
    await page.keyboard.press('Delete')
    await expect.poll(async () => (await tracks()).audio[1]!.length).toBe(2)
    const t = await tracks()
    expect(t.video[0]!.length).toBe(3)
    expect(t.audio[0]!.length).toBe(3)
    await undo()
    await expect.poll(async () => (await tracks()).audio[1]!.length).toBe(3)
  })

  it('takes its linked sound along in time when the picture is dragged up to V2, the sound staying on its tracks', async () => {
    await page.click('[data-testid="add-video-track"]')
    await page.waitForSelector('[data-testid="track"][data-kind="video"][data-index="1"]', WAIT)
    const v2 = (await page.locator('[data-testid="track"][data-kind="video"][data-index="1"]').boundingBox())!
    const from = await centre(clipOn('video', 0, 2))
    // Up onto V2, and 10 frames later.
    await dragFrom(from, { dx: 10 * PX, dy: v2.y + v2.height / 2 - from.y })
    await expect.poll(async () => (await tracks()).video[1]!.map((c) => c.start)).toEqual([70])
    const t = await tracks()
    expect(t.video[0]!.length).toBe(2)
    for (const r of t.audio) expect(r[r.length - 1]!.start).toBe(70)
    await undo()
    await expect.poll(async () => (await tracks()).video[1]!.length).toBe(0)
    expect((await tracks()).video[0]!.map((c) => c.start)).toEqual([0, 30, 60])
  })

  it('trims its linked sound with the picture, and a drag out and back leaves all four as they were', async () => {
    // Zoomed in, so a 30 frame clip is wide enough for its handles not to meet the next clip's.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Equal')
    await page.keyboard.press('Equal')
    await page.waitForSelector('[data-testid="zoom-out"][data-zoom="7"]', WAIT)
    const handle = await centre(clipOn('video', 0, 0).locator('[data-testid="trim-end"]'))
    const before = await tracks()
    // In 10 frames and back out again, in one drag.
    await dragFrom(handle, { dx: -10 * ZOOMED }, { dx: 0 })
    await page.waitForTimeout(300)
    expect(await tracks()).toEqual(before)

    await dragFrom(handle, { dx: -10 * ZOOMED })
    await expect.poll(async () => (await tracks()).video[0]![0]!.length).toBe(20)
    for (const r of (await tracks()).audio) expect(r[0]!.length).toBe(20)
    await undo()
    await expect.poll(async () => (await tracks()).video[0]![0]!.length).toBe(30)
    for (const r of (await tracks()).audio) expect(r[0]!.length).toBe(30)
    await page.keyboard.press('Minus')
    await page.keyboard.press('Minus')
    await page.waitForSelector('[data-testid="zoom-out"][data-zoom="5"]', WAIT)
  })

  it('leaves the sound where it is once unlinked, when the picture is dragged', async () => {
    await page.mouse.click(...(Object.values(await centre(clipOn('video', 0, 0))) as [number, number]))
    await page.click('[data-testid="unlink"]')
    await expect.poll(async () => (await tracks()).video[0]![0]!.link).toBeUndefined()
    // Room for it: take out the piece at 30 first.
    await page.mouse.click(...(Object.values(await centre(clipOn('video', 0, 1))) as [number, number]))
    await page.keyboard.press('Delete')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"]').length === 2, undefined, WAIT)
    await dragFrom(await centre(clipOn('video', 0, 0)), { dx: 20 * PX })
    await expect.poll(async () => (await tracks()).video[0]![0]!.start).toBe(20)
    for (const r of (await tracks()).audio) expect(r[0]!.start).toBe(0)
  })
})

describe('adding a track (task 62)', () => {
  const ids = async (): Promise<{ video: string[]; audio: string[] }> =>
    page.evaluate(async () => {
      const s = (await window.api.currentProject()).sequences[0]!
      return { video: s.videoTracks.map((r) => r.id), audio: s.audioTracks.map((r) => r.id) }
    })

  it('adds one from beside the tracks, a video one on top and an audio one at the bottom, and the toolbar has no such buttons', async () => {
    expect(await page.locator('[data-testid="track-headers"] [data-testid="add-video-track"]').count()).toBe(1)
    expect(await page.locator('[data-testid="track-headers"] [data-testid="add-audio-track"]').count()).toBe(1)
    expect(await page.locator('[data-testid="add-video-track"], [data-testid="add-audio-track"]').count()).toBe(2)
    const before = await ids()
    await page.click('[data-testid="add-video-track"]')
    await expect.poll(async () => (await ids()).video.length).toBe(before.video.length + 1)
    expect((await ids()).video.slice(0, -1)).toEqual(before.video)
    await page.click('[data-testid="add-audio-track"]')
    await expect.poll(async () => (await ids()).audio.length).toBe(before.audio.length + 1)
    expect((await ids()).audio.slice(0, -1)).toEqual(before.audio)
    await undo()
    await undo()
    await expect.poll(ids).toEqual(before)
  })

  it('adds one with Ctrl+Shift+V and Ctrl+Shift+A, and from the Ctrl+K search', async () => {
    const before = await ids()
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Control+Shift+V')
    await expect.poll(async () => (await ids()).video.length).toBe(before.video.length + 1)
    await page.keyboard.press('Control+Shift+A')
    await expect.poll(async () => (await ids()).audio.length).toBe(before.audio.length + 1)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Control+k')
    await page.waitForSelector('[data-testid="command-palette"]')
    await page.fill('[data-testid="command-search"]', 'audio track')
    await page.waitForSelector('[data-testid="command"]')
    expect(await page.locator('[data-testid="command"]').first().textContent()).toContain('Add an audio track')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await ids()).audio.length).toBe(before.audio.length + 2)
    await undo()
    await undo()
    await undo()
    await expect.poll(ids).toEqual(before)
  })
})
