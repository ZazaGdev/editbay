import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Drags that close up and open up, driven through the real window: Ctrl on a
 * clip takes it out and puts it in, Ctrl on an edge trims and moves what comes
 * after, a lane past the last track makes a new one, and a source from the
 * bin snaps where it is let go.
 *
 * V1 holds a 4 second clip with sound (0 to 120), a 3 second one without
 * (120 to 210) and the 4 second one again (210 to 330).
 */

const fx = fixtureSet('close-up-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-close-up-'))
const userData = join(root, 'user-data')
/** Pixels per frame at the zoom a new project starts at. */
const PX = 0.4
let app: ElectronApplication
let page: Page
const ids = { clean: '', silent: '' }

beforeAll(async () => {
  const [clean, silent] = [await fx.cleanClip(), await fx.silentClip()]
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  const assets = await page.evaluate((p) => window.api.importFiles(p), [clean, silent])
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length === 2, undefined, {
    timeout: 180_000
  })
  ids.clean = assets[0]!.id
  ids.silent = assets[1]!.id
  for (const id of [ids.clean, ids.silent, ids.clean]) {
    const before = await page.locator('[data-testid="clip"]').count()
    await page.locator(`[data-testid="asset"][data-asset-id="${id}"] [data-testid="add-to-timeline"]`).click()
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="clip"]').length === n, before + 1, WAIT)
  }
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** V1's clips, each as its source and its start. */
async function v1(): Promise<{ media: string; start: number; length: number }[]> {
  return page.evaluate(async () =>
    (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips.map((c) => ({
      media: c.mediaId,
      start: c.timelineStart,
      length: c.sourceOut - c.sourceIn
    }))
  )
}

/** Every audio track's clips, each as its start and its length. */
async function sound(): Promise<number[][][]> {
  return page.evaluate(async () =>
    (await window.api.currentProject()).sequences[0]!.audioTracks.map((r) => r.clips.map((c) => [c.timelineStart, c.sourceOut - c.sourceIn]))
  )
}

async function undo(): Promise<void> {
  await page.locator('[data-testid="timecode"]').click()
  await page.keyboard.press('Control+z')
}

async function centre(locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function v1Clip(index: number): ReturnType<Page['locator']> {
  return page.locator('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').nth(index)
}

/** A drag with Ctrl held once it has begun, through the points given, in steps. */
async function ctrlDrag(from: { x: number; y: number }, ...to: { x: number; y: number }[]): Promise<void> {
  await drag(true, from, ...to)
}

/** A drag, with Ctrl held from the press on when `ctrl`. */
async function drag(ctrl: boolean, from: { x: number; y: number }, ...to: { x: number; y: number }[]): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  if (ctrl) await page.keyboard.down('Control')
  let at = from
  for (const next of to) {
    for (let i = 1; i <= 4; i++) await page.mouse.move(at.x + ((next.x - at.x) * i) / 4, at.y + ((next.y - at.y) * i) / 4)
    at = next
  }
  await page.mouse.up()
  if (ctrl) await page.keyboard.up('Control')
}

describe('drags that close up and open up', () => {
  it('puts V1\'s last clip first with Ctrl, leaving no gap, its sound with it', async () => {
    const before = await v1()
    const from = await centre(v1Clip(2))
    const track = (await page.locator('[data-testid="track"][data-track-id="v1"]').boundingBox())!
    // Let go with its start near the very beginning: it snaps onto 0.
    await ctrlDrag(from, { x: from.x - 205 * PX, y: from.y })
    await expect.poll(async () => (await v1()).map((c) => c.start)).toEqual([0, 120, 240])
    const after = await v1()
    expect(after.map((c) => c.media)).toEqual([before[2]!.media, before[0]!.media, before[1]!.media])
    // The two clips with sound kept theirs under them.
    expect((await sound())[0]).toEqual([
      [0, 120],
      [120, 120]
    ])
    expect(track.width).toBeGreaterThan(0)
    await undo()
    await expect.poll(async () => (await v1()).map((c) => c.media)).toEqual(before.map((c) => c.media))
  })

  it('snaps only the start of a clip put in with Ctrl, not its end, which lands wherever the start says', async () => {
    const before = await v1()
    // The playhead at 315, where the first clip's end comes when its start is at 195.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowRight')
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight')
    await expect.poll(async () => Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))).toBe(315)
    // Its start let go at 195, 15 frames short of the cut at 210: it goes in at that cut, after the second clip.
    const from = await centre(v1Clip(0))
    await ctrlDrag(from, { x: from.x + 195 * PX, y: from.y })
    await expect.poll(async () => (await v1()).map((c) => c.start)).toEqual([0, 90, 210])
    expect((await v1()).map((c) => c.media)).toEqual([before[1]!.media, before[0]!.media, before[2]!.media])
    await undo()
    await expect.poll(async () => (await v1()).map((c) => c.media)).toEqual(before.map((c) => c.media))
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
  })

  it('pulls the next clip and its sound in when an edge is dragged, and back out again in the same drag (plan 82: no key)', async () => {
    const handle = await centre(v1Clip(0).locator('[data-testid="trim-end"]'))
    // In 40 frames and back where it began: nothing changes.
    await drag(false, handle, { x: handle.x - 40 * PX, y: handle.y }, { x: handle.x, y: handle.y })
    await page.waitForTimeout(300)
    expect((await v1()).map((c) => [c.start, c.length])).toEqual([
      [0, 120],
      [120, 90],
      [210, 120]
    ])

    await drag(false, handle, { x: handle.x - 40 * PX, y: handle.y })
    await expect.poll(async () => (await v1()).map((c) => [c.start, c.length])).toEqual([
      [0, 80],
      [80, 90],
      [170, 120]
    ])
    expect((await sound())[0]).toEqual([
      [0, 80],
      [170, 120]
    ])
    await undo()
    await expect.poll(async () => (await v1()).map((c) => c.start)).toEqual([0, 120, 210])
  })

  it('takes a clip dropped on the lane below the last audio track onto a new track there', async () => {
    const from = await centre(page.locator('[data-testid="track"][data-kind="audio"][data-index="0"] [data-testid="sound-clip"]').first())
    await page.keyboard.down('Alt')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.keyboard.up('Alt')
    // Past the drag threshold, so the lanes for new tracks show.
    await page.mouse.move(from.x, from.y + 10)
    await page.waitForSelector('[data-testid="new-track-lane"][data-kind="audio"][data-active="yes"]', WAIT)
    const lane = await centre(page.locator('[data-testid="new-track-lane"][data-kind="audio"]'))
    for (let i = 1; i <= 4; i++) await page.mouse.move(from.x, from.y + 10 + ((lane.y - from.y - 10) * i) / 4)
    await page.mouse.up()
    await expect.poll(async () => (await sound()).length).toBe(2)
    // It went on its own, taken with Alt: the new track has it, A1 the rest.
    expect((await sound())[1]).toEqual([[0, 120]])
    expect((await sound())[0]).toEqual([[210, 120]])
    await undo()
    await expect.poll(async () => (await sound()).length).toBe(1)
  })

  it('snaps a source dropped from the bin onto a cut, and not with Alt held', async () => {
    await page.click('[data-testid="add-video-track"]')
    await page.waitForSelector('[data-testid="track"][data-kind="video"][data-index="1"]', WAIT)
    const track = '[data-testid="track"][data-kind="video"][data-index="1"]'
    const box = (await page.locator(track).boundingBox())!
    const on = (): Promise<number[]> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[1]!.clips.map((c) => c.timelineStart))
    // Let go 5 frames before V1's cut at 120: its start snaps onto the cut.
    await page.dragAndDrop(`[data-testid="asset"][data-asset-id="${ids.silent}"]`, track, {
      targetPosition: { x: 115 * PX + 0.1, y: box.height / 2 }
    })
    await expect.poll(on).toEqual([120])
    await undo()
    await expect.poll(on).toEqual([])

    await page.keyboard.down('Alt')
    await page.dragAndDrop(`[data-testid="asset"][data-asset-id="${ids.silent}"]`, track, {
      targetPosition: { x: 115 * PX + 0.1, y: box.height / 2 }
    })
    await page.keyboard.up('Alt')
    await expect.poll(on).toEqual([115])
  })

  it('drops a source with Ctrl on V2 as a plain drop, leaving V1 as it was', async () => {
    const track = '[data-testid="track"][data-kind="video"][data-index="1"]'
    const box = (await page.locator(track).boundingBox())!
    const before = await v1()
    const on = (): Promise<number[]> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[1]!.clips.map((c) => c.timelineStart))
    const count = (await on()).length
    // Let go at 270, well away from anything to snap to.
    await page.keyboard.down('Control')
    await page.dragAndDrop(`[data-testid="asset"][data-asset-id="${ids.silent}"]`, track, {
      targetPosition: { x: 270 * PX + 0.1, y: box.height / 2 }
    })
    await page.keyboard.up('Control')
    await expect.poll(async () => (await on()).length).toBe(count + 1)
    expect(await on()).toContain(270)
    expect(await v1()).toEqual(before)
  })
})
