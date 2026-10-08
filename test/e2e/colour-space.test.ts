import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-colour-space-cache-'))
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
 * Audit 2026-10-01: a recording whose file says its colours are by BT.601,
 * as an older OBS setup records, exported in the colours it shows, not
 * shifted by being read as BT.709.
 */

const work = await mkdtemp(join(tmpdir(), 'editbay-colour-space-'))
afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/** Two seconds of one colour, made into video by BT.601 and saying so. */
async function bt601(): Promise<string> {
  const file = join(work, 'bt601.mp4')
  await capture(ffmpegPath, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0xC86432:s=640x360:r=30:d=2',
    '-vf', 'scale=out_color_matrix=bt601:out_range=tv,format=yuv420p',
    '-colorspace', 'smpte170m', '-color_primaries', 'smpte170m', '-color_trc', 'smpte170m',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '4', file
  ])
  return file
}

/** The colour in the middle of a frame, read as the file says to read it. */
async function middle(file: string): Promise<number[]> {
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'crop=4:4:(iw-4)/2:(ih-4)/2,format=rgb24', '-f', 'rawvideo', 'pipe:1'])
  return [stdout[0]!, stdout[1]!, stdout[2]!]
}

describe('a recording made by BT.601', () => {
  it('is exported in the colours it shows', async () => {
    const source = await bt601()
    const asset = await importFile(source, ...quiet())
    expect(asset.bt601).toBe(true)
    session.resetProject()
    session.addAsset(asset)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'c' })
    const project = session.getProject()
    const scratch = join(work, 'scratch')
    const plan = planRender({
      timeline: firstTimeline(project),
      names: { ...exportNames(project, S1), joined: 'bt601' },
      preset: presetById('vertical'),
      mode: 'join',
      outputDir: join(work, 'out'),
      scratchDir: scratch,
      filenamePattern: '{project}'
    })
    const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
    const shown = await middle(source)
    const written = await middle(out!)
    // The source as a player shows it is the colour it was made from.
    expect(Math.max(...shown.map((v, i) => Math.abs(v - [200, 100, 50][i]!)))).toBeLessThanOrEqual(4)
    expect(Math.max(...written.map((v, i) => Math.abs(v - shown[i]!)))).toBeLessThanOrEqual(4)
  })
})
