import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-ducking-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { decodePeaks } = await import('../../src/main/media/waveform')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const { peaksKey } = await import('../../src/shared/sound')
const { DUCK_DB } = await import('../../src/shared/ducking')
const session = await import('../../src/main/project/session')
const { S1, firstTimeline } = await import('../project-helpers')

/**
 * Plan 50 through the real pipeline: a voice that talks from 2 s to 4 s on A1
 * and a steady tone on A2, which ducks. The export's music is measured on its
 * own, by its pitch, clear of the voice and in the middle of it.
 */

const fx = fixtureSet('ducking-e2e')
const work = await mkdtemp(join(tmpdir(), 'editbay-ducking-'))

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/** How loud the 440 Hz music is over a stretch of a file, in dB, with the 1 kHz voice filtered out. */
async function musicDb(path: string, fromSec: number, forSec: number): Promise<number> {
  const { stderr } = await capture(ffmpegPath, [
    '-hide_banner', '-ss', fromSec.toFixed(3), '-t', forSec.toFixed(3), '-i', path,
    '-vn', '-af', 'bandpass=f=440:width_type=q:w=8,bandpass=f=440:width_type=q:w=8,astats=metadata=0:reset=0', '-f', 'null', '-'
  ])
  const found = stderr.match(/Overall[\s\S]*?RMS level dB:\s*(-?[\d.]+)/)
  return Number(found?.[1])
}

describe('a track that ducks under the voice', () => {
  it('comes down by the duck in the middle of the voice, and is back up clear of it', async () => {
    session.resetProject()
    const voice = await importFile(await fx.voiceWav(), ...quiet())
    const music = await importFile(await fx.toneWav(), ...quiet())
    session.addAsset(voice)
    session.addAsset(music)
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'audio', trackId: 'A2' })
    const a1 = firstTimeline(session.getProject()).audioTracks[0]!.id
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: voice.id, clipId: 'v', at: 0, onTrack: a1 })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: music.id, clipId: 'm', at: 0, onTrack: 'A2' })
    session.applyEdit({ sequenceId: S1, kind: 'setTrackDuck', trackId: 'A2', duck: true })

    const project = session.getProject()
    const peaks = new Map([[peaksKey(voice.id, 0), decodePeaks(await readFile(voice.peaksPath))]])
    const scratch = join(work, 'scratch')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: { ...exportNames(project, S1), joined: 'ducked' },
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: join(work, 'out'),
      scratchDir: scratch,
      filenamePattern: '{project}',
      peaks
    })
    const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })

    const clear = await musicDb(out!, 0.3, 1)
    const under = await musicDb(out!, 2.5, 1)
    const after = await musicDb(out!, 4.9, 0.8)
    expect(clear - under).toBeGreaterThan(-DUCK_DB - 1.5)
    expect(clear - under).toBeLessThan(-DUCK_DB + 1.5)
    expect(Math.abs(clear - after)).toBeLessThan(1)
  })

  it('is taken by ffmpeg with four hundred stretches of voice in one segment, where a chain of them was refused past ninety', async () => {
    const { duckExpression } = await import('../../src/shared/ducking')
    const many = Array.from({ length: 400 }, (_, i) => ({ from: i * 60, to: i * 60 + 30 }))
    const e = duckExpression(many, 30, 0, 800)!
    await capture(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1', '-af', `volume=eval=frame:volume='${e}'`, '-f', 'null', '-'])
  })
})
