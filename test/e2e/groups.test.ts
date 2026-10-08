import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-groups-cache-'))
vi.mock('electron', () => ({ app: { getPath: (): string => cacheRoot } }))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const session = await import('../../src/main/project/session')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { S1, firstTimeline } = await import('../project-helpers')

/**
 * Plan 80: a Simple zoom on a group of two pieces exports as the same zoom
 * on one clip of the same footage does: the pieces' own keyframes, which lie
 * partly outside each piece, give the export the group's one move, with no
 * jump at the cut.
 */

const fx = fixtureSet('groups')
const work = await mkdtemp(join(tmpdir(), 'editbay-groups-'))
const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

const START = { x: 0, y: 0, w: 202, h: 360 }
const END = { x: 300, y: 90, w: 100, h: 178 }

/** Frames 0 to 60 of the test picture, zoomed from START to END, as one clip, or split at 30 and grouped. */
async function exported(grouped: boolean): Promise<string> {
  session.resetProject()
  const clip = await importFile(await fx.cleanClip(), ...quiet())
  session.addAsset(clip)
  session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: clip.id, clipId: 'a' })
  session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: 'a', frame: 60 })
  if (grouped) {
    session.applyEdit({ sequenceId: S1, kind: 'split', clipId: 'a', frame: 30 })
    const ids = firstTimeline(session.getProject()).videoTracks[0]!.clips.map((c) => c.id)
    session.applyEdit({ sequenceId: S1, kind: 'groupClips', clipIds: ids, groupId: 'g' })
  }
  session.applyEdit({ sequenceId: S1, kind: 'useSimpleZoom', clipId: 'a' })
  session.applyEdit({ sequenceId: S1, kind: 'setSimpleZoom', clipId: 'a', change: { start: START, end: END, ease: 'linear' } })
  const project = session.getProject()
  const name = grouped ? 'grouped' : 'whole'
  const scratch = join(work, `scratch-${name}`)
  const plan = planRender({
    timeline: firstTimeline(project),
    names: exportNames(project, S1),
    preset: presetById('vertical'),
    mode: 'join',
    outputDir: join(work, name),
    scratchDir: scratch,
    filenamePattern: '{project}'
  })
  const [out] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
  return out!
}

async function frameAt(path: string, n: number): Promise<Buffer> {
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', path, '-vf', `select='eq(n,${n})',scale=108:192`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
  return stdout
}

describe('a group of pieces, exported', () => {
  it('zooms as one clip of the same footage does, with no jump at the cut', async () => {
    const grouped = await exported(true)
    const pieces = firstTimeline(session.getProject()).videoTracks[0]!.clips
    expect(pieces.map((c) => c.group)).toEqual(['g', 'g'])
    const whole = await exported(false)
    for (const f of [5, 29, 30, 31, 55]) {
      const a = await frameAt(grouped, f)
      const b = await frameAt(whole, f)
      expect(a.length).toBe(b.length)
      let off = 0
      for (let i = 0; i < a.length; i++) off += Math.abs(a[i]! - b[i]!)
      // The same picture, give or take the encoder: on average a few levels a channel.
      expect(off / a.length, `frame ${f}`).toBeLessThan(6)
    }
  }, 240_000)
})
