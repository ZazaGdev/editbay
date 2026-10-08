import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = await mkdtemp(join(tmpdir(), 'editbay-rows-cache-'))
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
const { timelineDuration, findSoundClip } = await import('../../src/shared/project')
const { S1, clipsOf, soundsOf, firstTimeline } = await import('../project-helpers')

/**
 * Sound on the audio tracks through the real pipeline: sound files imported,
 * placed at a time, and read back from the export by where their beep lands,
 * and a tone laid under cuts, read back sample by sample for clicks.
 */

const fx = fixtureSet('rows-e2e')
const work = await mkdtemp(join(tmpdir(), 'editbay-rows-'))

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

/** When the first sound starts after silence, in seconds, the way ffmpeg counts time. */
async function firstSound(path: string): Promise<number> {
  const { stderr } = await capture(ffmpegPath, [
    '-hide_banner', '-i', path, '-map', '0:a:0', '-af', 'silencedetect=n=-40dB:d=0.05', '-f', 'null', '-'
  ])
  const m = stderr.toString().match(/silence_end: ([\d.]+)/)
  if (!m?.[1]) throw new Error(`no sound found in ${path}`)
  return Number(m[1])
}

async function loudest(path: string): Promise<number> {
  const { stderr } = await capture(ffmpegPath, ['-hide_banner', '-i', path, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'])
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

/** The WAV's clip on A2. */
const rowClip = (): { id: string } => {
  const found = findSoundClip(firstTimeline(session.getProject()), 'wav')!
  expect(found.track.id).toBe('A2')
  return found.clip
}

let wavBeep = 0
let mp3Beep = 0
let songId = ''
let expectedFrames = 0

describe('sound files', () => {
  it('import a WAV as it is, with no picture', async () => {
    const wav = await fx.beepWav()
    wavBeep = await firstSound(wav)
    session.resetProject()
    const asset = await importFile(wav, ...quiet())
    expect(asset.status).toBe('ready')
    expect(asset.hasVideo).toBe(false)
    expect(asset.conformed).toBe(false)
    expect(asset.playablePath).toBe(wav)
    expect(asset.filmstripPath).toBe('')
    expect(asset.durationSec).toBeCloseTo(1, 1)
    session.addAsset(asset)
    songId = asset.id
  })

  it('import an MP3 converted to M4A', async () => {
    const mp3 = await fx.beepMp3()
    mp3Beep = await firstSound(mp3)
    const asset = await importFile(mp3, ...quiet())
    expect(asset.status).toBe('ready')
    expect(asset.conformed).toBe(true)
    expect(asset.playablePath.endsWith('.m4a')).toBe(true)
    expect(Math.abs((await firstSound(asset.playablePath)) - mp3Beep)).toBeLessThan(0.005)
  })
})

describe('a sound clip on an audio track', () => {
  it('exports its beep where it was placed, to within 5 ms, with every frame', async () => {
    const clip = await importFile(await fx.cleanClip(), ...quiet())
    session.addAsset(clip)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: clip.id, clipId: 'v' })
    // V1's own sound is muted, so the beep is the only sound there is.
    const v1 = clipsOf(session.getProject())[0]!
    const own = soundsOf(session.getProject()).find((s) => s.link === v1.link)!
    session.applyEdit({ sequenceId: S1, kind: 'setClipAudio', clipId: own.id, gain: 1, muted: true })
    expectedFrames = timelineDuration(firstTimeline(session.getProject()))

    // Dropped from the bin onto A2 at 1.5 s.
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'audio', trackId: 'A2' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: songId, clipId: 'wav', at: 45, onTrack: 'A2' })
    const out = await exportJoined('beep-at-1.5')
    expect(await countFrames(out)).toBe(expectedFrames)
    // Placed at 1.5 s, its beep is 0.5 s in.
    expect(Math.abs((await firstSound(out)) - (1.5 + wavBeep))).toBeLessThan(0.005)
  })

  it('exports its beep in the right place after its head is trimmed, which moves it on the timeline', async () => {
    session.applyEdit({ sequenceId: S1, kind: 'setClipIn', clipId: rowClip().id, frame: 6 })
    const out = await exportJoined('beep-trimmed')
    // The head trimmed by 0.2 s moves the clip to start at 1.7 s, 0.3 s before its beep.
    expect(Math.abs((await firstSound(out)) - (1.5 + wavBeep))).toBeLessThan(0.005)
  })

  it('exports silence there when it is muted', async () => {
    session.applyEdit({ sequenceId: S1, kind: 'setClipAudio', clipId: rowClip().id, gain: 1, muted: true })
    const out = await exportJoined('muted-row')
    expect(await countFrames(out)).toBe(expectedFrames)
    expect(await loudest(out)).toBeLessThan(-80)
  })
})

/** A file's first sound stream decoded at 48 kHz, its left channel as samples. */
async function samples(path: string): Promise<Int16Array> {
  const { stdout } = await capture(ffmpegPath, ['-v', 'error', '-i', path, '-map', '0:a:0', '-ar', '48000', '-ac', '2', '-f', 's16le', 'pipe:1'])
  const left = new Int16Array(stdout.length >> 2)
  for (let i = 0; i < left.length; i++) left[i] = stdout.readInt16LE(i * 4)
  return left
}

/** The biggest jump between neighbouring samples from one sample to another. */
function biggestJump(s: Int16Array, from: number, to: number): number {
  let most = 0
  for (let i = Math.max(1, from); i < Math.min(s.length, to); i++) most = Math.max(most, Math.abs(s[i]! - s[i - 1]!))
  return most
}

/** Around each edge, 10 ms either side, and everywhere else, nothing jumps further than the tone itself does. */
function expectNoClicks(s: Int16Array, edges: number[], ownFrom: number, ownTo: number): void {
  // What the tone itself makes, well inside the first span, and that it is there at all.
  const own = biggestJump(s, ownFrom, ownTo)
  expect(own).toBeGreaterThan(100)
  for (const edge of edges) {
    expect(biggestJump(s, edge - 480, edge + 480), `at ${edge / 48000} s`).toBeLessThanOrEqual(own * 1.25)
  }
  expect(biggestJump(s, 480, s.length - 480)).toBeLessThanOrEqual(own * 1.25)
}

describe('a song under cuts', () => {
  it.each([
    ['a WAV', 'toneWav'],
    ['an M4A', 'toneM4a']
  ] as const)('plays across the edges of three spans with no click, from %s', async (_, file) => {
    // Three seconds of picture with no sound, cut at 1 s and 2 s, so the
    // sequence is three spans, and a 440 Hz tone on A2 under all three.
    session.resetProject()
    const picture = await importFile(await fx.silentClip(), ...quiet())
    const tone = await importFile(await fx[file](), ...quiet())
    expect(picture.hasAudio).toBe(false)
    session.addAsset(picture)
    session.addAsset(tone)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: picture.id, clipId: 'pic' })
    session.applyEdit({ sequenceId: S1, kind: 'split', frame: 30 })
    session.applyEdit({ sequenceId: S1, kind: 'split', frame: 60 })
    expect(clipsOf(session.getProject()).map((c) => c.timelineStart)).toEqual([0, 30, 60])
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'audio', trackId: 'A2' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: tone.id, clipId: 'tone', at: 0, onTrack: 'A2' })
    session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: 'tone', frame: 90 })
    expect(timelineDuration(firstTimeline(session.getProject()))).toBe(90)

    const out = await exportJoined(`tone-under-cuts-${file}`)
    expect(await countFrames(out)).toBe(90)
    const s = await samples(out)
    expect(s.length).toBeGreaterThan(143000)
    expectNoClicks(s.subarray(0, 144000), [48000, 96000], 14400, 33600)
  })

  it('plays a recording\'s own sound across the edges of a picture over part of it with no click', async () => {
    // Four seconds of a recording whose own sound is a 440 Hz tone in AAC, and
    // a picture on V2 over it from 1 s to 2 s: three spans, the tone read in
    // three pieces. Its keyframes are a second apart, so each piece starts on one.
    session.resetProject()
    const recording = await importFile(await fx.keyedClip(), ...quiet())
    const picture = await importFile(await fx.silentClip(), ...quiet())
    session.addAsset(recording)
    session.addAsset(picture)
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: recording.id, clipId: 'talk' })
    session.applyEdit({ sequenceId: S1, kind: 'addTrack', trackKind: 'video', trackId: 'V2' })
    session.applyEdit({ sequenceId: S1, kind: 'addSource', mediaId: picture.id, clipId: 'over', at: 30, onTrack: 'V2', streams: [] })
    session.applyEdit({ sequenceId: S1, kind: 'setClipOut', clipId: 'over', frame: 30 })
    expect(timelineDuration(firstTimeline(session.getProject()))).toBe(120)

    const out = await exportJoined('own-sound-under-a-picture')
    expect(await countFrames(out)).toBe(120)
    const s = await samples(out)
    expect(s.length).toBeGreaterThan(191000)
    expectNoClicks(s.subarray(0, 192000), [48000, 96000], 14400, 33600)
  })
})
