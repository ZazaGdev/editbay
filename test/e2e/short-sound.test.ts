import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-short-sound-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { importFile } = await import('../../src/main/media/import')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { runFfprobe } = await import('../../src/main/ffmpeg/run')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const session = await import('../../src/main/project/session')
const { S1, firstTimeline } = await import('../project-helpers')

/**
 * A recording whose sound stops before its picture does, as a camera's often
 * does by a fraction of a second, cut next to another clip and exported
 * joined. Each piece is as long as its picture, so its sound must be too:
 * a piece whose sound runs short leaves a hole in the joined file's sound,
 * and players that play the samples back to back put everything after it early.
 */

const work = await mkdtemp(join(tmpdir(), 'editbay-short-sound-'))

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

async function clip(name: string, soundSec: number): Promise<string> {
  const out = join(work, name)
  await capture(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2',
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${soundSec}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', out
  ])
  return out
}

/** How long the sound lasts once decoded, sample by sample: what a player that plays them back to back hears. */
async function decodedSoundSec(path: string): Promise<number> {
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', path, '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', '48000', 'pipe:1'])
  return stdout.length / 2 / 48000
}

async function videoSec(path: string): Promise<number> {
  return Number((await runFfprobe(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', path])).trim())
}

describe('a clip whose sound ends before its picture', () => {
  it('leaves silence in the joined export, not a hole that pulls what follows early', async () => {
    session.resetProject()
    const short = await importFile(await clip('short.mp4', 1.5), ...quiet())
    const whole = await importFile(await clip('whole.mp4', 2), ...quiet())
    session.addAsset(short)
    session.addAsset(whole)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: short.id, clipId: 'a' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: whole.id, clipId: 'b' })

    const project = session.getProject()
    const scratch = join(work, 'scratch')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: { ...exportNames(project, S1), joined: 'joined' },
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: join(work, 'out'),
      scratchDir: scratch,
      filenamePattern: '{project}'
    })
    const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })

    const picture = await videoSec(out!)
    expect(picture).toBeCloseTo(4, 1)
    // Within two AAC frames: the encoder's own priming and padding, not a hole.
    expect(Math.abs((await decodedSoundSec(out!)) - picture)).toBeLessThan(0.045)
  })
})
