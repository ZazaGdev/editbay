import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { discardUnsavedWork } from './dialogs'
import type { EditList } from '../../src/shared/edit-list'

/**
 * Task 1092: a dip to black and a blur on a cut, frame by frame, as the
 * monitor draws them and as the export writes them. The dip is the owner's
 * own shape, 22 frames with 9 before the cut: it must be darkest on the cut
 * itself, with no frame brighter than the one before it on the way down or
 * darker on the way up. The blur must blend the two pictures blurred both
 * ways, with no black strip down one side and no sideways-only smear.
 */

const run = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'editbay-transition-frames-'))
const CLI = join(process.cwd(), 'out', 'cli', 'editbay-cli.cjs')
const WAIT = { timeout: 10_000 }
let app: ElectronApplication
let page: Page

/** The two transitions, each on the clip after its cut. */
const DIP = { kind: 'toBlack', length: 22, before: 9 }
const BLUR = { kind: 'blur', length: 20, before: 10 }
let dipCut = 0
let blurCut = 0

/** A frame in grey, as small as both sides read it, for comparing. */
interface Grey {
  w: number
  h: number
  px: number[]
}
const W = 480
const H = 270

beforeAll(async () => {
  await run(process.execPath, [join(process.cwd(), 'scripts', 'build-cli.mjs')])
  // A grid of squares, as much detail across as down, so a blur that only
  // blurs across shows: the rows of squares are left as streaks.
  const clip = join(root, 'squares.mp4')
  await capture(ffmpegPath, [
    '-v', 'error',
    '-f', 'lavfi', '-i', "nullsrc=s=640x360:r=30:d=4,geq=lum='if(lt(mod(X,40),20)*lt(mod(Y,40),20),220,40)':cb=128:cr=128",
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', clip
  ])
  // A 4 s recording with two stretches taken out: three clips, two cuts.
  const list: EditList = {
    version: 1,
    shape: 'landscape',
    sources: [{ id: 'main', path: clip, offsetSec: 0 }],
    main: 'main',
    sound: 'main',
    cuts: [
      { fromSec: 1, toSec: 1.2, why: 'pause' },
      { fromSec: 2.5, toSec: 2.7, why: 'pause' }
    ],
    zooms: [],
    markers: []
  }
  const listPath = join(root, 'cuts.json')
  await writeFile(listPath, JSON.stringify(list, null, 2))
  const target = join(root, 'cuts.editbay')
  await run(process.execPath, [CLI, 'build', listPath, '--out', target])
  const project = JSON.parse(await readFile(target, 'utf8'))
  const seq = project.sequences[0]
  const v1 = seq.videoTracks[0].clips
  expect(v1.length).toBe(3)
  v1[1].transitionIn = DIP
  v1[2].transitionIn = BLUR
  dipCut = v1[1].timelineStart
  blurCut = v1[2].timelineStart
  await writeFile(target, JSON.stringify(project, null, 2))

  app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'user-data')}`, target], cwd: process.cwd(), env: { ...process.env } as Record<string, string> })
  page = await app.firstWindow()
  await page.waitForSelector('main')
  await page.waitForFunction(
    () => {
      const clips = [...document.querySelectorAll('[data-testid="clip"]')]
      return clips.length >= 3 && clips.every((c) => c.getAttribute('data-rebuilding') !== 'yes' && c.getAttribute('data-offline') !== 'yes')
    },
    undefined,
    { timeout: 180_000 }
  )
  await page.click('[data-testid="view-program"]')
}, 400_000)

afterAll(async () => {
  if (app) await discardUnsavedWork(app).catch(() => undefined)
  await app?.close().catch(() => undefined)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/** The monitor at a frame, the output frame on it only, in grey. */
async function previewAt(frame: number): Promise<Grey> {
  await page.click('[data-testid="monitor-timecode"]')
  await page.fill('[data-testid="timecode-input"]', `${frame}f`)
  await page.press('[data-testid="timecode-input"]', 'Enter')
  await expect.poll(() => page.getAttribute('[data-testid="timecode"]', 'data-playhead'), WAIT).toBe(String(frame))
  // Drawn on the next frames the monitor paints.
  await page.waitForTimeout(400)
  return page.evaluate(
    ({ w, h }) => {
      const c = document.querySelector('canvas[data-testid="program-canvas"]') as HTMLCanvasElement
      // The output frame is the 16:9 box in the middle of the monitor.
      const k = Math.min(c.width / 16, c.height / 9)
      const fw = 16 * k
      const fh = 9 * k
      const small = document.createElement('canvas').getContext('2d')!
      small.canvas.width = w
      small.canvas.height = h
      small.imageSmoothingQuality = 'high'
      small.drawImage(c, (c.width - fw) / 2, (c.height - fh) / 2, fw, fh, 0, 0, w, h)
      const d = small.getImageData(0, 0, w, h).data
      const px: number[] = []
      for (let i = 0; i < d.length; i += 4) px.push((d[i]! + d[i + 1]! + d[i + 2]!) / 3)
      return { w, h, px }
    },
    { w: W, h: H }
  )
}

/** The exported frame at a frame, in grey. */
async function exportAt(frame: number): Promise<Grey> {
  const saved = await page.evaluate(
    async (r) => {
      const p = await window.api.currentProject()
      return window.api.saveFrame({ sequenceId: p.sequences[0]!.id, frame: r.frame, outputDir: r.dir })
    },
    { frame, dir: join(root, `frames-${frame}`) }
  )
  expect(saved.error).toBeUndefined()
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', saved.path!, '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'])
  return { w: W, h: H, px: [...stdout] }
}

function mean(g: Grey): number {
  return g.px.reduce((a, b) => a + b, 0) / g.px.length
}

/** How bright the rightmost tenth of the frame is. */
function rightEdge(g: Grey): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < g.h; y++) for (let x = Math.floor(g.w * 0.9); x < g.w; x++, n++) sum += g.px[y * g.w + x]!
  return sum / n
}

/** How much the picture changes from one pixel to the next, across and down. */
function detail(g: Grey): { across: number; down: number } {
  let across = 0
  let down = 0
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const v = g.px[y * g.w + x]!
      across += Math.abs(v - g.px[y * g.w + x + 1]!)
      down += Math.abs(v - g.px[(y + 1) * g.w + x]!)
    }
  }
  return { across, down }
}

describe.each([
  ['preview', previewAt],
  ['export', exportAt]
] as const)('transitions on a cut, in the %s', (_where, at) => {
  it('dips darkest exactly on the cut, never brightening on the way down or darkening on the way up', async () => {
    const from = dipCut - DIP.before
    const to = from + DIP.length
    const before = mean(await at(from - 1))
    const seen: [number, number][] = []
    for (let f = from; f < to; f++) seen.push([f, mean(await at(f))])
    const onCut = seen.find(([f]) => f === dipCut)![1]
    expect(before, 'a picture before the dip').toBeGreaterThan(40)
    expect(onCut, `black on the cut, frames ${JSON.stringify(seen)}`).toBeLessThan(4)
    for (const [f, v] of seen) expect(v, `frame ${f} no darker than the cut`).toBeGreaterThanOrEqual(onCut - 1)
    for (let i = 1; i < seen.length; i++) {
      const [f, v] = seen[i]!
      const prev = seen[i - 1]![1]
      if (f <= dipCut) expect(v, `frame ${f} going down, ${JSON.stringify(seen)}`).toBeLessThanOrEqual(prev + 3)
      else expect(v, `frame ${f} coming up, ${JSON.stringify(seen)}`).toBeGreaterThanOrEqual(prev - 3)
    }
  }, 300_000)

  it('blurs both ways through the cut, with no strip down the side and no sideways smear', async () => {
    const from = blurCut - BLUR.before
    const sharp = await at(from - 1)
    const middle = await at(from + Math.floor(BLUR.length / 2))
    const s = detail(sharp)
    const m = detail(middle)
    const numbers = JSON.stringify({ sharp: s, middle: m })
    // Blurred: much of the detail gone.
    expect(m.across + m.down, `blurred in the middle, ${numbers}`).toBeLessThan((s.across + s.down) * 0.6)
    // As much both ways, as the squares are: a sideways smear wipes the
    // detail across flat and leaves the rows of squares as streaks.
    expect(m.across / m.down, `blurred down as much as across, ${numbers}`).toBeGreaterThan(0.6)
    expect(m.across / m.down, `blurred down as much as across, ${numbers}`).toBeLessThan(1 / 0.6)
    // No black strip down the right.
    expect(rightEdge(middle), 'the right edge still shows the picture').toBeGreaterThan(rightEdge(sharp) * 0.6)
  }, 300_000)
})
