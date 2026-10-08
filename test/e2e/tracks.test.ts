import { describe, it, expect, afterAll, vi } from 'vitest'
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectMedia } from '../../src/shared/project'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-tracks-cache-'))
vi.mock('electron', () => ({
  app: { getPath: (): string => cacheRoot }
}))

const { fixtureSet } = await import('./fixtures')
const { importFile, tracksCopied, copyingTracks } = await import('../../src/main/media/import')
const { decodePeaks } = await import('../../src/main/media/waveform')
const { runFfprobe } = await import('../../src/main/ffmpeg/run')
const { capture } = await import('../../src/main/ffmpeg/spawn')
const { ffmpegPath } = await import('../../src/main/ffmpeg/locate')
const { planRender, exportNames, parseLoudnorm } = await import('../../src/shared/render-plan')
const { presetById } = await import('../../src/shared/presets')
const { runExport } = await import('../../src/main/render/runner')
const { isSilentPeaks } = await import('../../src/shared/sound')
const session = await import('../../src/main/project/session')
const { clipLength, linkedIds, timelineDuration, trackCount, trackFile, trackPeaks } = await import('../../src/shared/project')
const { spanEnd } = await import('../../src/shared/tracks')
const { S1, clipsOf, soundsOf, firstTimeline } = await import('../project-helpers')

/**
 * A recording's streams through the real pipeline. Most of it on a file
 * shaped like an OBS recording with three streams: the third starts 20 ms
 * after the picture and holds one beep, so where the beep lands in an export
 * says whether its copy kept the recording's start. And one shaped like the
 * owner's own, with six streams, three of them silent.
 */

const fx = fixtureSet('tracks-e2e')
const work = await mkdtemp(join(tmpdir(), 'editbay-tracks-'))

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

/** Where a stream starts and how long it runs, as ffprobe reports them. */
async function streamTimes(path: string): Promise<{ start: number; duration: number }> {
  const out = await runFfprobe(['-v', 'error', '-show_entries', 'format=start_time,duration', '-of', 'csv=p=0', path])
  const [start, duration] = out.trim().split(',').map(Number)
  return { start: start ?? NaN, duration: duration ?? NaN }
}

/** Filters that leave the 1 kHz beep and take away track 1's 440 Hz tone. */
const ABOVE_THE_TONE = 'highpass=f=900,highpass=f=900,highpass=f=900,highpass=f=900'

/**
 * When the first sound starts after silence, in seconds, read from one audio
 * stream the way ffmpeg counts time. The beep is the only sound on its track;
 * `filters` pick it out from under other sound.
 */
async function firstSound(path: string, stream = 'a:0', filters = ''): Promise<number> {
  const detect = filters ? `${filters},silencedetect=n=-30dB:d=0.05` : 'silencedetect=n=-40dB:d=0.05'
  const { stderr } = await capture(ffmpegPath, [
    '-hide_banner', '-i', path, '-map', `0:${stream}`, '-af', detect, '-f', 'null', '-'
  ])
  const m = stderr.toString().match(/silence_end: ([\d.]+)/)
  if (!m?.[1]) throw new Error(`no sound found in ${path}`)
  return Number(m[1])
}

/** The loudest the sound of a file gets, in dB. */
async function loudest(path: string): Promise<number> {
  const { stderr } = await capture(ffmpegPath, ['-hide_banner', '-i', path, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'])
  const m = stderr.toString().match(/max_volume: (-?[\d.]+|-inf) dB/)
  return m?.[1] === '-inf' || !m?.[1] ? -Infinity : Number(m[1])
}

/** How loud one audio stream of a file is on average, in dB. */
async function meanVolume(path: string, stream = 'a:0'): Promise<number> {
  const { stderr } = await capture(ffmpegPath, ['-hide_banner', '-i', path, '-map', `0:${stream}`, '-af', 'volumedetect', '-f', 'null', '-'])
  const m = stderr.toString().match(/mean_volume: (-?[\d.]+|-inf) dB/)
  return m?.[1] === '-inf' || !m?.[1] ? -Infinity : Number(m[1])
}

/**
 * How loud a finished file is overall, in LUFS, which is the measure levelling
 * works to. Mean volume cannot be used for that: levelling changes the gain,
 * so an absolute comparison against a source stream no longer holds.
 */
async function integrated(path: string): Promise<number> {
  const { stderr } = await capture(ffmpegPath, [
    '-hide_banner', '-i', path, '-map', '0:a:0',
    '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json',
    '-f', 'null', '-'
  ])
  const m = parseLoudnorm(stderr.toString())
  if (m === null) throw new Error(`no loudness could be measured from ${path}`)
  return m.i
}

/** A segment's filter graph, which says what its sound is made of. */
function graphOf(args: string[]): string {
  return args[args.indexOf('-filter_complex') + 1] ?? ''
}

/** The export this project would produce, without running it. */
function planFor(name: string): ReturnType<typeof planRender> {
  const project = session.getProject()
  return planRender({
    timeline: firstTimeline(project),
    names: { ...exportNames(project, S1), joined: name },
    preset: presetById('vertical'),
    mode: 'join',
    outputDir: join(work, 'out'),
    scratchDir: join(work, `scratch-${name}`),
    filenamePattern: '{project}'
  })
}

async function exportJoined(name: string): Promise<string> {
  const scratch = join(work, `scratch-${name}`)
  const [output] = await runExport({ plan: planFor(name), fps: session.getProject().fps, scratchDir: scratch, onProgress: () => {} })
  return output!
}

/**
 * The streams of a source that have sound in them, as the window finds them:
 * each stream's waveform, as the import wrote it and main hands it to the
 * window, and any that is flat left out.
 */
async function streamsWithSound(m: ProjectMedia): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < trackCount(m); i++) {
    const file = trackFile(m, i)
    expect(file, `stream ${i + 1} has a waveform`).not.toBeNull()
    if (!isSilentPeaks(decodePeaks(await readFile(file!.peaksPath)))) out.push(i)
  }
  return out
}

/** Which of the streams a clip's sound clips play are heard: those named, and no others. */
function hear(clipId: string, streams: number[]): void {
  const t = firstTimeline(session.getProject())
  const ids = new Set(linkedIds(t, clipId))
  for (const s of soundsOf(session.getProject()).filter((x) => ids.has(x.id))) {
    session.applyEdit({ sequenceId: S1, kind: 'setClipAudio', clipId: s.id, gain: s.gain, muted: !streams.includes(s.track) })
  }
}

let recording = ''
/** Where the beep is on the recording's third track, the way the export counts time. */
let beepAt = 0

describe('a recording with three audio tracks', () => {
  it('imports with a copy of each track after the first, each starting at the recording\'s start', async () => {
    recording = await fx.obsTracksClip()
    beepAt = await firstSound(recording, 'a:2')
    session.resetProject()
    const asset = await importFile(recording, ...quiet())
    expect(asset.status).toBe('ready')
    expect(asset.audioTracks).toBe(3)
    expect(asset.trackNames).toEqual(['', '', ''])
    expect(asset.trackFiles).toHaveLength(2)
    for (const copy of asset.trackFiles!) {
      const { start, duration } = await streamTimes(copy.path)
      expect(Math.abs(start)).toBeLessThan(0.001)
      expect(Math.abs(duration - 3)).toBeLessThan(0.05)
    }
    session.addAsset(asset)
    expect(session.getProject().media[0]!.trackFiles).toHaveLength(2)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'rec' })
    // Its picture on V1, and each stream on an audio track of its own, only the first heard.
    const t = firstTimeline(session.getProject())
    expect(t.audioTracks.map((r) => r.clips.map((c) => [c.id, c.track, c.muted]))).toEqual([
      [['rec.1', 0, false]],
      [['rec.2', 1, true]],
      [['rec.3', 2, true]]
    ])
  })

  it('exports a clip playing only the late track with its beep where the recording has it', async () => {
    hear('rec', [2])
    const out = await exportJoined('late-track')
    // A copy that began at the track's own first sound would put this 20 ms early.
    expect(Math.abs((await firstSound(out)) - beepAt)).toBeLessThan(0.005)
  })

  it('keeps the beep in place when the clip starts part way in', async () => {
    const before = session.getProject()
    // I on V1 half a second in: the clip keeps its start and loses its first half second, with its sound.
    session.applyEdit({ sequenceId: S1, kind: 'trimToFrame', clipId: 'rec', edge: 'start', frame: 15 })
    expect(clipsOf(session.getProject()).map((c) => [c.timelineStart, c.sourceIn])).toEqual([[0, 15]])
    const out = await exportJoined('late-track-cut')
    expect(Math.abs((await firstSound(out)) - (beepAt - 0.5))).toBeLessThan(0.005)
    // Undone.
    session.setProject(before)
  })

  it('exports tracks 1 and 3 mixed, both in it and in step, with every frame', async () => {
    hear('rec', [0, 2])
    const expected = timelineDuration(firstTimeline(session.getProject()))
    const out = await exportJoined('mixed')
    expect(await countFrames(out)).toBe(expected)
    // Track 1's tone is there...
    expect(await loudest(out)).toBeGreaterThan(-20)
    // ...and so is track 3's beep, where the recording has it, picked out
    // from under the tone. Both are found the same way, so the filter's own
    // delay cancels out.
    const beepInRecording = await firstSound(recording, 'a:2', ABOVE_THE_TONE)
    expect(Math.abs((await firstSound(out, 'a:0', ABOVE_THE_TONE)) - beepInRecording)).toBeLessThan(0.005)
  })

  it('exports silence for a clip with every track unticked, still with every frame', async () => {
    hear('rec', [])
    const expected = timelineDuration(firstTimeline(session.getProject()))
    const out = await exportJoined('none')
    expect(await countFrames(out)).toBe(expected)
    expect(await loudest(out)).toBeLessThan(-80)
  })

  it('exports the two pieces left when it is cut in three and the middle closed up, with the beep where the recording has it', async () => {
    session.resetProject()
    const asset = await importFile(recording, ...quiet())
    session.addAsset(asset)
    const m = session.getProject().media[0]!
    // Every stream has something in it: the third its beep.
    expect(await streamsWithSound(m)).toEqual([0, 1, 2])
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: m.id, clipId: 'rec', at: 0, onTrack: 'v1', streams: [0, 1, 2] })
    const length = clipLength(clipsOf(session.getProject())[0]!)
    // Stream 3 heard, stream 1 muted.
    hear('rec', [2])
    // S at 0.2 s and at 0.6 s, then Shift+Delete on the piece between.
    session.applyEdit({ sequenceId: S1, kind: 'split', frame: 6, clipId: 'rec' })
    session.applyEdit({ sequenceId: S1, kind: 'split', frame: 18 })
    expect(clipsOf(session.getProject()).map((c) => c.timelineStart)).toEqual([0, 6, 18])
    session.applyEdit({ sequenceId: S1, kind: 'closeUpClip', clipId: clipsOf(session.getProject())[1]!.id })

    const t = firstTimeline(session.getProject())
    expect(clipsOf(session.getProject()).map((c) => [c.timelineStart, spanEnd(c), c.sourceIn])).toEqual([
      [0, 6, 0],
      [6, length - 12, 18]
    ])
    // Every stream's pieces in step with the picture's.
    for (const track of t.audioTracks) {
      expect(track.clips.map((c) => [c.timelineStart, spanEnd(c), c.sourceIn])).toEqual([
        [0, 6, 0],
        [6, length - 12, 18]
      ])
    }
    expect(soundsOf(session.getProject()).filter((s) => !s.muted).map((s) => s.track)).toEqual([2, 2])
    expect(timelineDuration(t)).toBe(length - 12)

    const out = await exportJoined('closed-up')
    expect(await countFrames(out)).toBe(length - 12)
    // The 0.4 s taken out came before the beep, so it is 0.4 s earlier in the file.
    expect(Math.abs((await firstSound(out)) - (beepAt - 0.4))).toBeLessThan(0.005)
  })
})

describe('a recording with one audio track', () => {
  it('makes no copies', async () => {
    const asset = await importFile(await fx.cleanClip(), ...quiet())
    expect(asset.status).toBe('ready')
    expect(asset.audioTracks).toBe(1)
    expect(asset.trackFiles).toBeUndefined()
  })
})

describe('a recording shaped like the owner\'s, with six streams and three of them silent', () => {
  it('comes in as its picture and the three streams with sound, only the first heard, and exports as loud as the first alone', async () => {
    const path = await fx.obsSixClip()
    session.resetProject()
    const asset = await importFile(path, ...quiet())
    expect(asset.status).toBe('ready')
    expect(asset.audioTracks).toBe(6)
    expect(asset.trackNames).toEqual(['Track1', 'Track2', 'Track3', 'Track4', 'Track5', 'Track6'])
    expect(asset.trackFiles).toHaveLength(5)
    session.addAsset(asset)
    const m = session.getProject().media[0]!

    // Streams 2, 3 and 5 are flat, as the window finds from their waveforms.
    const streams = await streamsWithSound(m)
    expect(streams).toEqual([0, 3, 5])
    // Dropped on V1 at the start.
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: m.id, clipId: 'obs', at: 0, onTrack: 'v1', streams })

    const t = firstTimeline(session.getProject())
    expect(clipsOf(session.getProject()).map((c) => c.id)).toEqual(['obs'])
    expect(t.audioTracks.map((r) => r.clips.map((c) => [c.id, c.track, c.muted, c.gain]))).toEqual([
      [['obs.1', 0, false, 1]],
      [['obs.4', 3, true, 1]],
      [['obs.6', 5, true, 1]]
    ])
    expect(linkedIds(t, 'obs')).toEqual(['obs', 'obs.1', 'obs.4', 'obs.6'])
    const length = clipLength(clipsOf(session.getProject())[0]!)
    for (const s of soundsOf(session.getProject())) expect([s.timelineStart, clipLength(s)]).toEqual([0, length])

    const out = await exportJoined('six-streams')
    expect(await countFrames(out)).toBe(length)
    // The microphone is really on the file, not a flat track.
    expect(await meanVolume(path, 'a:0')).toBeGreaterThan(-40)
    // The microphone once, not three times over. This used to be read off the
    // export's own volume, which no longer says anything: the export is levelled
    // on the way out, so the mic tripled would come back at the same loudness as
    // the mic alone. What the export is made of is read from the plan instead,
    // where three heard streams would be a mix of three rather than one chain.
    const sound = graphOf(planFor('six-streams').segments[0]!.args)
    expect(sound).not.toContain('amix')
    expect(sound).toContain('[0:a:0]')
    // And levelled: every export plays back at the same loudness, whatever was recorded.
    expect(await integrated(out)).toBeGreaterThan(-15)
    expect(await integrated(out)).toBeLessThan(-13)
  })
})

describe('a recording ready before its other tracks are copied', () => {
  it('can be cut at once, knows which tracks are flat already, and gets its copies behind', async () => {
    // A file of its own, so nothing is taken from the cache the other tests filled.
    const path = join(work, 'early.mkv')
    await copyFile(await fx.obsSixClip(), path)
    const told: { trackFiles?: unknown[]; copying?: unknown[]; error?: string }[] = []
    const asset = await importFile(path, ...quiet(), {
      onTracksCopied: (a, error) => told.push({ ...(a.trackFiles ? { trackFiles: a.trackFiles } : {}), ...(error ? { error } : {}) })
    })

    // Ready, with its other five tracks on their way rather than done.
    expect(asset.status).toBe('ready')
    expect(asset.trackFiles).toBeUndefined()
    expect(asset.copying).toHaveLength(5)
    expect(copyingTracks(new Set([asset.id]))).toBe(true)

    // Every track's waveform is there already, so the flat ones are known now,
    // and it would land on the timeline exactly as it does once copied.
    session.resetProject()
    session.addAsset(asset)
    const m = session.getProject().media[0]!
    const heard: number[] = []
    for (let i = 0; i < trackCount(m); i++) {
      const peaks = trackPeaks(m, i)
      expect(peaks, `stream ${i + 1} has a waveform`).not.toBeNull()
      if (!isSilentPeaks(decodePeaks(await readFile(peaks!)))) heard.push(i)
    }
    expect(heard).toEqual([0, 3, 5])
    // No sound file for them yet, so nothing plays them or reads them.
    expect(trackFile(m, 1)).toBeNull()

    // Then the copies, and the source told about them.
    await tracksCopied(new Set([asset.id]))
    expect(copyingTracks(new Set([asset.id]))).toBe(false)
    expect(told).toHaveLength(1)
    expect(told[0]!.error).toBeUndefined()
    expect(told[0]!.trackFiles).toHaveLength(5)
    for (const f of told[0]!.trackFiles as { path: string }[]) expect((await stat(f.path)).size).toBeGreaterThan(0)
  }, 120_000)
})

describe('a track that is not heard', () => {
  it('is left out of the exported file, and putting it back brings it in again', async () => {
    session.resetProject()
    const asset = await importFile(recording, ...quiet())
    session.addAsset(asset)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: asset.id, clipId: 'rec' })
    // Every stream heard, so there is plenty to lose.
    hear('rec', [0, 1, 2])
    const heard = await exportJoined('mute-before')
    expect(await loudest(heard)).toBeGreaterThan(-20)

    // Every audio track muted: the file still has every frame, and no sound.
    const t = firstTimeline(session.getProject())
    const expected = timelineDuration(t)
    for (const track of t.audioTracks) {
      session.applyEdit({ sequenceId: S1, kind: 'setTrackMuted', trackId: track.id, muted: true })
    }
    const silent = await exportJoined('mute-after')
    expect(await countFrames(silent)).toBe(expected)
    expect(await loudest(silent)).toBeLessThan(-80)

    // Unmuted, it comes back: mute is a decision about the edit, not a one way door.
    for (const track of firstTimeline(session.getProject()).audioTracks) {
      session.applyEdit({ sequenceId: S1, kind: 'setTrackMuted', trackId: track.id, muted: false })
    }
    const again = await exportJoined('mute-undone')
    expect(await loudest(again)).toBeGreaterThan(-20)
  }, 240_000)
})
