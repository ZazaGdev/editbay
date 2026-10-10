import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 18 step 1, driven through the real window: one clip at a time, and
 * Delete moving on to the next clip.
 *
 * V1 holds the 4 second red clip, A (0 to 120), with its sound on A1, then the
 * 3 second green clip, B (120 to 210), which has none.
 */

const fx = fixtureSet('selection-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-selection-'))
const userData = join(root, 'user-data')
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  const [red, green] = [await fx.redClip(), await fx.greenClip()]
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  const assets = await page.evaluate((p) => window.api.importFiles(p), [red, green])
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset"][data-status="ready"]').length === 2, undefined, {
    timeout: 180_000
  })
  for (const [n, id] of [assets[0]!.id, assets[1]!.id].entries()) {
    await page.locator(`[data-testid="asset"][data-asset-id="${id}"] [data-testid="add-to-timeline"]`).click()
    await page.waitForFunction((want) => document.querySelectorAll('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').length === want, n + 1, WAIT)
  }
  await press('Home')
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

const V1 = '[data-testid="track"][data-track-id="v1"] [data-testid="clip"]'

/** V1's clips, each as its start and its length. */
async function v1(): Promise<[number, number][]> {
  return page.evaluate(async () =>
    (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips.map((c) => [c.timelineStart, c.sourceOut - c.sourceIn] as [number, number])
  )
}

function scrollLeft(): Promise<number> {
  return page.evaluate(() => document.querySelector('[data-testid="timeline-scroll"]')?.scrollLeft ?? 0)
}

async function playhead(): Promise<number> {
  return Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
}

/** Click a clip of V1 in the middle, and wait for it to be the selected one. */
async function clickClip(nth: number): Promise<string> {
  const box = (await page.locator(V1).nth(nth).boundingBox())!
  const id = (await page.locator(V1).nth(nth).getAttribute('data-clip-id'))!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForSelector(`${V1}[data-clip-id="${id}"][data-selected="yes"]`, WAIT)
  return id
}

describe('one clip at a time', () => {
  it('leaves the playhead and the view where they are when a clip away from it is clicked', async () => {
    await press('Home')
    expect(await playhead()).toBe(0)
    const scrolled = await scrollLeft()
    await clickClip(1)
    await page.waitForTimeout(200)
    expect(await playhead()).toBe(0)
    expect(await scrollLeft()).toBe(scrolled)
    // The Inspector still shows the clip selected.
    expect(await page.getAttribute('[data-testid="clip-start"]', 'data-frame')).toBe('120')
  })

  it('leaves the playhead where it is when it is already inside the clip clicked', async () => {
    // Put the playhead inside B rather than taking where the last test left it.
    await press('Home')
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect.poll(playhead, WAIT).toBe(122)
    const b = await clickClip(1)
    await page.waitForTimeout(200)
    expect(await playhead()).toBe(122)
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-clip')).toBe(b)
  })

  it('brings the playhead into the selected clip once framing it begins, so the crop edited is that clip’s', async () => {
    await press('Home')
    await clickClip(1)
    await page.waitForTimeout(200)
    expect(await playhead()).toBe(0)
    await page.click('[data-testid="crop-x"]')
    await expect.poll(playhead, WAIT).toBe(120)
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-clip')).toBe(await page.getAttribute(`${V1}[data-selected="yes"]`, 'data-clip-id'))
  })

  it('brings the playhead into the selected clip on a press on the monitor, and the press edits nothing', async () => {
    await press('Home')
    const b = await clickClip(1)
    const before = await page.evaluate(async () => JSON.stringify((await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips))
    const stage = (await page.locator('[data-testid="monitor-stage"]').boundingBox())!
    await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2)
    await expect.poll(playhead, WAIT).toBe(120)
    expect(await page.getAttribute('[data-testid="monitor-stage"]', 'data-clip')).toBe(b)
    await page.waitForTimeout(200)
    expect(await page.evaluate(async () => JSON.stringify((await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips))).toBe(before)
  })

  it('leaves the playhead where it is when a clip before it is clicked', async () => {
    await press('End')
    const end = await playhead()
    expect(end).toBeGreaterThan(120)
    await clickClip(0)
    await page.waitForTimeout(200)
    expect(await playhead()).toBe(end)
  })
})

describe('Delete moving on', () => {
  it('clears a row of splits with Delete pressed again and again', async () => {
    // A cut at 30, 60 and 90 makes four pieces of A, so V1 holds five clips.
    for (const frame of [30, 60, 90]) {
      await press('Home')
      // A second a press, at 30 fps.
      for (let i = 0; i < frame / 30; i++) await page.keyboard.press('Shift+ArrowRight')
      await expect.poll(playhead, WAIT).toBe(frame)
      await page.keyboard.press('KeyS')
      await expect.poll(async () => (await v1()).length, WAIT).toBe(frame / 30 + 2)
    }
    await press('Home')
    await clickClip(0)
    for (const [n, start] of [30, 60, 90].entries()) {
      await press('Delete')
      await expect.poll(async () => (await v1()).length, WAIT).toBe(4 - n)
      // What is left selected is the next clip along, so the next Delete takes
      // it, and the playhead stays where it was.
      await expect.poll(() => page.getAttribute(`${V1}[data-selected="yes"]`, 'data-start'), WAIT).toBe(String(start))
      expect(await playhead()).toBe(0)
    }
    expect(await v1()).toEqual([
      [90, 30],
      [120, 90]
    ])
    for (let i = 0; i < 3; i++) await press('Control+z')
    await expect.poll(async () => (await v1()).length, WAIT).toBe(5)
  })

  it('takes one clip when Delete is held down, not a row of them', async () => {
    await press('Home')
    await clickClip(0)
    const before = (await v1()).length
    await press('Delete')
    await expect.poll(async () => (await v1()).length, WAIT).toBe(before - 1)
    // Windows repeats a held key about thirty times a second. Each repeat now
    // finds the clip Delete stepped on to; none of them may take it.
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Delete', key: 'Delete', repeat: true, bubbles: true })))
    }
    await page.waitForTimeout(300)
    expect((await v1()).length).toBe(before - 1)
    await press('Control+z')
    await expect.poll(async () => (await v1()).length, WAIT).toBe(before)
  })

  it('takes the clip before it when nothing follows on the track', async () => {
    await press('Home')
    const last = await clickClip(4)
    await press('Delete')
    await expect.poll(async () => (await v1()).length, WAIT).toBe(4)
    // The document changes before the window draws it, so wait for what is drawn.
    await expect.poll(() => page.getAttribute(`${V1}[data-selected="yes"]`, 'data-start'), WAIT).toBe('90')
    expect(await page.getAttribute(`${V1}[data-selected="yes"]`, 'data-clip-id')).not.toBe(last)
    await press('Control+z')
    await expect.poll(async () => (await v1()).length, WAIT).toBe(5)
  })
})

describe('several clips at once', () => {
  /** Shift+click a clip of V1, which adds it to the selection or takes it out. */
  async function shiftClick(nth: number): Promise<void> {
    const box = (await page.locator(V1).nth(nth).boundingBox())!
    await page.keyboard.down('Shift')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.up('Shift')
  }

  const selectedOnV1 = (): Promise<number> => page.locator(`${V1}[data-selected="yes"]`).count()

  /** Where each V1 clip's crop starts, to see which clips a paste reached. */
  const cropXs = (): Promise<number[]> =>
    page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips.map((c) => c.transform.crop.x))

  it('starts from the five clips the tests above left behind', async () => {
    expect(await v1()).toEqual([
      [0, 30],
      [30, 30],
      [60, 30],
      [90, 30],
      [120, 90]
    ])
  })

  it('leads with the clip added with Shift, leaving the playhead where it is', async () => {
    await press('Home')
    await clickClip(0)
    expect(await playhead()).toBe(0)
    const box = (await page.locator(V1).nth(3).boundingBox())!
    const id = (await page.locator(V1).nth(3).getAttribute('data-clip-id'))!
    await page.keyboard.down('Shift')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.up('Shift')
    await expect.poll(() => page.getAttribute('[data-testid="clip-start"]', 'data-frame'), WAIT).toBe('90')
    expect(await page.getAttribute(`${V1}[data-clip-id="${id}"]`, 'data-selected')).toBe('yes')
    expect(await playhead()).toBe(0)
  })

  it('adds clips with Shift and takes them all away in one undo step', async () => {
    await press('Home')
    await clickClip(1)
    await shiftClick(2)
    await shiftClick(3)
    await expect.poll(selectedOnV1, WAIT).toBe(3)
    await press('Delete')
    await expect.poll(async () => (await v1()).length, WAIT).toBe(2)
    expect(await v1()).toEqual([
      [0, 30],
      [120, 90]
    ])
    await press('Control+z')
    await expect.poll(async () => (await v1()).length, WAIT).toBe(5)
  })

  it('takes a clip out of the selection when it is Shift+clicked again', async () => {
    await press('Home')
    await clickClip(1)
    await shiftClick(2)
    await expect.poll(selectedOnV1, WAIT).toBe(2)
    await shiftClick(2)
    await expect.poll(selectedOnV1, WAIT).toBe(1)
    expect(await page.getAttribute(`${V1}[data-selected="yes"]`, 'data-start')).toBe('30')
  })

  it('picks the clips a box drawn over the timeline touches', async () => {
    await press('Escape')
    const third = (await page.locator(V1).nth(3).boundingBox())!
    const last = (await page.locator(V1).nth(4).boundingBox())!
    const y = third.y + third.height / 2
    // From empty space past the last clip, back over the last two.
    await page.mouse.move(last.x + last.width + 60, y)
    await page.mouse.down()
    await page.mouse.move(last.x + last.width / 2, y, { steps: 5 })
    await page.mouse.move(third.x + 3, y, { steps: 5 })
    await page.waitForSelector('[data-testid="select-box"]', WAIT)
    await page.mouse.up()
    await expect.poll(selectedOnV1, WAIT).toBe(2)
    expect(await page.getAttribute(`${V1}[data-selected="yes"]`, 'data-start')).toBe('90')
  })

  it('pastes the framing onto every clip selected, not only one of them', async () => {
    await press('Home')
    await clickClip(0)
    if ((await page.getAttribute('[data-testid="monitor-side"][data-side="source"]', 'data-focused')) !== 'yes') await press('KeyV')
    const first = (await cropXs())[0]!
    await press('Alt+ArrowLeft')
    await press('Alt+ArrowLeft')
    await expect.poll(async () => (await cropXs())[0], WAIT).not.toBe(first)
    const framed = (await cropXs())[0]!
    await press('Control+Alt+KeyC')

    await clickClip(1)
    await shiftClick(2)
    await expect.poll(selectedOnV1, WAIT).toBe(2)
    await press('Control+Alt+KeyV')
    await expect.poll(async () => (await cropXs()).slice(1, 3), WAIT).toEqual([framed, framed])
    await press('Control+z')
    await expect.poll(async () => (await cropXs()).slice(1, 3), WAIT).toEqual([first, first])
    await press('Control+z')
  })

  it('paints the framing onto the next clip pressed, or onto every one until Esc', async () => {
    await press('Home')
    const from = await clickClip(0)
    if ((await page.getAttribute('[data-testid="monitor-side"][data-side="source"]', 'data-focused')) !== 'yes') await press('KeyV')
    const first = (await cropXs())[1]!
    await press('Alt+ArrowLeft')
    await press('Alt+ArrowLeft')
    await expect.poll(async () => (await cropXs())[0], WAIT).not.toBe(first)
    const framed = (await cropXs())[0]!
    const pressClip = async (nth: number): Promise<void> => {
      const box = (await page.locator(V1).nth(nth).boundingBox())!
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }

    // One click arms it for one clip, and says so above the timeline.
    await page.locator('[data-testid="paint-framing"]').click()
    await page.waitForSelector('[data-testid="painter-banner"][data-painting="once"]', WAIT)
    await pressClip(1)
    await expect.poll(async () => (await cropXs())[1], WAIT).toBe(framed)
    await expect.poll(() => page.locator('[data-testid="painter-banner"]').count(), WAIT).toBe(0)
    // Painting is not picking: the clip it was taken from is still the one selected.
    expect(await page.getAttribute(`${V1}[data-clip-id="${from}"]`, 'data-selected')).toBe('yes')

    // A double click keeps it on, clip after clip, until Esc.
    await page.locator('[data-testid="paint-framing"]').dblclick()
    await page.waitForSelector('[data-testid="painter-banner"][data-painting="sticky"]', WAIT)
    await pressClip(2)
    await pressClip(3)
    await expect.poll(async () => (await cropXs()).slice(2, 4), WAIT).toEqual([framed, framed])
    expect(await page.locator('[data-testid="painter-banner"]').count()).toBe(1)
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('[data-testid="painter-banner"]').count(), WAIT).toBe(0)
    expect(await page.getAttribute(`${V1}[data-clip-id="${from}"]`, 'data-selected')).toBe('yes')

    // Each clip painted is its own undo step.
    await press('Control+z')
    await expect.poll(async () => (await cropXs())[3], WAIT).toBe(first)
    await press('Control+z')
    await press('Control+z')
    await expect.poll(async () => (await cropXs()).slice(1, 3), WAIT).toEqual([first, first])
    await press('Control+z')
  })

  it('closes up for clips that follow one another, and says why when they do not', async () => {
    await press('Home')
    await clickClip(1)
    await shiftClick(2)
    await press('Shift+Delete')
    await expect.poll(v1, WAIT).toEqual([
      [0, 30],
      [30, 30],
      [60, 90]
    ])
    await press('Control+z')
    await expect.poll(async () => (await v1()).length, WAIT).toBe(5)

    const before = await v1()
    await clickClip(0)
    await shiftClick(2)
    await press('Shift+Delete')
    await expect.poll(() => page.locator('[data-testid="toast"]').filter({ hasText: 'follow one another' }).count(), WAIT).toBe(1)
    expect(await v1()).toEqual(before)
  })

  it('selects every clip on every track with Ctrl+A, pictures and sounds', async () => {
    await clickClip(1)
    const ANY = '[data-testid="track"] :is([data-testid="clip"], [data-testid="sound-clip"])'
    const all = await page.locator(ANY).count()
    expect(await page.locator('[data-testid="track"] [data-testid="sound-clip"]').count()).toBeGreaterThan(0)
    expect(await page.locator(`${ANY}[data-selected="yes"]`).count()).toBeLessThan(all)
    await press('Control+a')
    await expect.poll(() => page.locator(`${ANY}[data-selected="yes"]`).count(), WAIT).toBe(all)
    await press('Escape')
    await expect.poll(() => page.locator(`${ANY}[data-selected="yes"]`).count(), WAIT).toBe(0)
  })
})
