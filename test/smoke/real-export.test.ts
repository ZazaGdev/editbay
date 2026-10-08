import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A whole export, end to end, over real footage.
 *
 * The automated export tests use synthetic fixtures, which are small, clean and
 * nothing like a screen recording. This cuts and reframes the files listed in
 * test/smoke/media.local.txt and checks what actually comes out.
 *
 * Skips when no footage is configured. See real-footage.test.ts for the format.
 */

const LIST_FILE = join(process.cwd(), 'test', 'smoke', 'media.local.txt')

function mediaPaths(): string[] {
  const fromEnv = process.env.EDITBAY_SMOKE_MEDIA ?? ''
  const fromFile = existsSync(LIST_FILE) ? readFileSync(LIST_FILE, 'utf8') : ''
  return [...fromEnv.split(';'), ...fromFile.split(/\r?\n/)]
    .map((s) => s.trim())
    .filter((s) => s !== '' && !s.startsWith('#'))
}

const paths = mediaPaths()
const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-realexport-cache-'))
vi.mock('electron', () => ({ app: { getPath: (): string => cacheRoot } }))

const { importFile } = await import('../../src/main/media/import')
const { runFfprobe } = await import('../../src/main/ffmpeg/run')
const { planRender, exportNames, parseLoudnorm } = await import('../../src/shared/render-plan')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const session = await import('../../src/main/project/session')
const { S1, clipsOf, firstTimeline } = await import('../project-helpers')
const { timelineDuration } = await import('../../src/shared/project')
const { largestRectOfAspect } = await import('../../src/shared/crop-geometry')

const work = await mkdtemp(join(tmpdir(), 'editbay-realexport-'))

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
})

/**
 * How loud a file is overall, in LUFS, or null when there is nothing to
 * measure: digital silence, or no audio stream at all.
 *
 * Silence reads as `-inf LUFS`, which is not a number and which
 * `parseLoudnorm` therefore refuses. That is the honest answer for a screen
 * recording made with nothing routed to its microphone, and several of the
 * ones this suite is pointed at are exactly that, so it is a result rather
 * than a failure.
 */
async function integrated(path: string): Promise<number | null> {
  try {
    const { stderr } = await capture(ffmpegPath, [
      '-hide_banner', '-i', path, '-map', '0:a:0',
      '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json',
      '-f', 'null', '-'
    ])
    return parseLoudnorm(stderr.toString())?.i ?? null
  } catch {
    // No audio stream at all to map, which some screen recordings have. The
    // same answer as silence: there is no level here.
    return null
  }
}

async function countFrames(path: string): Promise<number> {
  const out = await runFfprobe([
    '-v', 'error',
    '-select_streams', 'v:0',
    '-count_frames',
    '-show_entries', 'stream=nb_read_frames',
    '-of', 'csv=p=0',
    path
  ])
  return Number(out.trim())
}

async function shape(path: string): Promise<{ width: number; height: number; fps: number; hasAudio: boolean }> {
  const v = await runFfprobe([
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', path
  ])
  const a = await runFfprobe([
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', path
  ])
  const [w, h, rate] = v.trim().split(',')
  const [num, den] = (rate ?? '0/1').split('/')
  return {
    width: Number(w),
    height: Number(h),
    fps: Number(num) / Number(den ?? 1),
    hasAudio: a.trim() !== ''
  }
}

describe.skipIf(paths.length === 0)('exporting real footage', () => {
  it('cuts, reframes and exports a vertical video from real recordings', async () => {
    session.resetProject()

    // Two seconds of each source, so the test stays quick while still crossing
    // a real cut between two genuinely different recordings.
    const twoSeconds = 60
    const sources = paths.slice(0, 3)
    for (const path of sources) {
      const asset = await importFile(path, () => {}, () => {})
      expect(asset.status, `${path} failed to import: ${asset.error ?? ''}`).toBe('ready')
      session.addAsset(asset)
      session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: `clip-${clipsOf(session.getProject()).length + 1}` })

      const project = session.getProject()
      const clip = clipsOf(project)[clipsOf(project).length - 1]!
      session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: clip.id, frame: Math.min(clip.sourceOut, twoSeconds) })

      // Reframe it the way the app would: the largest 9:16 slice, centred.
      session.applyEdit({
        sequenceId: S1,
        kind: 'setCrop',
        clipId: clip.id,
        rect: largestRectOfAspect(asset.width, asset.height, 1080 / 1920)
      })
    }

    const project = session.getProject()
    expect(clipsOf(project).length).toBeGreaterThanOrEqual(2)
    const expectedFrames = timelineDuration(firstTimeline(project))

    const outputDir = join(work, 'out')
    const scratchDir = join(work, 'scratch')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: exportNames(project, S1),
      preset: presetById('vertical'),
      mode: 'join',
      outputDir,
      scratchDir,
      filenamePattern: '{project}_{index}_{clip}'
    })

    const stages: string[] = []
    const [output] = await runExport({
      plan,
      fps: project.fps,
      scratchDir,
      onProgress: (p) => stages.push(p.stage)
    })

    expect(output).toBeTruthy()
    expect(stages.at(-1)).toBe('done')
    expect(existsSync(scratchDir)).toBe(false)

    const info = await shape(output!)
    expect(info.width).toBe(1080)
    expect(info.height).toBe(1920)
    expect(info.fps).toBeCloseTo(project.fps, 1)
    // Real recordings vary: some have sound, some do not. The deliverable must
    // have a track either way, or the join has silently dropped one.
    expect(info.hasAudio).toBe(true)

    // The whole point of the two stage render: the file is exactly as long as
    // the sum of its parts, across real sources of different sizes and rates.
    expect(await countFrames(output!)).toBe(expectedFrames)
    expect((await stat(output!)).size).toBeGreaterThan(10_000)

    // Levelled on the way out, whatever the microphone was set to that day.
    // A range rather than a figure: loudnorm falls back to its dynamic mode when one
    // gain would clip, and that still lands near the target.
    //
    // The floor sits 2 dB under the -14 target, not 1, because this export is only
    // a few seconds long and mostly gaps. On that, the dynamic mode has no time to
    // settle and two real OBS recordings came out at -15.0 and -15.6, while the same
    // two exported whole (25 s) came out at -14.3. Loud is the side worth guarding
    // tightly, so the ceiling stays 1 dB over.
    //
    // Silence in is silence out, and a screen recording with nothing routed to
    // its microphone is silent. There is no level to check on one of those, so
    // the check is skipped and said to be skipped, rather than failing for a
    // reason that has nothing to do with the export. A soundtrack lost by the
    // export is still caught: that would be silence out of sources that were
    // not, and `hasAudio` above catches a track dropped entirely.
    const lufs = await integrated(output!)
    if (lufs === null) {
      const levels = await Promise.all(sources.map(integrated))
      expect(levels.every((l) => l === null), 'the export is silent but its sources are not').toBe(true)
      console.log('  every source is silent, so there was no level to check')
    } else {
      expect(lufs).toBeGreaterThan(-16)
      expect(lufs).toBeLessThan(-13)
    }

    console.log(
      `  exported ${clipsOf(project).length} real clips -> ${info.width}x${info.height}, ` +
        `${expectedFrames} frames, ${(((await stat(output!)).size / 1024 / 1024) || 0).toFixed(1)}MB, ` +
        `${lufs === null ? 'silent' : `${lufs.toFixed(1)} LUFS`}`
    )
  }, 600_000)

  it('writes one file per clip when asked', async () => {
    session.resetProject()
    for (const path of paths.slice(0, 2)) {
      const asset = await importFile(path, () => {}, () => {})
      session.addAsset(asset)
      session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: `clip-${clipsOf(session.getProject()).length + 1}` })
      const project = session.getProject()
      const clip = clipsOf(project)[clipsOf(project).length - 1]!
      session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: clip.id, frame: Math.min(clip.sourceOut, 30) })
    }

    const project = session.getProject()
    const outputDir = join(work, 'batch')
    const scratchDir = join(work, 'batch-scratch')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: exportNames(project, S1),
      preset: presetById('vertical'),
      mode: 'batch',
      outputDir,
      scratchDir,
      filenamePattern: '{project}_{index}_{clip}'
    })

    const outputs = await runExport({ plan, fps: project.fps, scratchDir, onProgress: () => {} })
    expect(outputs).toHaveLength(clipsOf(project).length)
    for (const o of outputs) {
      const info = await shape(o)
      expect(info.width).toBe(1080)
      expect(info.height).toBe(1920)
      expect(info.hasAudio).toBe(true)
    }
  }, 600_000)
})
