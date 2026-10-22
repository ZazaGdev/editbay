import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Task 1096: resizing the crop box in the Source view wobbled, the edge being
 * dragged not keeping with the pointer. Each handle dragged out and back in
 * small steps, with Lock to shape on and off, at a zoomed Source view: the
 * edge stays within a pixel of the pointer and never steps back.
 */

const fx = fixtureSet('crop-drag-ui')
const WAIT = { timeout: 15_000 }
const root = await mkdtemp(join(tmpdir(), 'editbay-crop-drag-'))
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  const obs = await fx.obsClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  const [asset] = await page.evaluate((p) => window.api.importFiles(p), [obs])
  await page.waitForSelector(`[data-testid="asset"][data-asset-id="${asset!.id}"][data-status="ready"]`, { timeout: 180_000 })
  await page.locator(`[data-testid="asset"][data-asset-id="${asset!.id}"] [data-testid="add-to-timeline"]`).click()
  await page.waitForSelector('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]', WAIT)
  await page.locator('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').first().click()
  await page.waitForSelector('[data-testid="crop-rect"]', WAIT)
  // The Source view zoomed in about the middle of the crop.
  const c = (await page.locator('[data-testid="crop-rect"]').boundingBox())!
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
  await page.mouse.wheel(0, -300)
  await page.waitForSelector('[data-testid="source-zoom"]', WAIT)
  await page.waitForTimeout(300)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

type Box = { x: number; y: number; width: number; height: number }
const rect = async (): Promise<Box> => (await page.locator('[data-testid="crop-rect"]').boundingBox())!
const cropAttr = (): Promise<string | null> => page.getAttribute('[data-testid="crop-rect"]', 'data-crop')

/** The edges of the box a handle moves: left or right, top or bottom. */
function edges(handle: string, b: Box): { x?: number; y?: number } {
  const out: { x?: number; y?: number } = {}
  if (handle.includes('w')) out.x = b.x
  if (handle.includes('e')) out.x = b.x + b.width
  if (handle.includes('n')) out.y = b.y
  if (handle.includes('s')) out.y = b.y + b.height
  return out
}

/**
 * Drag a handle `steps` pixels out and as many back, a pixel at a time along
 * `dir`, and give where its edges were against the pointer after each step.
 */
async function drag(handle: string, dir: { x: number; y: number }, steps: number): Promise<{ at: number; off: { x?: number; y?: number } }[]> {
  const h = (await page.locator(`[data-testid="crop-rect"] [data-testid="crop-${handle}"]`).boundingBox())!
  const start = edges(handle, await rect())
  const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const seen: { at: number; off: { x?: number; y?: number } }[] = []
  const path = [...Array.from({ length: steps }, (_, i) => i + 1), ...Array.from({ length: steps }, (_, i) => steps - i - 1)]
  try {
    for (const at of path) {
      const before = await cropAttr()
      await page.mouse.move(from.x + dir.x * at, from.y + dir.y * at)
      // Its answer back from the document, or a frame if this step changed nothing.
      await page.waitForFunction((was) => document.querySelector('[data-testid="crop-rect"]')?.getAttribute('data-crop') !== was, before, { timeout: 300 }).catch(() => undefined)
      await page.waitForTimeout(16)
      const e = edges(handle, await rect())
      seen.push({
        at,
        off: {
          ...(e.x !== undefined && start.x !== undefined ? { x: e.x - start.x - dir.x * at } : {}),
          ...(e.y !== undefined && start.y !== undefined ? { y: e.y - start.y - dir.y * at } : {})
        }
      })
    }
  } finally {
    await page.mouse.up()
    await page.waitForTimeout(200)
  }
  return seen
}

/** A key pressed with nothing in particular focused, so it reaches the editor. */
async function press(key: string, times = 1): Promise<void> {
  await page.locator('[data-testid="timecode"]').click()
  for (let i = 0; i < times; i++) await page.keyboard.press(key)
}

/**
 * Every handle dragged out and back with Lock to shape off, and each corner
 * with it on, along the box's own diagonal so both its edges can follow. Each
 * drag is undone after.
 */
async function dragEveryHandle(): Promise<void> {
  const fails: string[] = []
  const judge = (name: string, seen: Awaited<ReturnType<typeof drag>>): void => {
    for (const s of seen) {
      for (const axis of ['x', 'y'] as const) {
        const off = s.off[axis]
        if (off !== undefined && Math.abs(off) > 1) fails.push(`${name} ${axis} ${off.toFixed(2)} px off at step ${s.at}`)
      }
    }
  }
  await page.locator('[data-testid="aspect-lock"]').uncheck()
  for (const [handle, dir] of [
    ['e', { x: -1, y: 0 }], ['w', { x: 1, y: 0 }], ['n', { x: 0, y: 1 }], ['s', { x: 0, y: -1 }],
    ['se', { x: -1, y: -1 }], ['nw', { x: 1, y: 1 }], ['ne', { x: -1, y: 1 }], ['sw', { x: 1, y: -1 }]
  ] as const) {
    judge(handle, await drag(handle, dir, 20))
    await press('ControlOrMeta+z')
  }
  await page.locator('[data-testid="aspect-lock"]').check()
  const b = await rect()
  const shape = b.width / b.height
  for (const [handle, sx, sy] of [['se', -1, -1], ['nw', 1, 1], ['ne', -1, 1], ['sw', 1, -1]] as const) {
    judge(`locked ${handle}`, await drag(handle, { x: sx * shape, y: sy }, 20))
    await press('ControlOrMeta+z')
  }
  expect(fails, fails.slice(0, 12).join('; ')).toEqual([])
}

describe('resizing the crop box in a zoomed Source view', () => {
  it('keeps the dragged edge within a pixel of the pointer, every handle, with Lock to shape off and on', async () => {
    await dragEveryHandle()
  }, 240_000)

  it('does the same on a clip whose zoom has keyframes, the playhead between them', async () => {
    // Keyframes at the clip's start and two thirds in, and the playhead between them.
    const clip = (await page.locator('[data-testid="track"][data-track-id="v1"] [data-testid="clip"]').first().boundingBox())!
    const playhead = async (): Promise<number> => Number(await page.getAttribute('[data-testid="timecode"]', 'data-playhead'))
    const at = async (share: number): Promise<void> => {
      const was = await playhead()
      // The ruler measured now, in the middle of its height, rather than guessed from the top of the timeline.
      const ruler = (await page.locator('[data-testid="ruler"]').boundingBox())!
      const x = clip.x + clip.width * share
      const y = ruler.y + ruler.height / 2
      console.log('DBG ruler', JSON.stringify({ ruler, x, y, was, under: await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.outerHTML.slice(0, 160), [x, y]) }))
      await page.mouse.click(x, y)
      await expect.poll(playhead, WAIT).not.toBe(was)
      await page.waitForTimeout(200)
    }
    const keys = (): Promise<number> =>
      page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[0]!.transform.keys?.length ?? 0)
    // The crop inside the recording's left half first: a zoom with keyframes keeps
    // its crops inside one half of a side by side recording, and this one
    // began across the middle.
    await page.locator('[data-testid="crop-x"]').fill('1200')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await cropAttr())?.split(',')[0], WAIT).toBe('1200')
    await press('Home')
    await press('Alt+KeyK')
    await expect.poll(keys, WAIT).toBe(1)
    await at(0.66)
    await press('Alt+KeyK')
    await expect.poll(keys, WAIT).toBe(2)
    await at(0.33)
    await page.waitForTimeout(300)
    await dragEveryHandle()
  }, 240_000)
})
