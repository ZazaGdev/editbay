import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-overlay-colour-cache-'))
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
 * Audit 2026-10-08: a recording whose file says nothing about its colours, as
 * many screen captures and downloads do, is read as BT.709 on every track. On
 * V2 it was read as BT.601, so a picture in picture of the same recording
 * came out a different red than the same red on V1 beside it.
 */

const work = await mkdtemp(join(tmpdir(), 'editbay-overlay-colour-'))
afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

/** Three seconds of a strong red, made into video by BT.709 and not saying so. */
async function untagged(): Promise<string> {
  const file = join(work, 'untagged.mp4')
  await capture(ffmpegPath, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0xE02020:s=1280x720:r=30:d=3',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=unknown',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '4', file
  ])
  return file
}

/** The colour of a small square of a frame one second in. */
async function at(file: string, x: number, y: number): Promise<number[]> {
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', `crop=4:4:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  return [stdout[0]!, stdout[1]!, stdout[2]!]
}

describe('a recording that says nothing of its colours', () => {
  it('exports the same colour on V2 as on V1', async () => {
    const asset = await importFile(await untagged(), ...quiet())
    session.resetProject()
    session.addAsset(asset)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'base' })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' } as never)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'over', at: 0, onTrack: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'setPlace', clipId: 'over', picture: 'main', place: { x: 0, y: 0, w: 0.5, h: 0.5 }, reshapeCrop: false } as never)
    const project = session.getProject()
    const t = firstTimeline(project)
    const scratch = join(work, 'scratch')
    const plan = planRender({
      timeline: t,
      names: { ...exportNames(project, S1), joined: 'overlay' },
      preset: presetById(t.presetId),
      mode: 'join',
      outputDir: join(work, 'out'),
      scratchDir: scratch,
      filenamePattern: '{project}'
    })
    const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
    // V2 in the top left quarter, V1 alone below it.
    const v2 = await at(out!, 100, 100)
    const v1 = await at(out!, 800, 1600)
    expect(Math.max(...v2.map((v, i) => Math.abs(v - v1[i]!)))).toBeLessThanOrEqual(4)
  })
})
