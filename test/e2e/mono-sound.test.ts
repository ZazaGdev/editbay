import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-mono-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { importFile } = await import('../../src/main/media/import')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const { makeTrackCopies } = await import('../../src/main/media/tracks')
const session = await import('../../src/main/project/session')
const { S1, firstTimeline } = await import('../project-helpers')

/**
 * Audit 2026-10-01: a mono recording, as every voice-over take is, plays at
 * its own level on both sides in the preview, and has to in the export and in
 * every copy the app makes of it too. ffmpeg's own way put it 3 dB down.
 */

const work = await mkdtemp(join(tmpdir(), 'editbay-mono-'))
afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/** A two second 440 Hz tone at -18 dB, in one channel or two. */
async function tone(name: string, channels: 1 | 2): Promise<string> {
  const file = join(work, name)
  // Two channels by copying the one, not by ffmpeg's own mixing, which would put each 3 dB down.
  const two = channels === 2 ? ['-af', 'pan=stereo|c0=c0|c1=c0'] : []
  await capture(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', ...two, '-c:a', 'pcm_s16le', file])
  return file
}

/** The loudest sample on each side, in dB. */
async function peaks(file: string): Promise<number[]> {
  const { stderr } = await capture(ffmpegPath, ['-hide_banner', '-i', file, '-map', '0:a:0', '-af', 'astats=measure_overall=none:measure_perchannel=Peak_level', '-f', 'null', '-'])
  return [...stderr.toString().matchAll(/Peak level dB: (-?[\d.]+)/g)].map((m) => Number(m[1]))
}

/** The sequence exported with its sound as it is, not levelled, so a level can be read back. */
async function exported(name: string): Promise<string> {
  const project = session.getProject()
  const scratch = join(work, `scratch-${name}`)
  const plan = planRender({
    timeline: firstTimeline(project),
    names: { ...exportNames(project, S1), joined: name },
    preset: presetById('vertical'),
    mode: 'join',
    outputDir: join(work, 'out'),
    scratchDir: scratch,
    filenamePattern: '{project}'
  })
  const [out] = await runExport({ plan: { ...plan, loudness: null }, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
  return out!
}

describe('a mono recording', () => {
  it('is exported at its own level on both sides, as a stereo one of the same level is', async () => {
    const levels: number[][] = []
    for (const channels of [1, 2] as const) {
      session.resetProject()
      const asset = await importFile(await tone(`tone-${channels}.wav`, channels), ...quiet())
      expect(asset.trackChannels).toEqual([channels])
      session.addAsset(asset)
      session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'tone' })
      levels.push(await peaks(await exported(`tone-${channels}`)))
    }
    const [mono, stereo] = levels
    expect(mono).toHaveLength(2)
    for (let side = 0; side < 2; side++) expect(Math.abs(mono![side]! - stereo![side]!)).toBeLessThan(0.3)
  })

  it('keeps its level in a copy of it, which the preview and cleaning read', async () => {
    const source = await tone('copy-source.wav', 1)
    const copy = join(work, 'copy.m4a')
    await makeTrackCopies(source, [{ index: 0, path: copy, peaksPath: join(work, 'copy.peaks'), channels: 1 }], 2)
    const [left, right] = await peaks(copy)
    const [own] = await peaks(source)
    expect(Math.abs(left! - own!)).toBeLessThan(0.5)
    expect(Math.abs(right! - own!)).toBeLessThan(0.5)
  })
})
