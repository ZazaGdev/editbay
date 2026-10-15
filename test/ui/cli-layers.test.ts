import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { capture, captureText } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { fitInBox } from '../../src/shared/crop-geometry'
import { fixtureSet } from '../e2e/fixtures'
import { discardUnsavedWork } from './dialogs'
import type { EditList } from '../../src/shared/edit-list'

/**
 * Task 137: an edit list's layers. A picture on the left half of the frame
 * and an overlay clip with its black taken out, built by `npm run cli --
 * build`, open in Editbay as clips on a track above the cut, and each shows
 * at the time the list gave, in the Output view and in an exported frame.
 */

const run = promisify(execFile)
const WAIT = { timeout: 15_000 }
const fx = fixtureSet('cli-layers')
const root = await mkdtemp(join(tmpdir(), 'editbay-cli-layers-'))
const CLI = join(process.cwd(), 'out', 'cli', 'editbay-cli.cjs')
const shots = process.env.EDITBAY_SHOTS ?? root
let app: ElectronApplication
let page: Page

type Rgb = [number, number, number]
const RED: Rgb = [255, 0, 0]
const LOGO_GREEN: Rgb = [0, 200, 0]
const TARGET_GREEN: Rgb = [0, 128, 0]

beforeAll(async () => {
  await run(process.execPath, [join(process.cwd(), 'scripts', 'build-cli.mjs')])
}, 180_000)

afterAll(async () => {
  if (app) await discardUnsavedWork(app).catch(() => undefined)
  await app?.close().catch(() => undefined)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fx.cleanup()
})

/** One pixel of a picture file, at shares of the part of it `frame` gives. */
async function pixel(file: string, at: [number, number], frame: (w: number, h: number) => { x: number; y: number; w: number; h: number }): Promise<Rgb> {
  const probe = await captureText(ffmpegPath, ['-hide_banner', '-i', file]).catch((e: { stderr?: string }) => e.stderr ?? '')
  const [, w = '0', h = '0'] = String(probe).match(/, (\d+)x(\d+)/) ?? []
  const f = frame(Number(w), Number(h))
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${Math.round(f.x + at[0] * f.w)}:${Math.round(f.y + at[1] * f.h)},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  return [stdout[0]!, stdout[1]!, stdout[2]!]
}

const near = (a: Rgb, b: Rgb): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= 24)

async function seek(frame: number): Promise<void> {
  await page.click('[data-testid="monitor-timecode"]')
  await page.fill('[data-testid="timecode-input"]', `${frame}f`)
  await page.press('[data-testid="timecode-input"]', 'Enter')
  await expect.poll(() => page.getAttribute('[data-testid="timecode"]', 'data-playhead'), WAIT).toBe(String(frame))
}

/**
 * The colour at each point of the frame on `frame`, as an export writes it
 * and as the Output view shows it, once the view agrees. The view is saved as
 * `name` for a person to look at.
 */
async function colours(frame: number, points: [number, number][], name: string): Promise<{ file: Rgb[]; view: Rgb[] }> {
  await seek(frame)
  const output = await page.evaluate(async () => (await window.api.currentProject()).sequences[0]!.output)
  const saved = await page.evaluate(async (r) => {
    const p = await window.api.currentProject()
    return window.api.saveFrame({ sequenceId: p.sequences[0]!.id, frame: r.frame, outputDir: r.dir })
  }, { frame, dir: join(root, 'frames') })
  expect(saved.error).toBeUndefined()
  const file: Rgb[] = []
  for (const p of points) file.push(await pixel(saved.path!, p, (w, h) => ({ x: 0, y: 0, w, h })))
  const shot = join(shots, name)
  let view: Rgb[] = []
  for (let i = 0; i < 20; i++) {
    await writeFile(shot, await page.locator('[data-testid="program-canvas"]').screenshot())
    view = []
    for (const p of points) {
      view.push(
        await pixel(shot, p, (w, h) => {
          const fit = fitInBox(output.width, output.height, w, h)
          return { x: fit.offsetX, y: fit.offsetY, w: fit.width, h: fit.height }
        })
      )
    }
    if (view.every((c, k) => near(c, file[k]!))) break
    await page.waitForTimeout(150)
  }
  return { file, view }
}

describe('layers built from an edit list', () => {
  it('opens with the picture on the left half and the keyed overlay clip, each at its time', async () => {
    // 8 s of red; a logo, clear but for a green box in its middle half; 7 s of black with a green box in its middle half.
    const [main, logo, overlay] = [await fx.solidClip('red', 440, 8), await fx.logoPng(), await fx.targetClip()]
    const list: EditList = {
      version: 1,
      shape: 'landscape',
      sources: [{ id: 'main', path: main, offsetSec: 0 }],
      main: 'main',
      sound: 'main',
      cuts: [{ fromSec: 1, toSec: 2, why: 'pause' }],
      zooms: [],
      markers: [],
      layers: [
        { path: logo, fromSec: 2.5, toSec: 4, box: 'left-half', why: 'the sketch', mark: true },
        { path: overlay, fromSec: 4.5, toSec: 6.5, key: 'black', why: 'subscribe', mark: true }
      ]
    }
    const listPath = join(root, 'layers.json')
    await writeFile(listPath, JSON.stringify(list, null, 2))
    const target = join(root, 'layers.editbay')
    const { stdout } = await run(process.execPath, [CLI, 'build', listPath, '--out', target])
    const built = JSON.parse(stdout) as { ok: boolean; layers: { atSec: number; toSec: number }[] }
    expect(built.ok).toBe(true)
    // With 1 s cut out before them, they land a second earlier in the cut.
    expect(built.layers.map((l) => [l.atSec, l.toSec])).toEqual([
      [1.5, 3],
      [3.5, 5.5]
    ])

    app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`, target], cwd: process.cwd(), env: { ...process.env } as Record<string, string> })
    page = await app.firstWindow()
    await page.waitForSelector('main')
    // The main picture in two pieces and the two layers, every one imported.
    await page.waitForFunction(
      () => {
        const clips = [...document.querySelectorAll('[data-testid="clip"]')]
        return clips.length === 4 && clips.every((c) => c.getAttribute('data-rebuilding') === 'no' && c.getAttribute('data-offline') === 'no')
      },
      undefined,
      { timeout: 180_000 }
    )
    expect(await page.locator('[data-testid="missing-media"]').count()).toBe(0)
    await page.click('[data-testid="view-program"]')
    await page.waitForSelector('[data-testid="monitor-stage"][data-view="program"]')
    const s = (await page.evaluate(() => window.api.currentProject())).sequences[0]!
    expect(s.videoTracks.map((r) => r.clips.length)).toEqual([2, 2])
    expect(s.markers.map((m) => [m.frame, m.name])).toEqual([
      [45, 'the sketch'],
      [105, 'subscribe']
    ])

    const LEFT: [number, number] = [0.25, 0.5]
    const RIGHT: [number, number] = [0.75, 0.5]
    const CORNER: [number, number] = [0.1, 0.1]
    const MIDDLE: [number, number] = [0.5, 0.5]
    const points = [LEFT, RIGHT, CORNER, MIDDLE]

    // Before either: red all over.
    const before = await colours(15, points, 'layers-before.png')
    for (const c of [...before.file, ...before.view]) expect(near(c, RED), String(c)).toBe(true)

    // The picture: its green box in the middle of the left half, red beside it.
    const sketch = await colours(60, points, 'layers-sketch.png')
    for (const got of [sketch.file, sketch.view]) {
      expect(near(got[0]!, LOGO_GREEN), String(got[0])).toBe(true)
      expect(near(got[1]!, RED), String(got[1])).toBe(true)
      expect(near(got[2]!, RED), String(got[2])).toBe(true)
    }

    // The overlay: its black taken out, so red at the corner and its green box in the middle. Taking
    // black out softens a green this dark a little too, so the box is greener than red, not pure green.
    const sub = await colours(135, points, 'layers-overlay.png')
    for (const got of [sub.file, sub.view]) {
      expect(near(got[2]!, RED), String(got[2])).toBe(true)
      expect(got[3]![1], String(got[3])).toBeGreaterThan(TARGET_GREEN[1] / 3)
      expect(got[3]![0], String(got[3])).toBeLessThan(RED[0] * 0.7)
    }

    // After both: red all over again.
    const after = await colours(185, points, 'layers-after.png')
    for (const c of [...after.file, ...after.view]) expect(near(c, RED), String(c)).toBe(true)
  }, 400_000)
})
