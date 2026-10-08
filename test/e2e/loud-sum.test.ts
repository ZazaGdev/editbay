import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-loud-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { importFile } = await import('../../src/main/media/import')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const session = await import('../../src/main/project/session')
const { S1, firstTimeline } = await import('../project-helpers')

/**
 * Audit 2026-10-01: two loud sounds that add up past full scale are kept in
 * floating point until the levelling brings them down, rather than clipped to
 * 16 bits first and left flat topped however far they are turned down.
 */

const work = await mkdtemp(join(tmpdir(), 'editbay-loud-'))
afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/** How far the loudest sample stands above the average, which clipping brings down. */
async function crestFactor(file: string): Promise<number> {
  const { stderr } = await capture(ffmpegPath, ['-hide_banner', '-i', file, '-map', '0:a:0', '-af', 'astats', '-f', 'null', '-'])
  return Number(stderr.toString().match(/Crest factor: ([\d.]+)/)?.[1] ?? 'NaN')
}

describe('two loud sounds at once', () => {
  it('are levelled without the clipping their sum would have', async () => {
    const tone = join(work, 'loud.wav')
    // A 220 Hz tone at -1 dB, two of them at once: their sum peaks 5 dB over full scale.
    await capture(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=2', '-af', 'volume=17dB,pan=stereo|c0=c0|c1=c0', '-c:a', 'pcm_f32le', tone])
    session.resetProject()
    const asset = await importFile(tone, ...quiet())
    session.addAsset(asset)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'a' })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'audio', trackId: 'A2' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'b', at: 0, onTrack: 'A2' })
    const project = session.getProject()
    const scratch = join(work, 'scratch')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: { ...exportNames(project, S1), joined: 'loud' },
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: join(work, 'out'),
      scratchDir: scratch,
      filenamePattern: '{project}'
    })
    expect(plan.loudness).not.toBeNull()
    const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
    // A sine's crest factor is 1.41; clipped flat, it falls towards 1.
    expect(await crestFactor(out!)).toBeGreaterThan(1.38)
  })
})
