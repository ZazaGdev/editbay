import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-timing-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { runFfprobe } = await import('../../src/main/ffmpeg/run')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const session = await import('../../src/main/project/session')
const { S1, clipsOf, firstTimeline } = await import('../project-helpers')

/**
 * Audit 2026-10-01: a joined export's frames each last exactly one frame. Its
 * pieces are kept in Matroska, which counts time in whole milliseconds, so at
 * 30 fps the frames came out 33 and 34 ms by turns, and some editors called
 * the file variable frame rate.
 */

const fx = fixtureSet('timing-e2e')
const work = await mkdtemp(join(tmpdir(), 'editbay-timing-'))
afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

describe('a joined export', () => {
  it('gives every frame the same length', async () => {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    session.addAsset(red)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    session.applyEdit({ sequenceId: S1, kind: 'split', clipId: 'r', frame: 45 })
    expect(clipsOf(session.getProject())).toHaveLength(2)
    const project = session.getProject()
    const scratch = join(work, 'scratch')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: { ...exportNames(project, S1), joined: 'timing' },
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: join(work, 'out'),
      scratchDir: scratch,
      filenamePattern: '{project}'
    })
    const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
    const text = await runFfprobe(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,dts_time', '-of', 'csv=p=0', out!])
    const rows = text.trim().split(/\r?\n/)
    const times = rows.map((r) => Number(r.split(',')[0])).sort((a, b) => a - b)
    const steps = new Set(times.slice(1).map((t, i) => Math.round((t - times[i]!) * 1e5)))
    expect([...steps]).toEqual([Math.round(1e5 / 30)])
  })
})
