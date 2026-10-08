import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-pictures-cache-'))
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
const { cornerPlace, findVideoClip, timelineDuration } = await import('../../src/shared/project')
const { spanEnd } = await import('../../src/shared/tracks')
const { S1, clipsOf, firstTimeline } = await import('../project-helpers')

/**
 * Pictures on a video row through the real pipeline: a solid green clip at
 * 25 fps laid in the corner over solid red V1 clips at 30 fps, read back
 * pixel by pixel. 25 against 30 is what leaves a picture missing from a
 * segment's first frame unless its first frame is put at the start.
 */

const fx = fixtureSet('pictures-e2e')
const work = await mkdtemp(join(tmpdir(), 'editbay-pictures-'))

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

type Colour = 'red' | 'green' | 'black' | 'grey' | 'other'

/** The colour of one pixel of the frame at `atSec`, as H.264 leaves it. */
async function colourAt(path: string, x: number, y: number, atSec: number): Promise<Colour> {
  const { stdout } = await capture(ffmpegPath, [
    '-v', 'error', '-ss', atSec.toFixed(3), '-i', path, '-frames:v', '1',
    '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'
  ])
  const [r = 0, g = 0, b = 0] = stdout
  if (r > 180 && g < 70 && b < 70) return 'red'
  if (g > 100 && r < 70 && b < 70) return 'green'
  if (r < 40 && g < 40 && b < 40) return 'black'
  // What black and white leaves of a colour: the same in all three, and not black.
  if (Math.max(r, g, b) - Math.min(r, g, b) <= 6) return 'grey'
  return 'other'
}

/** When the beep starts, after the silence before it, in seconds. */
async function beepAt(path: string): Promise<number> {
  const { stderr } = await capture(ffmpegPath, [
    '-hide_banner', '-i', path, '-map', '0:a:0', '-af', 'silencedetect=n=-40dB:d=0.05', '-f', 'null', '-'
  ])
  const m = stderr.toString().match(/silence_end: ([\d.]+)/)
  if (!m?.[1]) throw new Error(`no sound found in ${path}`)
  return Number(m[1])
}

/** The loudest the sound gets from one time to another, in dB. */
async function loudestBetween(path: string, fromSec: number, toSec: number): Promise<number> {
  const { stderr } = await capture(ffmpegPath, [
    '-hide_banner', '-i', path, '-map', '0:a:0', '-af', `atrim=start=${fromSec}:end=${toSec},volumedetect`, '-f', 'null', '-'
  ])
  const m = stderr.toString().match(/max_volume: (-?[\d.]+|-inf) dB/)
  return m?.[1] === '-inf' || !m?.[1] ? -Infinity : Number(m[1])
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

/** Inside the corner box, a third of the frame wide in the top right, and well away from it. */
const IN_CORNER = [1000, 40] as const
const AWAY = [300, 1200] as const

describe('a picture on a video row', () => {
  it('shows in the corner while it is over V1, and not before', async () => {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    const green = await importFile(await fx.greenClip(), ...quiet())
    session.addAsset(red)
    session.addAsset(green)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r1' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r2' })
    // One second of green, from 1 s to 2 s, in the corner box, dropped from the bin onto V2.
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: green.id, clipId: 'g', at: 30, onTrack: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: 'g', frame: 30 })
    const t = firstTimeline(session.getProject())
    const g = findVideoClip(t, 'g')!.clip
    expect(findVideoClip(t, 'g')!.track.id).toBe('V2')
    const m = t.media.find((x) => x.id === green.id)!
    session.applyEdit({ sequenceId: S1, kind: 'setPlace', clipId: 'g', picture: 'main', place: cornerPlace(m, g.transform.crop, 1080, 1920), reshapeCrop: true })

    const out = await exportJoined('corner')
    expect(await countFrames(out)).toBe(timelineDuration(firstTimeline(session.getProject())))
    expect(await colourAt(out, ...IN_CORNER, 1.5)).toBe('green')
    expect(await colourAt(out, ...AWAY, 1.5)).toBe('red')
    expect(await colourAt(out, ...IN_CORNER, 0.5)).toBe('red')
    expect(await colourAt(out, ...IN_CORNER, 2.5)).toBe('red')
    // Its very first frame, the first of a segment.
    expect(await colourAt(out, ...IN_CORNER, 1.0)).toBe('green')
  })

  it('stays on screen across a cut in V1, on the first frame after it too', async () => {
    // From 3.5 s to 4.5 s, across the cut at 4 s between the two red clips.
    session.applyEdit({ sequenceId: S1, kind: 'moveClip', clipId: 'g', trackId: 'V2', start: 105 })
    const out = await exportJoined('across')
    expect(await countFrames(out)).toBe(timelineDuration(firstTimeline(session.getProject())))
    expect(await colourAt(out, ...IN_CORNER, 3.8)).toBe('green')
    expect(await colourAt(out, ...IN_CORNER, 4.0)).toBe('green')
    expect(await colourAt(out, ...IN_CORNER, 4.3)).toBe('green')
    expect(await colourAt(out, ...IN_CORNER, 4.7)).toBe('red')
  })

  it('is not in the export at all once its track is hidden, and is back when it is shown', async () => {
    session.applyEdit({ sequenceId: S1, kind: 'setTrackHidden', trackId: 'V2', hidden: true })
    const gone = await exportJoined('hidden')
    // Every frame is still there: hiding a track takes nothing out of the sequence.
    expect(await countFrames(gone)).toBe(timelineDuration(firstTimeline(session.getProject())))
    expect(await colourAt(gone, ...IN_CORNER, 3.8)).toBe('red')
    expect(await colourAt(gone, ...IN_CORNER, 4.3)).toBe('red')

    session.applyEdit({ sequenceId: S1, kind: 'setTrackHidden', trackId: 'V2', hidden: false })
    const back = await exportJoined('shown')
    expect(await colourAt(back, ...IN_CORNER, 3.8)).toBe('green')
  })

  it('goes on past V1\'s end, in black, to the end of the last clip on a row, with its sound', async () => {
    // Two seconds of red on V1, muted. Past its end, the green clip in the
    // corner from 2.5 s to 3.5 s, and the WAV on A2 from 2.5 s, whose beep
    // is 0.5 s into it, so at 3.0 s.
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    const green = await importFile(await fx.greenClip(), ...quiet())
    const wav = await fx.beepWav()
    const beepInWav = await beepAt(wav)
    const song = await importFile(wav, ...quiet())
    for (const a of [red, green, song]) session.addAsset(a)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: 'r', frame: 60 })
    // V1's sound is the sound clip linked to it.
    session.applyEdit({ sequenceId: S1, kind: 'setClipAudio', clipId: 'r.1', gain: 1, muted: true })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: green.id, clipId: 'g', at: 75, onTrack: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: 'g', frame: 30 })
    const t = firstTimeline(session.getProject())
    const g = findVideoClip(t, 'g')!.clip
    const m = t.media.find((x) => x.id === green.id)!
    session.applyEdit({ sequenceId: S1, kind: 'setPlace', clipId: 'g', picture: 'main', place: cornerPlace(m, g.transform.crop, 1080, 1920), reshapeCrop: true })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'audio', trackId: 'A2' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: song.id, clipId: 's', at: 75, onTrack: 'A2' })
    expect(timelineDuration(firstTimeline(session.getProject()))).toBe(105)

    const out = await exportJoined('past-v1')
    expect(await countFrames(out)).toBe(105)
    expect(await colourAt(out, ...AWAY, 1.0)).toBe('red')
    expect(await colourAt(out, ...IN_CORNER, 2.2)).toBe('black')
    expect(await colourAt(out, ...AWAY, 2.2)).toBe('black')
    expect(await colourAt(out, ...IN_CORNER, 3.0)).toBe('green')
    expect(await colourAt(out, ...AWAY, 3.0)).toBe('black')
    expect(Math.abs((await beepAt(out)) - (2.5 + beepInWav))).toBeLessThan(0.005)
  })

  it('neither drops a frame nor pushes what follows late, over 25 fps footage', async () => {
    // A picture whose edges fall inside a 25 fps clip, whose frames do not
    // land on the 30 fps project's: each edge starts a segment part way in.
    session.resetProject()
    const source = await fx.red25Beep()
    const beepInSource = await beepAt(source)
    const red = await importFile(source, ...quiet())
    const green = await importFile(await fx.greenClip(), ...quiet())
    session.addAsset(red)
    session.addAsset(green)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r' })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    for (const end of [64, 65]) {
      const id = `g${end}`
      session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: green.id, clipId: id, at: 34, onTrack: 'V2' })
      session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: id, frame: end - 34 })
      const out = await exportJoined(`red25-${end}`)
      expect(await countFrames(out)).toBe(120)
      const duration = Number(
        (await runFfprobe(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', out])).trim()
      )
      expect(Math.abs(duration - 4)).toBeLessThan(0.02)
      // A frame late would be 33 ms.
      expect(Math.abs((await beepAt(out)) - beepInSource)).toBeLessThan(0.005)
      session.applyEdit({ sequenceId: S1, kind: 'removeClip', clipId: id })
    }
  })
})

describe('a gap on V1', () => {
  it('exports black and silence for its length, with every frame', async () => {
    // Two red clips with their tone, the second dropped a second after the first ends.
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    session.addAsset(red)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r1' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r2', at: 150, onTrack: 'v1' })
    expect(clipsOf(session.getProject()).map((c) => [c.timelineStart, spanEnd(c)])).toEqual([
      [0, 120],
      [150, 270]
    ])
    expect(timelineDuration(firstTimeline(session.getProject()))).toBe(270)

    const out = await exportJoined('gap')
    expect(await countFrames(out)).toBe(270)
    for (const at of [4.1, 4.5, 4.9]) {
      expect(await colourAt(out, ...AWAY, at)).toBe('black')
      expect(await colourAt(out, ...IN_CORNER, at)).toBe('black')
    }
    expect(await colourAt(out, ...AWAY, 3.9)).toBe('red')
    expect(await colourAt(out, ...AWAY, 5.1)).toBe('red')
    expect(await loudestBetween(out, 4.1, 4.9)).toBeLessThan(-80)
    // Either side of it, the clips' own tone.
    expect(await loudestBetween(out, 3.0, 3.9)).toBeGreaterThan(-30)
    expect(await loudestBetween(out, 5.1, 6.0)).toBeGreaterThan(-30)
  })
})

describe('a clip in black and white', () => {
  it('exports grey where it was red, and only that clip', async () => {
    session.resetProject()
    const red = await importFile(await fx.redClip(), ...quiet())
    const green = await importFile(await fx.greenClip(), ...quiet())
    session.addAsset(red)
    session.addAsset(green)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r1' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: red.id, clipId: 'r2' })
    session.applyEdit({ sequenceId: S1, kind: 'setLook', clipId: 'r1', look: 'mono' })

    const out = await exportJoined('mono')
    expect(await countFrames(out)).toBe(timelineDuration(firstTimeline(session.getProject())))
    expect(await colourAt(out, ...AWAY, 0.0)).toBe('grey')
    expect(await colourAt(out, ...AWAY, 2.0)).toBe('grey')
    // The clip after it keeps its colour.
    expect(await colourAt(out, ...AWAY, 4.5)).toBe('red')
  })

  it('turns a picture laid over grey without touching the one underneath', async () => {
    session.applyEdit({ sequenceId: S1, kind: 'setLook', clipId: 'r1', look: null })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    const green = session.getProject().media.find((m) => m.originalPath.includes('green'))!
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: green.id, clipId: 'g', at: 30, onTrack: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: 'g', frame: 30 })
    const t = firstTimeline(session.getProject())
    const g = findVideoClip(t, 'g')!.clip
    const m = t.media.find((x) => x.id === green.id)!
    session.applyEdit({ sequenceId: S1, kind: 'setPlace', clipId: 'g', picture: 'main', place: cornerPlace(m, g.transform.crop, 1080, 1920), reshapeCrop: true })
    session.applyEdit({ sequenceId: S1, kind: 'setLook', clipId: 'g', look: 'mono' })

    const out = await exportJoined('mono-over')
    expect(await colourAt(out, ...IN_CORNER, 1.5)).toBe('grey')
    expect(await colourAt(out, ...AWAY, 1.5)).toBe('red')
    expect(await colourAt(out, ...IN_CORNER, 0.5)).toBe('red')
  })
})
