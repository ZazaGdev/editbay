import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-speed-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { runFfprobe } = await import('../../src/main/ffmpeg/run')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const session = await import('../../src/main/project/session')
const { S1, firstTimeline } = await import('../project-helpers')

/**
 * Plan 105: slow motion in a real export. Blended, every frame of a moving
 * picture at 0.5x is a new one, made between two of the recording's; in plain
 * frames each of the recording's is shown twice. Split in the middle, the two
 * pieces still make the whole clip.
 */

const fx = fixtureSet('speed-e2e')
const work = await mkdtemp(join(tmpdir(), 'editbay-speed-'))
afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]
let runs = 0

/** The moving test picture, 4 s, at 0.5x, exported; `edit` changes it first. */
async function slowExport(edit: () => void): Promise<string> {
  session.resetProject()
  const clip = await importFile(await fx.cleanClip(), ...quiet())
  session.addAsset(clip)
  session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: clip.id, clipId: 'c' })
  session.applyEdit({ sequenceId: S1, kind: 'setSpeed', clipId: 'c', speed: 0.5 })
  edit()
  const project = session.getProject()
  const scratch = join(work, `scratch-${++runs}`)
  const plan = planRender({
    timeline: firstTimeline(project),
    names: { ...exportNames(project, S1), joined: `slow-${runs}` },
    preset: presetById('landscape'),
    mode: 'join',
    outputDir: join(work, `out-${runs}`),
    scratchDir: scratch,
    filenamePattern: '{project}'
  })
  const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
  return out!
}

/**
 * How many frames a file has, and how many are all but a copy of the one
 * before: a frame of the recording shown a second time, which differs from
 * the first only by the encoder's own noise, a tenth of a usual step or less.
 */
async function framesOf(file: string): Promise<{ count: number; held: number }> {
  const [w, h] = [64, 36]
  const out = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'])
  const size = w * h
  const raw = out.stdout
  const count = Math.floor(raw.length / size)
  const steps: number[] = []
  for (let f = 1; f < count; f++) {
    let sum = 0
    for (let i = 0; i < size; i++) sum += Math.abs(raw[f * size + i]! - raw[(f - 1) * size + i]!)
    steps.push(sum / size)
  }
  const usual = [...steps].sort((a, b) => a - b)[Math.floor(steps.length * 0.75)] ?? 0
  return { count, held: steps.filter((s) => s < usual / 10).length }
}

describe('slow motion in an export', () => {
  it('at 0.5x lasts twice as long, every frame a new one when blended', async () => {
    const file = await slowExport(() => {})
    const { count, held } = await framesOf(file)
    expect(count).toBe(240)
    expect(held).toBeLessThan(20)
    const text = await runFfprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
    expect(Number(text.trim())).toBeCloseTo(8, 1)
  }, 240_000)

  it('in plain frames shows each frame of the recording twice', async () => {
    const file = await slowExport(() => session.applyEdit({ sequenceId: S1, kind: 'setSpeed', clipId: 'c', plainFrames: true }))
    const { count, held } = await framesOf(file)
    expect(count).toBe(240)
    expect(held).toBeGreaterThan(100)
  }, 240_000)

  it('split on an odd frame, the two pieces still make the whole clip', async () => {
    const file = await slowExport(() => session.applyEdit({ sequenceId: S1, kind: 'split', clipId: 'c', frame: 121 }))
    expect((await framesOf(file)).count).toBe(240)
  }, 240_000)

  it('split on an odd frame in plain frames, the second piece opens on the frame the preview shows there', async () => {
    // Audit 2026-10-19: the second piece's head is at recording frame 60.5.
    // Read from that exact second, ffmpeg threw frame 60 away and the piece
    // opened on 61, a frame ahead of the preview and of its own sound. Frame
    // 121 of the export is frame 60 of the recording again, as 120 is.
    const file = await slowExport(() => {
      session.applyEdit({ sequenceId: S1, kind: 'setSpeed', clipId: 'c', plainFrames: true })
      session.applyEdit({ sequenceId: S1, kind: 'split', clipId: 'c', frame: 121 })
    })
    const steps = await stepsOf(file)
    const usual = [...steps].sort((a, b) => a - b)[Math.floor(steps.length * 0.75)]!
    // steps[i] is how far frame i + 1 is from frame i.
    expect(steps[120]!, `step into frame 121 against a usual ${usual}`).toBeLessThan(usual / 10)
    expect(steps[121]!).toBeGreaterThan(usual / 2)
  }, 240_000)
})

/** How far each frame of a file is from the one before it, on average over its pixels. */
async function stepsOf(file: string): Promise<number[]> {
  const [w, h] = [64, 36]
  const out = await capture(ffmpegPath, ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'])
  const size = w * h
  const count = Math.floor(out.stdout.length / size)
  const steps: number[] = []
  for (let f = 1; f < count; f++) {
    let sum = 0
    for (let i = 0; i < size; i++) sum += Math.abs(out.stdout[f * size + i]! - out.stdout[(f - 1) * size + i]!)
    steps.push(sum / size)
  }
  return steps
}
