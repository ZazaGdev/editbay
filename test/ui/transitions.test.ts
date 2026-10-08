import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 29, the first step: putting a transition on a cut, shaping it by hand,
 * and taking it off again, driven through the real app.
 */

const fx = fixtureSet('ui-transitions')
const root = await mkdtemp(join(tmpdir(), 'editbay-transitions-ui-'))
let app: ElectronApplication
let page: Page
const WAIT = { timeout: 10_000 }

const TRANSITION = '[data-testid="clip-transition"]'

beforeAll(async () => {
  const clip = await fx.cleanClip()
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
  await page.evaluate((p) => window.api.importFiles([p]), clip)
  await page.waitForSelector('[data-testid="asset"][data-status="ready"]', { timeout: 120_000 })
  // Two clips of the same recording, so V1 has a cut in the middle.
  for (let n = 0; n < 2; n++) await page.locator('[data-testid="add-to-timeline"]').first().click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === 2)
}, 240_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true }).catch(() => {})
  await fx.cleanup()
})

/** The stored transitions of the sequence, by the clip they are on. */
async function stored(): Promise<Record<string, { kind: string; length: number; before: number }>> {
  return page.evaluate(async () => {
    const s = (await window.api.currentProject()).sequences[0]!
    const all = [...s.videoTracks.flatMap((r) => r.clips), ...s.audioTracks.flatMap((r) => r.clips)]
    const out: Record<string, { kind: string; length: number; before: number }> = {}
    for (const c of all) {
      if (c.transitionIn) out[`${c.id}:in`] = c.transitionIn
      if (c.transitionOut) out[`${c.id}:out`] = c.transitionOut
    }
    return out
  })
}

/** Where the second clip on V1 starts, which is the cut the transition goes on. */
async function cutFrame(): Promise<number> {
  return page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.videoTracks[0]!.clips[1]!.timelineStart)
}

/** Put the pointer over the cut on V1 so the seam button appears, and click it. */
async function addAtTheCut(): Promise<void> {
  const row = (await page.locator('[data-testid="track"][data-track-id="v1"]').boundingBox())!
  const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').nth(1).boundingBox())!
  await page.mouse.move(clip.x, row.y + row.height / 2)
  await page.waitForSelector('[data-testid="seam-add"]', WAIT)
  await page.locator('[data-testid="seam-add"]').click()
  await page.waitForSelector(TRANSITION, WAIT)
}

/** Drag from one point to another on the timeline, in steps, as a hand would. */
async function dragBy(from: { x: number; y: number }, byX: number): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + byX / 2, from.y, { steps: 4 })
  await page.mouse.move(from.x + byX, from.y, { steps: 4 })
  await page.mouse.up()
}

describe('putting a transition on a cut', () => {
  it('puts its button on the cut itself, big enough to hit', async () => {
    const row = (await page.locator('[data-testid="track"][data-track-id="v1"]').boundingBox())!
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').nth(1).boundingBox())!
    await page.mouse.move(clip.x + 4, row.y + row.height / 2)
    const button = (await page.locator('[data-testid="seam-add"]').boundingBox())!
    // Centred on the seam, within a pixel of rounding.
    expect(Math.abs(button.x + button.width / 2 - clip.x)).toBeLessThanOrEqual(1)
    expect(button.width).toBeGreaterThanOrEqual(16)
    // Bigger than it was, which was fourteen and off to one side.
    // Clear of the middle of the row, where a trim is grabbed.
    expect(button.y + button.height).toBeLessThan(row.y + row.height / 2)
  })

  // Bugs and notes 2, note 22.
  it('offers one at the very start of the sequence, whole and just inside the clip, which makes a fade in', async () => {
    const row = (await page.locator('[data-testid="track"][data-track-id="v1"]').boundingBox())!
    const first = page.locator('[data-testid="clip"][data-kind="video"]').first()
    const clip = (await first.boundingBox())!
    const id = await first.getAttribute('data-clip-id')
    await page.mouse.move(clip.x + 6, row.y + row.height / 2)
    await page.waitForSelector('[data-testid="seam-add"][data-at="0"][data-inside="right"]', WAIT)
    const button = (await page.locator('[data-testid="seam-add"]').boundingBox())!
    // All of it on the clip, none behind the track names.
    expect(button.x).toBeGreaterThanOrEqual(clip.x)
    await page.locator('[data-testid="seam-add"]').click()
    await expect.poll(async () => Object.keys(await stored()), WAIT).toContain(`${id}:in`)
    await page.keyboard.press('Control+z')
    await expect.poll(async () => Object.keys(await stored()).length, WAIT).toBe(0)
  })

  it('drops one on the seam the pointer is near, on the picture and its sound at once', async () => {
    await addAtTheCut()
    const on = await stored()
    const sides = Object.keys(on)
    expect(sides.length).toBe(2)
    expect(sides.every((k) => k.endsWith(':in'))).toBe(true)
    const [picture] = Object.values(on)
    expect(picture?.kind).toBe('dissolve')
    // One second at the fixture's rate, centred on the cut.
    expect(picture?.before).toBe(Math.round(picture!.length / 2))
  })

  it('draws it straddling the cut, over both clips', async () => {
    const cut = await cutFrame()
    const el = page.locator(TRANSITION).first()
    const from = Number(await el.getAttribute('data-from'))
    const to = Number(await el.getAttribute('data-to'))
    expect(from).toBeLessThan(cut)
    expect(to).toBeGreaterThan(cut)
  })

  it('gets longer when its end is dragged, and the cut stays where it was', async () => {
    const cut = await cutFrame()
    const before = (await stored())[Object.keys(await stored())[0]!]!
    const box = (await page.locator(TRANSITION).first().boundingBox())!
    await dragBy({ x: box.x + box.width - 2, y: box.y + box.height / 2 }, 40)
    await expect
      .poll(async () => {
        const now = Object.values(await stored())[0]
        return now ? now.length > before.length : false
      }, WAIT)
      .toBe(true)
    expect(await cutFrame()).toBe(cut)
  })

  it('slides across the cut when its body is dragged, without moving the cut', async () => {
    const cut = await cutFrame()
    const was = Object.values(await stored())[0]!
    const box = (await page.locator(TRANSITION).first().boundingBox())!
    await dragBy({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, -30)
    await expect
      .poll(async () => Object.values(await stored())[0]?.before ?? -1, WAIT)
      .toBeGreaterThan(was.before)
    expect(Object.values(await stored())[0]?.length).toBe(was.length)
    expect(await cutFrame()).toBe(cut)
  })

  it('takes one drag back in one undo', async () => {
    const was = Object.values(await stored())[0]!
    const box = (await page.locator(TRANSITION).first().boundingBox())!
    await dragBy({ x: box.x + 2, y: box.y + box.height / 2 }, -40)
    await expect.poll(async () => Object.values(await stored())[0]?.length ?? 0, WAIT).toBeGreaterThan(was.length)
    await page.keyboard.press('Control+z')
    await expect.poll(async () => Object.values(await stored())[0]?.length ?? 0, WAIT).toBe(was.length)
  })

  it('changes its kind from its own menu, without being taken off first', async () => {
    await page.locator(TRANSITION).first().click({ button: 'right' })
    await page.waitForSelector('[data-testid="transition-menu"]', WAIT)
    await page.locator('[data-testid="transition-kind-toBlack"]').click()
    await expect.poll(async () => Object.values(await stored())[0]?.kind, WAIT).toBe('toBlack')
    // The sound keeps its own curve: a dip to black means nothing to a sound.
    const on = await stored()
    expect(Object.values(on).some((t) => t.kind === 'even')).toBe(true)
  })

  it('opens its menu on the kind it is set to, rather than outlining the first one', async () => {
    await page.locator(TRANSITION).first().click({ button: 'right' })
    await page.waitForSelector('[data-testid="transition-menu"]', WAIT)
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)
    expect(focused).toBe('transition-kind-toBlack')
    // The one ticked and the one outlined are the same line.
    const ticked = await page.locator('[data-testid="transition-menu"] [data-current="yes"]').getAttribute('data-testid')
    expect(ticked).toBe('transition-kind-toBlack')
    await page.keyboard.press('Escape')
  })

  it('offers a direction beside its family, each playing small, and the seam button adds the kind last chosen', async () => {
    await page.locator(TRANSITION).first().click({ button: 'right' })
    await page.waitForSelector('[data-testid="transition-menu"]', WAIT)
    // Each kind shows itself moving, drawn by the monitor's own code.
    expect(await page.locator('[data-testid="transition-menu"] [data-testid="transition-thumb-dissolve"]').count()).toBe(1)
    // The four pushes are one line, with their directions beside it.
    expect(await page.locator('[data-testid="transition-kind-pushUp"]').count()).toBe(0)
    await page.locator('[data-testid="transition-family-push"]').hover()
    await page.waitForSelector('[data-testid="transition-family-push-items"]', WAIT)
    expect(await page.locator('[data-testid="transition-family-push-items"] button').allTextContents()).toEqual(['Left', 'Right', 'Up', 'Down'])
    await page.locator('[data-testid="transition-kind-pushUp"]').click()
    await expect.poll(async () => Object.values(await stored()).find((t) => t.kind !== 'even')?.kind, WAIT).toBe('pushUp')
    // Opened again, the family it is in is the one ticked.
    await page.locator(TRANSITION).first().click({ button: 'right' })
    await page.waitForSelector('[data-testid="transition-menu"]', WAIT)
    expect(await page.getAttribute('[data-testid="transition-family-push"]', 'data-current')).toBe('yes')
    await page.locator('[data-testid="transition-remove"]').click()
    await expect.poll(async () => Object.keys(await stored()).length, WAIT).toBe(0)
    // The round button on the cut puts on the push up just chosen.
    await addAtTheCut()
    await expect.poll(async () => Object.values(await stored()).find((t) => t.kind !== 'even')?.kind, WAIT).toBe('pushUp')
  })

  it('draws the stylised ones on the monitor: zoom out, pixelate, RGB split, spin and flash (plan 95)', async () => {
    const cut = await cutFrame()
    /** Choose a kind from the transition's menu. */
    const choose = async (kind: string): Promise<void> => {
      await page.locator(TRANSITION).first().click({ button: 'right' })
      await page.waitForSelector('[data-testid="transition-menu"]', WAIT)
      await page.locator(`[data-testid="transition-kind-${kind}"]`).click()
      await expect.poll(async () => Object.values(await stored()).find((t) => t.kind !== 'even')?.kind, WAIT).toBe(kind)
    }
    /** Put the playhead on a frame. */
    const seek = async (frame: number): Promise<void> => {
      await page.click('[data-testid="monitor-timecode"]')
      await page.fill('[data-testid="timecode-input"]', `${frame}f`)
      await page.press('[data-testid="timecode-input"]', 'Enter')
      await expect.poll(() => page.getAttribute('[data-testid="timecode"]', 'data-playhead'), WAIT).toBe(String(frame))
    }
    /**
     * What the monitor shows, once it has drawn: the box round what is not
     * black, how bright it is, whether a point near the box's top left corner
     * is black, and how many of the columns in the middle the colour changes
     * across on any row: squares change only on their own edges.
     */
    type Seen = { box: { x: number; y: number; w: number; h: number }; bright: number; cornerBlack: boolean; changing: number }
    const seen = async (kind: string, box?: Seen['box']): Promise<Seen> => {
      // Drawn on the next frames the monitor paints.
      await page.waitForTimeout(400)
      const out = await page.evaluate((b) => {
        const c = document.querySelector('canvas[data-testid="program-canvas"]') as HTMLCanvasElement
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
        const at = (x: number, y: number): number[] => {
          const i = (Math.round(y) * c.width + Math.round(x)) * 4
          return [d[i]!, d[i + 1]!, d[i + 2]!]
        }
        let x0 = c.width
        let y0 = c.height
        let x1 = 0
        let y1 = 0
        let sum = 0
        for (let y = 0; y < c.height; y += 2) {
          for (let x = 0; x < c.width; x += 2) {
            const p = at(x, y)
            sum += p[0]! + p[1]! + p[2]!
            if (p[0]! + p[1]! + p[2]! > 30) {
              x0 = Math.min(x0, x)
              y0 = Math.min(y0, y)
              x1 = Math.max(x1, x)
              y1 = Math.max(y1, y)
            }
          }
        }
        const frame = b ?? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
        const corner = at(frame.x + frame.w * 0.06, frame.y + frame.h * 0.06)
        const columns = new Set<number>()
        let across = 0
        for (let x = Math.round(frame.x + frame.w * 0.1); x < frame.x + frame.w * 0.9; x++) {
          across++
          for (let y = frame.y + frame.h * 0.1; y < frame.y + frame.h * 0.9; y += 3) {
            const p = at(x, y)
            const q = at(x + 1, y)
            if (p.some((v, i) => Math.abs(v - q[i]!) > 8)) columns.add(x)
          }
        }
        return { box: frame, bright: sum / ((c.width * c.height) / 4) / 3, cornerBlack: corner.every((v) => v < 20), changing: columns.size / Math.max(1, across) }
      }, box ?? null)
      return out
    }

    // A quarter of the way in, then near the cut for the flash: against a dissolve at the same frames.
    const t = Object.values(await stored()).find((x) => x.kind !== 'even')!
    const early = cut - t.before + Math.round(t.length / 4)
    const late = cut - 2
    await choose('dissolve')
    await seek(early)
    const plain = await seen('dissolve')
    expect(plain.cornerBlack).toBe(false)
    await seek(late)
    const plainLate = await seen('dissolve', plain.box)

    await choose('spin')
    await seek(early)
    const spin = await seen('spin', plain.box)
    // Turned, its corners leave the frame black.
    expect(spin.cornerBlack).toBe(true)
    expect(spin.bright).toBeGreaterThan(10)

    await choose('pixelate')
    const squares = await seen('pixelate', plain.box)
    expect(squares.changing).toBeLessThan(plain.changing / 2)

    await choose('zoomOut')
    const zoomed = await seen('zoomOut', plain.box)
    expect(zoomed.cornerBlack).toBe(false)
    expect(zoomed.bright).toBeGreaterThan(10)

    await choose('rgbSplit')
    const split = await seen('rgbSplit', plain.box)
    expect(split.bright).toBeGreaterThan(10)

    await choose('flash')
    await seek(late)
    const flash = await seen('flash', plain.box)
    // Going white just before the cut, where a dissolve is not.
    expect(flash.bright).toBeGreaterThan(plainLate.bright + 30)
  })

  it('takes it off the picture and its sound together', async () => {
    await page.locator(TRANSITION).first().click({ button: 'right' })
    await page.waitForSelector('[data-testid="transition-menu"]', WAIT)
    await page.locator('[data-testid="transition-remove"]').click()
    await expect.poll(async () => Object.keys(await stored()).length, WAIT).toBe(0)
    await expect.poll(() => page.locator(TRANSITION).count(), WAIT).toBe(0)
  })

  it('plays across a dissolve with both pictures, and leaves one playing after it', async () => {
    // A cut with footage on both sides of it, as a split in the middle leaves:
    // at the cut between the two whole recordings there is none, and each side
    // holds its end frame still over the window, as the export does.
    const half = Math.floor((await cutFrame()) / 2)
    await page.click('[data-testid="monitor-timecode"]')
    await page.fill('[data-testid="timecode-input"]', `${half}f`)
    await page.press('[data-testid="timecode-input"]', 'Enter')
    await expect.poll(() => page.getAttribute('[data-testid="timecode"]', 'data-playhead'), WAIT).toBe(String(half))
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('s')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === 3, undefined, WAIT)
    await addAtTheCut()
    await page.locator(TRANSITION).first().click({ button: 'right' })
    await page.waitForSelector('[data-testid="transition-menu"]', WAIT)
    await page.locator('[data-testid="transition-kind-dissolve"]').click()
    await expect.poll(async () => Object.values(await stored())[0]?.kind, WAIT).toBe('dissolve')

    const playingOnV1 = (): Promise<number> =>
      page.evaluate(
        () => [...document.querySelectorAll('video[data-testid="track-video"][data-track="v1"]')].filter((v) => !(v as HTMLVideoElement).paused).length
      )

    // From the start, straight through the window in the middle.
    await page.keyboard.press('Home')
    await page.keyboard.press('Space')
    // Both pictures over the window, and one once it is past.
    await expect.poll(playingOnV1, WAIT).toBe(2)
    await expect.poll(playingOnV1, WAIT).toBe(1)
    await page.keyboard.press('Space')
    await expect.poll(playingOnV1, WAIT).toBe(0)

    await page.locator(TRANSITION).first().click({ button: 'right' })
    await page.waitForSelector('[data-testid="transition-menu"]', WAIT)
    await page.locator('[data-testid="transition-remove"]').click()
    await expect.poll(async () => Object.keys(await stored()).length, WAIT).toBe(0)
    // Back to the two whole recordings: the removal, the kind, the transition and the split.
    await page.locator('[data-testid="timecode"]').click()
    for (let i = 0; i < 4; i++) await page.keyboard.press('Control+z')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip"][data-kind="video"]').length === 2, undefined, WAIT)
    await expect.poll(async () => Object.keys(await stored()).length, WAIT).toBe(0)
  })

  it('hatches the part with no footage behind it, and says so in words', async () => {
    // Both clips are the whole recording, so a window at the cut reaches past
    // the end of one and the start of the other and holds a frame at each end.
    await addAtTheCut()
    // Two ends on the picture's rectangle and two on its sound's.
    expect(await page.locator('[data-testid="transition-held"]').count()).toBe(4)
    await page.locator(TRANSITION).first().click({ button: 'right' })
    await page.waitForSelector('[data-testid="transition-menu"]', WAIT)
    const said = (await page.locator('[data-testid="transition-menu"]').textContent()) ?? ''
    expect(said).toContain('hold one frame')
    await page.locator('[data-testid="transition-remove"]').click()
    await expect.poll(async () => Object.keys(await stored()).length, WAIT).toBe(0)
  })

  it('goes on at the nearest cut from the keyboard', async () => {
    // The keys to the editor, not to whatever the menu before left focused.
    await page.locator('[data-testid="timecode"]').click()
    await page.keyboard.press('Home')
    await expect.poll(() => page.getAttribute('[data-testid="timecode"]', 'data-playhead'), WAIT).toBe('0')
    await page.keyboard.press('Control+d')
    await expect.poll(async () => Object.keys(await stored()).length, WAIT).toBeGreaterThan(0)
    // At the start of the sequence, where there is nothing on the other side.
    // Read once the timeline has drawn it: the rectangle of the one taken off
    // before can still be there for a frame, and it is not at the start.
    const el = page.locator(`${TRANSITION}[data-from="0"]`).first()
    await el.waitFor(WAIT)
    expect(await el.getAttribute('data-kind')).toBe('toBlack')
  })
})

describe('picking a transition out', () => {
  const picked = (): Promise<number> => page.locator(`${TRANSITION}[data-selected="yes"]`).count()
  const clipCount = (): Promise<number> => page.locator('[data-testid="clip"]').count()

  /** Take every transition off, so this block starts from a timeline it knows. */
  async function clearAll(): Promise<void> {
    // A window just reopened shows the timeline a moment before the project
    // arrives, so it is counted once that has settled.
    await page.waitForLoadState('networkidle')
    let left = await page.locator(TRANSITION).count()
    while (left > 0) {
      await page.locator(TRANSITION).first().click({ button: 'right' })
      await page.waitForSelector('[data-testid="transition-menu"]', WAIT)
      await page.locator('[data-testid="transition-remove"]').click()
      await page.waitForSelector('[data-testid="transition-menu"]', { state: 'detached' })
      // Counted again only once the one taken off has gone from the timeline:
      // counted sooner, it is still there, and the next click waits on it for ever.
      const was = left
      await expect.poll(() => page.locator(TRANSITION).count(), WAIT).toBeLessThan(was)
      left = await page.locator(TRANSITION).count()
    }
  }

  it('takes the picture and the sound faded with it together', async () => {
    // Half a second, so the rectangle is narrow enough to leave the clips
    // either side of it clickable: the drags above left the remembered length
    // long, and it is the remembered one a new transition takes. Read when the
    // window opens, so the window is opened again.
    await page.evaluate(() => window.api.setAppSettings({ transitionSeconds: 0.5 }))
    await page.reload()
    await page.waitForSelector('main')
    await clearAll()
    await addAtTheCut()
    const box = (await page.locator(TRANSITION).first().boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(picked, WAIT).toBe(2)
  })

  it('takes one on its own when it is double clicked', async () => {
    const box = (await page.locator(TRANSITION).first().boundingBox())!
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(picked, WAIT).toBe(1)
  })

  it('deletes the transition, and not the clip that was selected before it', async () => {
    const clips = await clipCount()
    // A clip selected first, which is what Delete used to take instead.
    const clip = (await page.locator('[data-testid="clip"][data-kind="video"]').first().boundingBox())!
    await page.mouse.click(clip.x + clip.width / 2, clip.y + 20)
    await page.waitForSelector('[data-testid="clip"][data-selected="yes"]', WAIT)

    const box = (await page.locator(TRANSITION).first().boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(picked, WAIT).toBe(2)
    await page.keyboard.press('Delete')

    await expect.poll(async () => Object.keys(await stored()).length, WAIT).toBe(0)
    expect(await clipCount()).toBe(clips)
  })
})
