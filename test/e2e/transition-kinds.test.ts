import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-kinds-cache-'))
vi.mock('electron', () => ({ app: { getPath: (): string => cacheRoot } }))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const session = await import('../../src/main/project/session')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { PICTURE_KINDS, washRise } = await import('../../src/shared/transitions')
const { mixFor } = await import('../../src/renderer/preview/compositor')
const { S1, firstTimeline } = await import('../project-helpers')
type Mix = import('../../src/renderer/preview/compositor').Mix

/**
 * Plan 79: every picture transition that blends two clips, exported between
 * solid red and solid blue, and its frames read back at three moments on a
 * grid of points against what the preview's own `mixFor` says is there. The
 * preview and the export agree when these do.
 */

const fx = fixtureSet('transition-kinds')
const work = await mkdtemp(join(tmpdir(), 'editbay-kinds-'))
const W = 1080
const H = 1920
const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

type RGB = [number, number, number]
const RED: RGB = [255, 0, 0]
const BLUE: RGB = [0, 0, 255]

/** How much of a picture with this mix is over a point of the frame, 0 to 1, and whether the point is too near an edge of it to judge. */
function over(m: Mix, x: number, y: number): { a: number; edge: boolean } {
  const margin = 16
  if (m.hidden) return { a: 0, edge: false }
  let edge = false
  if (m.clip) {
    const c = m.clip
    if (x < c.x || x >= c.x + c.w || y < c.y || y >= c.y + c.h) {
      edge = Math.min(Math.abs(x - c.x), Math.abs(x - c.x - c.w), Math.abs(y - c.y), Math.abs(y - c.y - c.h)) < margin
      return { a: 0, edge }
    }
    edge = Math.min(x - c.x, c.x + c.w - x, y - c.y, c.y + c.h - y) < margin
  }
  if (m.circle) {
    const d = Math.hypot(x - m.circle.x, y - m.circle.y)
    if (Math.abs(d - m.circle.r) < margin) edge = true
    if (d > m.circle.r) return { a: 0, edge }
  }
  // Turned about a point, the frame's own point is where the picture's was before the turn (plan 95).
  let tx = x
  let ty = y
  if (m.turn) {
    const cos = Math.cos(-m.turn.a)
    const sin = Math.sin(-m.turn.a)
    tx = m.turn.x + (x - m.turn.x) * cos - (y - m.turn.y) * sin
    ty = m.turn.y + (x - m.turn.x) * sin + (y - m.turn.y) * cos
  }
  // The picture fills the frame, moved; a zoom only enlarges it, so it still does.
  const px = tx - (m.dx ?? 0)
  const py = ty - (m.dy ?? 0)
  if (Math.min(Math.abs(px), Math.abs(px - W), Math.abs(py), Math.abs(py - H)) < margin) edge = true
  if (px < 0 || px >= W || py < 0 || py >= H) return { a: 0, edge }
  let a = m.alpha ?? 1
  if (m.radial) a *= m.radial.alpha(Math.hypot(x - m.radial.x, y - m.radial.y))
  return { a, edge }
}

/** What the preview draws at a point: black, the red picture going with its mix, the blue coming with its. */
function expected(kind: string, p: number, x: number, y: number): { rgb: RGB; edge: boolean } {
  const mix = mixFor(kind, p, { x: 0, y: 0, w: W, h: H }, W)
  const out = over(mix.out, x, y)
  const into = over(mix.into, x, y)
  const layer = (below: RGB, top: RGB, a: number): RGB => below.map((v, i) => v * (1 - a) + top[i]! * a) as RGB
  return { rgb: layer(layer([0, 0, 0], RED, out.a), BLUE, into.a), edge: out.edge || into.edge }
}

async function frameAt(path: string, n: number): Promise<Buffer> {
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', path, '-vf', `select='eq(n,${n})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
  return stdout
}

/** Red, then blue with footage before its first frame, meeting at frame 60, with a transition of `kind` 30 frames long centred on the cut. */
async function exported(kind: string): Promise<string> {
  session.resetProject()
  const red = await importFile(await fx.solidClip('red', 440, 3), ...quiet())
  const blue = await importFile(await fx.solidClip('blue', 880, 3), ...quiet())
  session.addAsset(red)
  session.addAsset(blue)
  session.applyEdit({ kind: 'setSourceMarks', mediaId: blue.id, in: 30 })
  session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'first' })
  session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: blue.id, clipId: 'second' })
  session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: 'first', frame: 60, closeUp: true })
  session.applyEdit({ sequenceId: S1, kind: 'addTransition', clipId: 'second', side: 'in', transitionKind: kind, length: 30 })
  const project = session.getProject()
  const scratch = join(work, `scratch-${kind}`)
  const plan = planRender({
    timeline: firstTimeline(project),
    names: exportNames(project, S1),
    preset: presetById('vertical'),
    mode: 'join',
    outputDir: join(work, kind),
    scratchDir: scratch,
    filenamePattern: '{project}'
  })
  const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
  return out!
}

// Every kind that blends two pictures; the dips are checked by the export tests, and the flash below.
const kinds = PICTURE_KINDS.filter((k) => k.colour === undefined).map((k) => k.id)

/** The frame's colours on the grid, against what a check wants at each point, as misses. */
function missesIn(px: Buffer, f: number, want: (x: number, y: number) => { rgb: RGB; edge: boolean }): string[] {
  const misses: string[] = []
  for (let x = 60; x < W; x += 160) {
    for (let y = 80; y < H; y += 220) {
      const w = want(x, y)
      if (w.edge) continue
      const i = (y * W + x) * 3
      const got: RGB = [px[i]!, px[i + 1]!, px[i + 2]!]
      if (got.some((v, c) => Math.abs(v - w.rgb[c]!) > 48)) {
        misses.push(`frame ${f} at ${x},${y}: wanted ${w.rgb.map(Math.round).join('/')}, got ${got.join('/')}`)
      }
    }
  }
  return misses
}

describe('each transition, in the export as the preview draws it', () => {
  for (const kind of kinds) {
    it(kind, async () => {
      const file = await exported(kind)
      // The window runs from frame 45 to 75: a moment early, near the middle and late in it.
      for (const f of [52, 58, 67]) {
        const p = (f - 45) / 30
        const misses = missesIn(await frameAt(file, f), f, (x, y) => expected(kind, p, x, y))
        expect(misses, misses.slice(0, 5).join('\n')).toEqual([])
      }
    }, 120_000)
  }
})

describe('a flash, in the export as the preview draws it', () => {
  it('stays on the picture, goes white just before the cut and fades back after it', async () => {
    const file = await exported('flash')
    // The window runs from frame 45 to 75 and hands over at 60: red going to white late, blue coming out of it.
    for (const f of [50, 57, 59, 66]) {
      const white = f < 60 ? washRise('flash', (f - 45) / 15) : 1 - (f - 60) / 15
      const picture = f < 60 ? RED : BLUE
      const rgb = picture.map((v) => v * (1 - white) + 255 * white) as RGB
      const misses = missesIn(await frameAt(file, f), f, () => ({ rgb, edge: false }))
      expect(misses, misses.slice(0, 5).join('\n')).toEqual([])
    }
  }, 120_000)
})
