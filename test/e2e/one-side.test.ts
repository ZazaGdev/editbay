import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-one-side-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { importFile } = await import('../../src/main/media/import')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const { soundPcm } = await import('../../src/main/sound-pcm')
const session = await import('../../src/main/project/session')
const { S1, firstTimeline } = await import('../project-helpers')

/**
 * Task 1188: a voice recorded on the left side only, played on both. The
 * export and the preview's sound engine both put the left channel in both
 * ears when the clip asks for it, and leave the right silent when it does not.
 */

const work = await mkdtemp(join(tmpdir(), 'editbay-one-side-'))
afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/**
 * How loud each side is, in dB RMS; silence reads as -inf. RMS rather than
 * the peak, which AAC moves by more than a decibel on a tone in one ear.
 */
async function levels(file: string): Promise<number[]> {
  const { stderr } = await capture(ffmpegPath, ['-hide_banner', '-i', file, '-map', '0:a:0', '-af', 'astats=measure_overall=none:measure_perchannel=RMS_level', '-f', 'null', '-'])
  return [...stderr.toString().matchAll(/RMS level dB: (-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -Infinity : Number(m[1])))
}

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

describe('a voice on the left side only', () => {
  it('is exported on both sides when its clip asks, and on the left alone when it does not', async () => {
    // Two seconds of a 440 Hz tone on the left, silence on the right.
    const file = join(work, 'left.wav')
    await capture(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-af', 'pan=stereo|c0=c0|c1=0*c0', '-c:a', 'pcm_s16le', file])
    session.resetProject()
    const asset = await importFile(file, ...quiet())
    session.addAsset(asset)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'voice' })

    const [left, right] = await levels(await exported('as-recorded'))
    expect(left!).toBeGreaterThan(-25)
    expect(right!).toBeLessThan(-60)

    // As an edit list leaves it: the clip asks for its left side on both.
    const p = session.getProject()
    session.setProject({
      ...p,
      sequences: p.sequences.map((s) => ({ ...s, audioTracks: s.audioTracks.map((r) => ({ ...r, clips: r.clips.map((c) => ({ ...c, channel: 'left' as const })) })) }))
    })
    const [l2, r2] = await levels(await exported('left-on-both'))
    expect(Math.abs(l2! - left!)).toBeLessThan(0.5)
    expect(Math.abs(r2! - left!)).toBeLessThan(0.5)
  })

  it("is decoded for the preview's sound engine on both sides when asked", async () => {
    const m = session.getProject().media[0]!
    const loudest = (pcm: Float32Array, side: 0 | 1): number => {
      let most = 0
      for (let i = side; i < pcm.length; i += 2) most = Math.max(most, Math.abs(pcm[i]!))
      return most
    }
    const plain = (await soundPcm(m, { mediaId: m.id, track: 0, denoise: false, fromSec: 0.5, frames: 4800, rate: 48000 }))!
    expect(loudest(plain, 1)).toBeLessThan(0.001)
    const both = (await soundPcm(m, { mediaId: m.id, track: 0, denoise: false, side: 'left', fromSec: 0.5, frames: 4800, rate: 48000 }))!
    expect(loudest(both, 0)).toBeGreaterThan(0.05)
    expect(loudest(both, 1)).toBeCloseTo(loudest(both, 0), 6)
  })
})
