import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { discardUnsavedWork } from './dialogs'

/**
 * Plan 83: shapes over the picture. Picked from the Shape menu beside Add
 * text, drawn by a drag on the Output view, its ends and bend dragged, its
 * look changed in the Inspector and saved as a style of your own.
 */

const root = await mkdtemp(join(tmpdir(), 'editbay-shapes-ui-'))
let app: ElectronApplication
let page: Page

beforeAll(async () => {
  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`], cwd: process.cwd() })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await discardUnsavedWork(app)
}, 300_000)

afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/** Whether any pixel of the 5 by 5 around a point of the window is red: a line on a small monitor is thin. */
async function redNear(x: number, y: number): Promise<boolean> {
  const stage = page.locator('[data-testid="monitor-stage"]')
  const box = (await stage.boundingBox())!
  const file = join(root, `near-${Date.now()}.png`)
  await writeFile(file, await stage.screenshot())
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const size = String(probe).match(/, (\d+)x(\d+)/)
  const scale = size ? Number(size[1]) / box.width : 1
  const px = Math.round((x - box.x) * scale) - 2
  const py = Math.round((y - box.y) * scale) - 2
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=5:5:${px}:${py},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  // Red, or a thin red line blended with the black round it.
  for (let i = 0; i + 2 < stdout.length; i += 3) {
    const [r, g, b] = [stdout[i]!, stdout[i + 1]!, stdout[i + 2]!]
    if (r > 70 && r > 2 * g && r > 2 * b) return true
  }
  return false
}

interface Shaped {
  id: string
  place: { x: number; y: number; w: number; h: number }
  shape: { kind: string; endHead: boolean; strokeWidth: number; bend?: { x: number; y: number }; width: number; height: number }
}
/** Every shape clip on the first sequence, with its source's shape. */
async function shapes(): Promise<Shaped[]> {
  return page.evaluate(async () => {
    const p = await window.api.currentProject()
    return p.sequences[0]!.videoTracks.flatMap((r) =>
      r.clips.flatMap((c) => {
        const m = p.media.find((x) => x.id === c.mediaId)
        return m?.shape ? [{ id: c.id, place: c.transform.place, shape: m.shape }] : []
      })
    ) as unknown as Shaped[]
  })
}

/** The frame on screen: where a point of it in output pixels is in the window. */
async function frameMap(): Promise<(x: number, y: number) => { x: number; y: number }> {
  const box = (await page.locator('[data-testid="program-canvas"]').boundingBox())!
  const k = Math.min(box.width / 1080, box.height / 1920)
  const left = box.x + (box.width - 1080 * k) / 2
  const top = box.y + (box.height - 1920 * k) / 2
  return (x, y) => ({ x: left + x * k, y: top + y * k })
}

async function dragOn(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6)
  await page.mouse.up()
}

describe('a shape', () => {
  it('is picked from the Shape menu beside Add text, and drawn by a drag on the Output view', async () => {
    await page.keyboard.press('Control+n')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    if ((await page.inputValue('[data-testid="export-preset"]')) !== 'vertical') await page.selectOption('[data-testid="export-preset"]', 'vertical')
    // One view at a time, so the Output view is large enough to read a line's pixels.
    if ((await page.getAttribute('[data-testid="side-by-side"]', 'aria-pressed')) === 'true') await page.click('[data-testid="side-by-side"]')
    await page.click('[data-testid="add-shape"]')
    await page.waitForSelector('[data-testid="shape-menu"]')
    await page.locator('[data-testid="shape-pick"]', { hasText: /^Arrow$/ }).click()
    await page.waitForSelector('[data-testid="shape-draw"]')
    const at = await frameMap()
    await dragOn(at(300, 600), at(700, 1000))
    await page.waitForSelector('[data-testid="shape-draw"]', { state: 'detached' })
    await expect.poll(async () => (await shapes()).length, { timeout: 10_000 }).toBe(1)
    const [s] = await shapes()
    expect(s!.shape).toMatchObject({ kind: 'line', endHead: true })
    // Its picture is centred on the middle of the drag.
    expect((s!.place.x + s!.place.w / 2) * 1080).toBeCloseTo(500, -1)
    expect((s!.place.y + s!.place.h / 2) * 1920).toBeCloseTo(800, -1)
    // Selected, with its Shape group in the Inspector, and drawn red on the Output view.
    await page.waitForSelector('[data-testid="shape-panel"]')
    await page.screenshot({ path: join(process.env.EDITBAY_SHOTS ?? root, 'shape-arrow.png') })
    // A quarter of the way along, clear of the handle on its middle.
    const centre = async (id: string): Promise<{ x: number; y: number }> => {
      const b = (await page.locator(`[data-testid="${id}"]`).boundingBox())!
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }
    const a = await centre('shape-handle-from')
    const b = await centre('shape-handle-to')
    const along = { x: a.x + (b.x - a.x) * 0.3, y: a.y + (b.y - a.y) * 0.3 }
    await expect.poll(async () => redNear(along.x, along.y), { timeout: 10_000 }).toBe(true)
    // Off the line, nothing.
    expect(await redNear(b.x, a.y)).toBe(false)
    expect(await page.locator('[data-testid="clip-shape"]').count()).toBe(1)
  })

  it('points somewhere else when its end is dragged, and bends from its middle handle', async () => {
    const at = await frameMap()
    const end = (await page.locator('[data-testid="shape-handle-to"]').boundingBox())!
    await dragOn({ x: end.x + end.width / 2, y: end.y + end.height / 2 }, at(900, 1000))
    await expect.poll(async () => Math.round(((await shapes())[0]!.place.x + (await shapes())[0]!.place.w / 2) * 1080), { timeout: 10_000 }).toBeGreaterThan(560)
    expect((await shapes())[0]!.shape.bend).toBeUndefined()
    const middle = (await page.locator('[data-testid="shape-handle-bend"]').boundingBox())!
    await dragOn({ x: middle.x + middle.width / 2, y: middle.y + middle.height / 2 }, at(700, 600))
    await expect.poll(async () => (await shapes())[0]!.shape.bend !== undefined, { timeout: 10_000 }).toBe(true)
    // One undo takes the bend back.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await shapes())[0]!.shape.bend, { timeout: 10_000 }).toBeUndefined()
  })

  it('curves the arrow itself: while its middle is dragged only the outline shows, and one arrow is left (task 59)', async () => {
    // Straight again, to bend from.
    if ((await shapes())[0]!.shape.bend !== undefined) {
      await page.click('[data-testid="shape-bend"]')
      await expect.poll(async () => (await shapes())[0]!.shape.bend, { timeout: 10_000 }).toBeUndefined()
    }
    const centre = async (id: string): Promise<{ x: number; y: number }> => {
      const b = (await page.locator(`[data-testid="${id}"]`).boundingBox())!
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }
    const a = await centre('shape-handle-from')
    const b = await centre('shape-handle-to')
    // On the straight line, a quarter of the way along: red before the drag.
    const onLine = { x: a.x + (b.x - a.x) * 0.25, y: a.y + (b.y - a.y) * 0.25 }
    await expect.poll(async () => redNear(onLine.x, onLine.y), { timeout: 10_000 }).toBe(true)
    const m = await centre('shape-handle-bend')
    await page.mouse.move(m.x, m.y)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(m.x - 12 * i, m.y + 8 * i)
    await page.waitForSelector('[data-testid="shape-outline"]')
    // The straight arrow is not drawn under the curved outline.
    await expect.poll(async () => redNear(onLine.x, onLine.y), { timeout: 10_000 }).toBe(false)
    await page.mouse.up()
    await expect.poll(async () => (await shapes())[0]!.shape.bend !== undefined, { timeout: 10_000 }).toBe(true)
    await page.waitForSelector('[data-testid="shape-outline"]', { state: 'detached', timeout: 10_000 })
    expect(await shapes()).toHaveLength(1)
  })

  it('takes a wider outline from the Inspector, and is saved as a style for the Shape menu', async () => {
    await page.locator('[data-testid="shape-stroke-width"]').fill('20')
    await expect.poll(async () => (await shapes())[0]!.shape.strokeWidth, { timeout: 10_000 }).toBe(20)
    await page.click('[data-testid="shape-save"]')
    await page.fill('[data-testid="shape-save-name"]', 'Thick red arrow')
    await page.click('[data-testid="shape-save-confirm"]')
    await page.click('[data-testid="add-shape"]')
    await page.waitForSelector('[data-testid="shape-saved"][data-name="Thick red arrow"]')
    // Drawn with it, the new arrow is as thick.
    await page.locator('[data-testid="shape-saved-pick"]').click()
    const at = await frameMap()
    await dragOn(at(200, 1400), at(600, 1500))
    await expect.poll(async () => (await shapes()).length, { timeout: 10_000 }).toBe(2)
    expect((await shapes()).every((s) => s.shape.strokeWidth === 20)).toBe(true)
  })

  it('stops drawing on Escape, and a box drawn corner to corner is that size', async () => {
    await page.click('[data-testid="add-shape"]')
    await page.locator('[data-testid="shape-pick"]', { hasText: /^Box$/ }).click()
    await page.waitForSelector('[data-testid="shape-draw"]')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="shape-draw"]', { state: 'detached' })
    await page.click('[data-testid="add-shape"]')
    await page.locator('[data-testid="shape-pick"]', { hasText: /^Box$/ }).click()
    const at = await frameMap()
    await dragOn(at(100, 200), at(500, 500))
    await expect.poll(async () => (await shapes()).length, { timeout: 10_000 }).toBe(3)
    const box = (await shapes()).find((s) => s.shape.kind === 'box')!
    expect(box.shape.width).toBeGreaterThan(385)
    expect(box.shape.width).toBeLessThan(415)
    expect(box.shape.height).toBeGreaterThan(285)
    expect(box.shape.height).toBeLessThan(315)
  })

  // Plan 88.
  it('draws by hand with the pen, and draws itself on when Draw on is set', async () => {
    const before = (await shapes()).length
    await page.click('[data-testid="add-shape"]')
    await page.locator('[data-testid="shape-pick"]', { hasText: /^Pen$/ }).click()
    const at = await frameMap()
    // A wavy stroke, many steps long.
    await page.mouse.move(at(200, 900).x, at(200, 900).y)
    await page.mouse.down()
    for (let i = 1; i <= 30; i++) {
      const p = at(200 + i * 20, 900 + Math.round(80 * Math.sin(i / 3)))
      await page.mouse.move(p.x, p.y)
    }
    await page.mouse.up()
    await expect.poll(async () => (await shapes()).length, { timeout: 10_000 }).toBe(before + 1)
    const pen = (await shapes()).find((s) => (s.shape as { kind: string }).kind === 'pen')!
    expect((pen.shape as unknown as { points: unknown[] }).points.length).toBeGreaterThan(4)
    // Draw on: the picture becomes a run of pictures, played once.
    await page.waitForSelector('[data-testid="shape-panel"]')
    await page.locator('[data-testid="shape-draw-on-1"]').click()
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const p = await window.api.currentProject()
          const m = p.media.find((x) => x.shape?.kind === 'pen')
          return m ? [m.frames, m.once] : null
        })
      , { timeout: 15_000 })
      .toEqual([30, true])
  })

  it('stays on screen from letting go until its picture is in, never a blank frame between (task 86)', async () => {
    await page.click('[data-testid="add-shape"]')
    await page.locator('[data-testid="shape-pick"]', { hasText: /^Arrow$/ }).click()
    await page.waitForSelector('[data-testid="shape-draw"]')
    const at = await frameMap()
    const from = at(150, 1400)
    const to = at(900, 1750)
    // Every frame from letting go: the outline drawn, the arrow's picture drawn, or neither.
    await page.evaluate(({ from, to }) => {
      const canvas = document.querySelector('[data-testid="program-canvas"]') as HTMLCanvasElement
      const ctx = canvas.getContext('2d')!
      const r = canvas.getBoundingClientRect()
      const pts = [0.3, 0.4, 0.6, 0.7].map((f) => ({
        x: Math.round(((from.x + (to.x - from.x) * f - r.left) / r.width) * canvas.width),
        y: Math.round(((from.y + (to.y - from.y) * f - r.top) / r.height) * canvas.height)
      }))
      const red = (): boolean =>
        pts.some((q) => {
          const d = ctx.getImageData(q.x - 2, q.y - 2, 5, 5).data
          for (let k = 0; k < d.length; k += 4) if (d[k]! > 70 && d[k]! > 2 * d[k + 1]! && d[k]! > 2 * d[k + 2]!) return true
          return false
        })
      const w = { up: false, frames: 0, blank: 0, drawn: false, outlineLeft: true }
      ;(window as unknown as { __landing: typeof w }).__landing = w
      window.addEventListener('pointerup', () => (w.up = true), { capture: true, once: true })
      const tick = (): void => {
        if (w.up) {
          w.frames++
          const outline = document.querySelector('[data-testid="shape-draw"] svg path') !== null
          w.drawn = red()
          w.outlineLeft = outline
          if (!outline && !w.drawn) w.blank++
        }
        if (!w.up || (w.frames < 600 && (w.outlineLeft || !w.drawn))) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, { from, to })
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6)
    await page.mouse.up()
    await page.waitForFunction(() => {
      const w = (window as unknown as { __landing: { frames: number; drawn: boolean; outlineLeft: boolean } }).__landing
      return w.frames >= 600 || (w.drawn && !w.outlineLeft)
    }, undefined, { timeout: 15_000 })
    const w = await page.evaluate(() => (window as unknown as { __landing: { blank: number; drawn: boolean; outlineLeft: boolean } }).__landing)
    // Its picture took over from its outline, with no frame showing neither.
    expect(w).toMatchObject({ blank: 0, drawn: true, outlineLeft: false })
  })

  it('is drawn by the first press though a clip off the playhead is selected, and the playhead stays (task 91)', async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Control+n')
    await expect.poll(async () => (await shapes()).length, { timeout: 10_000 }).toBe(0)
    const at = await frameMap()
    // One shape, selected, and the playhead moved off it.
    await page.click('[data-testid="add-shape"]')
    await page.locator('[data-testid="shape-pick"]', { hasText: /^Arrow$/ }).click()
    await dragOn(at(200, 400), at(600, 700))
    await expect.poll(async () => (await shapes()).length, { timeout: 10_000 }).toBe(1)
    await page.waitForSelector('[data-testid="clip"][data-selected="yes"]')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('End')
    const playhead = (): Promise<string | null> => page.getAttribute('[data-testid="timecode"]', 'data-playhead')
    await expect.poll(playhead).not.toBe('0')
    const off = await playhead()
    // The first press on the Output view draws, rather than bringing the playhead back into the selected shape.
    await page.click('[data-testid="add-shape"]')
    await page.locator('[data-testid="shape-pick"]', { hasText: /^Arrow$/ }).click()
    await page.waitForSelector('[data-testid="shape-draw"]')
    await dragOn(at(300, 1200), at(800, 1500))
    await expect.poll(async () => (await shapes()).length, { timeout: 10_000 }).toBe(2)
    expect(await playhead()).toBe(off)
  })
})
