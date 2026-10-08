import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-layers-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile } = await import('../../src/main/media/import')
const { runFfprobe } = await import('../../src/main/ffmpeg/run')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { planRender, exportNames } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const session = await import('../../src/main/project/session')
const { timelineDuration } = await import('../../src/shared/project')
const { S1, clipsOf, firstTimeline } = await import('../project-helpers')

/**
 * Layers through the real pipeline, on a file shaped like the owner's OBS
 * recordings: the left 1920 of the canvas solid red, the right solid blue. An
 * exported Split is read back pixel by pixel, which is the only way to know
 * each view ended up where the layout says.
 */

const fx = fixtureSet('layers-e2e')
const work = await mkdtemp(join(tmpdir(), 'editbay-layers-'))

afterAll(async () => {
  await rm(cacheRoot, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await fx.cleanup()
})

const quiet = (): [() => void, () => void] => [(): void => {}, (): void => {}]

async function countFrames(path: string): Promise<number> {
  const out = await runFfprobe([
    '-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path
  ])
  return Number(out.trim())
}

async function size(path: string): Promise<[number, number]> {
  const out = await runFfprobe(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path])
  const [w, h] = out.trim().split(',')
  return [Number(w), Number(h)]
}

type Colour = 'red' | 'blue' | 'black' | 'other'

/** The colour of one pixel of a frame, a second in unless `atStart`, as H.264 leaves it. */
async function colourAt(path: string, x: number, y: number, atStart = false): Promise<Colour> {
  const { stdout } = await capture(ffmpegPath, [
    '-v', 'error', ...(atStart ? [] : ['-ss', '1']), '-i', path, '-frames:v', '1',
    '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'
  ])
  const [r = 0, g = 0, b = 0] = stdout
  if (r > 180 && g < 70 && b < 70) return 'red'
  if (b > 180 && r < 70 && g < 70) return 'blue'
  if (r < 30 && g < 30 && b < 30) return 'black'
  return 'other'
}

async function exportJoined(name: string): Promise<string> {
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
  const [output] = await runExport({ plan, fps: project.fps, scratchDir: scratch, onProgress: () => {} })
  return output!
}

describe('an OBS-shaped recording', () => {
  it('imports as it is, counting its two audio tracks', async () => {
    session.resetProject()
    const asset = await importFile(await fx.obsClip(), ...quiet())
    expect(asset.status).toBe('ready')
    expect(asset.conformed).toBe(false)
    expect([asset.width, asset.height]).toEqual([3840, 1080])
    expect(asset.audioTracks).toBe(2)
    session.addAsset(asset)
    expect(session.getProject().media[0]!.audioTracks).toBe(2)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'obs' })
  })

  it('exports Split with the left view on top and the right view below', async () => {
    const clip = clipsOf(session.getProject())[0]!
    session.applyEdit({ sequenceId: S1, kind: 'applyLayout', clipId: clip.id, layout: 'split' })
    const expected = timelineDuration(firstTimeline(session.getProject()))

    const out = await exportJoined('split')
    expect(await size(out)).toEqual([1080, 1920])
    expect(await countFrames(out)).toBe(expected)
    expect(await colourAt(out, 540, 480)).toBe('red')
    expect(await colourAt(out, 540, 1440)).toBe('blue')
  })

  it('exports the other way round after Swap', async () => {
    const clip = clipsOf(session.getProject())[0]!
    session.applyEdit({ sequenceId: S1, kind: 'swapPictures', clipId: clip.id })
    const out = await exportJoined('swapped')
    expect(await colourAt(out, 540, 480)).toBe('blue')
    expect(await colourAt(out, 540, 1440)).toBe('red')
  })

  it('exports Picture in picture with the right view in the top right box', async () => {
    const clip = clipsOf(session.getProject())[0]!
    session.applyEdit({ sequenceId: S1, kind: 'applyLayout', clipId: clip.id, layout: 'pip' })
    const out = await exportJoined('pip')
    // Inside the box, a third of the width, touching the top right corner.
    expect(await colourAt(out, 900, 60)).toBe('blue')
    // Everywhere else, the main picture from the left view.
    expect(await colourAt(out, 200, 1000)).toBe('red')
  })
})

describe('a source whose frames do not line up with the project rate', () => {
  it('starts on a picture, not a black frame, and keeps every frame', async () => {
    // At 25 fps against a 30 fps project, a cut three frames in puts the first
    // source frame later than the segment's first timestamp. A black frame made
    // separately in the graph used to fill that gap and push the last frame out.
    session.resetProject()
    const asset = await importFile(await fx.obsClip(25), ...quiet())
    expect(asset.status).toBe('ready')
    session.addAsset(asset)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'obs25' })
    const clip = clipsOf(session.getProject())[0]!
    session.applyEdit({ sequenceId: S1, kind: 'applyLayout', clipId: clip.id, layout: 'split' })
    // I on V1 three frames in: the clip keeps its start, so the file starts three frames into it.
    session.applyEdit({ sequenceId: S1, kind: 'trimToFrame', clipId: clip.id, edge: 'start', frame: 3 })
    expect(clipsOf(session.getProject()).map((c) => [c.timelineStart, c.sourceIn])).toEqual([[0, 3]])
    const expected = timelineDuration(firstTimeline(session.getProject()))

    const out = await exportJoined('rate25')
    expect(await countFrames(out)).toBe(expected)
    expect(await colourAt(out, 540, 480, true)).toBe('red')
    expect(await colourAt(out, 540, 1440, true)).toBe('blue')
  })
})
