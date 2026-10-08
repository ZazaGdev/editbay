import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-box-cache-'))
vi.mock('electron', () => ({ app: { getPath: (): string => cacheRoot } }))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const session = await import('../../src/main/project/session')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { boxAtKeys } = await import('../../src/shared/box-keys')
const { drawPlan } = await import('../../src/renderer/preview/compositor')
const { S1, firstTimeline } = await import('../project-helpers')

/**
 * Plan 97: a face cam's box moved out of the way and back, exported over red
 * and read at moments along the move, against where the Output view's own
 * drawing puts the box on those frames. Blue where the box is, red where it
 * has gone from, and for a fade, the two mixed as far as the box is drawn.
 */

const fx = fixtureSet('moving-box')
const work = await mkdtemp(join(tmpdir(), 'editbay-box-'))
const W = 1080
const H = 1920
const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]
const PLACE = { x: 0.62, y: 0.66, w: 0.32, h: 0.18 }

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

type RGB = [number, number, number]

async function frameAt(path: string, n: number): Promise<Buffer> {
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', path, '-vf', `select='eq(n,${n})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
  return stdout
}

/** Red on V1, blue on V2 as a box in the lower right, moved out of the way from frame 15 to 75 by `how`. */
async function exported(how: 'slide' | 'fade'): Promise<{ file: string; keys: import('../../src/shared/project').BoxKey[] }> {
  session.resetProject()
  const red = await importFile(await fx.solidClip('red', 440, 4), ...quiet())
  const blue = await importFile(await fx.solidClip('blue', 880, 4), ...quiet())
  session.addAsset(red)
  session.addAsset(blue)
  session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
  session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
  session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: blue.id, clipId: 'cam', at: 0, onTrack: 'V2' })
  session.applyEdit({ sequenceId: S1, kind: 'setPlace', clipId: 'cam', picture: 'main', place: PLACE, reshapeCrop: true })
  session.applyEdit({ sequenceId: S1, kind: 'moveOutOfTheWay', clipId: 'cam', from: 15, to: 75, how })
  const project = session.getProject()
  const clip = firstTimeline(project).videoTracks[1]!.clips[0]!
  const scratch = join(work, `scratch-${how}`)
  const plan = planRender({
    timeline: firstTimeline(project),
    names: exportNames(project, S1),
    preset: presetById('vertical'),
    mode: 'join',
    outputDir: join(work, how),
    scratchDir: scratch,
    filenamePattern: '{project}'
  })
  const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
  return { file: out!, keys: clip.transform.boxKeys ?? [] }
}

/** Where the Output view draws the box on frame `f`, in output pixels, and how much of it, by its own plan. */
function drawnBox(
  keys: import('../../src/shared/project').BoxKey[],
  f: number,
  crop = { x: 0, y: 0, w: 100, h: 100 },
  style?: import('../../src/shared/project').PictureStyle
): { x: number; y: number; w: number; h: number; a: number; outer: { x: number; y: number; w: number; h: number } } {
  const timeline = firstTimeline(session.getProject())
  const box = boxAtKeys(PLACE, keys, f)
  const plan = drawPlan(timeline, [{ pictures: [{ crop, place: PLACE, box, ...(style ? { style } : {}) }], over: true }], { width: W, height: H })
  const s = plan.steps[0]!
  const slide = s.slide ?? { from: { x: s.to.x, y: s.to.y }, to: { x: s.to.x, y: s.to.y }, sx: 1, sy: 1 }
  const moved = (r: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } => ({
    x: slide.to.x + (r.x - slide.from.x) * slide.sx,
    y: slide.to.y + (r.y - slide.from.y) * slide.sy,
    w: r.w * slide.sx,
    h: r.h * slide.sy
  })
  // The picture, and the whole box it sits in with its bars, where it is framed.
  return { ...moved(s.to), a: s.alpha ?? 1, outer: moved(s.box ?? s.to) }
}

/** The colours on a grid of the frame against the box as the view draws it, as misses. */
function misses(
  px: Buffer,
  f: number,
  b: { x: number; y: number; w: number; h: number; a: number; outer: { x: number; y: number; w: number; h: number } },
  colours: { box: RGB; under: RGB } = { box: [0, 0, 255], under: [255, 0, 0] },
  margin = 12
): string[] {
  const out: string[] = []
  for (let x = 30; x < W; x += 45) {
    for (let y = 40; y < H; y += 60) {
      const inside = x > b.x + margin && x < b.x + b.w - margin && y > b.y + margin && y < b.y + b.h - margin
      const o = b.outer
      const outside = x < o.x - margin || x > o.x + o.w + margin || y < o.y - margin || y > o.y + o.h + margin
      if (!inside && !outside) continue
      const want = (inside ? colours.box.map((v, c) => v * b.a + colours.under[c]! * (1 - b.a)) : colours.under) as RGB
      const i = (y * W + x) * 3
      const got: RGB = [px[i]!, px[i + 1]!, px[i + 2]!]
      if (got.some((v, c) => Math.abs(v - want[c]!) > 40)) out.push(`frame ${f} at ${x},${y}: wanted ${want.map(Math.round).join('/')}, got ${got.join('/')}`)
    }
  }
  return out
}

describe('a face cam moved out of the way, in the export as the preview draws it', () => {
  it('slides to the free corner and back', async () => {
    const { file, keys } = await exported('slide')
    expect(keys.length).toBe(4)
    // Before, going, away, coming back, and after.
    for (const f of [8, 18, 21, 45, 71, 82]) {
      const box = drawnBox(keys, f)
      const m = misses(await frameAt(file, f), f, box)
      expect(m, m.slice(0, 5).join('\n')).toEqual([])
    }
    // Away, the box is in the lower left, beside where it was.
    expect(drawnBox(keys, 45).x).toBeLessThan(W / 2)
  }, 180_000)

  it('fades out and back in where it is', async () => {
    const { file, keys } = await exported('fade')
    for (const f of [8, 18, 45, 72, 82]) {
      const box = drawnBox(keys, f)
      const m = misses(await frameAt(file, f), f, box)
      expect(m, m.slice(0, 5).join('\n')).toEqual([])
    }
    expect(drawnBox(keys, 45).a).toBe(0)
  }, 180_000)

  it('moves and grows a second picture of the same recording, framed, on V1', async () => {
    session.resetProject()
    // Green on the left three quarters, blue on the right: the screen, and the camera beside it.
    const { mkdir } = await import('node:fs/promises')
    await mkdir(fx.dir, { recursive: true })
    const path = join(fx.dir, 'screen-and-cam.mp4')
    await capture(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=0x00C000:s=640x360:r=30:d=4',
      '-vf', 'drawbox=x=480:y=0:w=160:h=360:color=0x0000FF:t=fill',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', path
    ])
    const rec = await importFile(path, ...quiet())
    session.addAsset(rec)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: rec.id, clipId: 'c' })
    session.applyEdit({ sequenceId: S1, kind: 'setCrop', clipId: 'c', rect: { x: 0, y: 0, w: 200, h: 356 } })
    session.applyEdit({ sequenceId: S1, kind: 'addLayer', clipId: 'c', layerId: 'cam' })
    session.applyEdit({ sequenceId: S1, kind: 'setPlace', clipId: 'c', picture: 'cam', place: PLACE, reshapeCrop: true })
    session.applyEdit({ sequenceId: S1, kind: 'setCrop', clipId: 'c', picture: 'cam', rect: { x: 500, y: 100, w: 120, h: 68 } })
    session.applyEdit({ sequenceId: S1, kind: 'setPictureStyle', clipId: 'c', picture: 'cam', style: { border: 8, radius: 10 } })
    const big = { x: 0.3, y: 0.4, w: 0.5, h: 0.28 }
    session.applyEdit({ sequenceId: S1, kind: 'setBoxKey', clipId: 'c', picture: 'cam', at: 20, place: PLACE })
    session.applyEdit({ sequenceId: S1, kind: 'setBoxKey', clipId: 'c', picture: 'cam', at: 70, place: big })
    const project = session.getProject()
    const clip = firstTimeline(project).videoTracks[0]!.clips[0]!
    const cam = clip.layers.find((l) => l.id === 'cam')!
    const keys = cam.boxKeys!
    const scratch = join(work, 'scratch-layer')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: exportNames(project, S1),
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: join(work, 'layer'),
      scratchDir: scratch,
      filenamePattern: '{project}'
    })
    const [file] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
    const colours = { box: [0, 0, 255] as RGB, under: [0, 192, 0] as RGB }
    for (const f of [10, 35, 50, 80]) {
      const box = drawnBox(keys, f, cam.crop, cam.style)
      // Clear of the border, which is outside the picture's own box.
      const m = misses(await frameAt(file!, f), f, box, colours, 24)
      expect(m, m.slice(0, 5).join('\n')).toEqual([])
    }
    expect(drawnBox(keys, 80, cam.crop).w).toBeGreaterThan(drawnBox(keys, 10, cam.crop).w * 1.4)
  }, 180_000)
})
