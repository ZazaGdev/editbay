import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture } from '../../src/main/ffmpeg/spawn'
import { ffmpegPath } from '../../src/main/ffmpeg/locate'
import { runFfprobe } from '../../src/main/ffmpeg/run'
import { makeMix, transcribe, type SpeechRunner } from '../../src/main/speech/transcribe'
import { DTW_LATE_SEC } from '../../src/shared/captions'
import {
  addSource,
  createTimeline,
  listenTracks,
  moveClipTo,
  rippleTrim,
  splitClip,
  v1Clips,
  type ProjectMedia,
  type Timeline
} from '../../src/shared/project'

/**
 * Listening to a sequence through the real pipeline: a recording cut and
 * closed up, with a voice over and a song, mixed as whisper would hear it and
 * read back by where its beeps land; and the words a stand-in for whisper-cli
 * says it heard, brought back to the sequence's frames.
 */

const work = await mkdtemp(join(tmpdir(), 'editbay-captions-'))
const fake = join(process.cwd(), 'test', 'fixtures', 'fake-whisper.mjs')

afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

async function generate(file: string, args: string[]): Promise<string> {
  const out = join(work, file)
  await capture(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args, out])
  return out
}

function media(id: string, path: string, durationSec: number, more: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id,
    originalPath: path,
    playablePath: path,
    conformed: false,
    conformReasons: [],
    durationSec,
    width: 320,
    height: 180,
    fps: 30,
    codec: 'h264',
    hasAudio: true,
    peaksPath: join(work, `${id}.peaks`),
    filmstripPath: join(work, `${id}.jpg`),
    ...more
  }
}

/**
 * Where each sound starts after silence, in seconds, before `endSec`: a
 * silence that runs to the end of the file is said to end there too.
 */
async function onsets(path: string, endSec: number): Promise<number[]> {
  const { stderr } = await capture(ffmpegPath, ['-hide_banner', '-i', path, '-af', 'silencedetect=n=-40dB:d=0.05', '-f', 'null', '-'])
  return [...stderr.toString().matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1])).filter((at) => at < endSec - 0.05)
}

let sequence: Timeline
/** Where the recording and the take themselves play their beeps, as ffmpeg decodes them. */
let own: { talk: number[]; take: number }

beforeAll(async () => {
  // Four seconds of talking, silent but for beeps at 1.0, 2.2 and 3.0 s of the recording.
  const talking = await generate('talking.mkv', [
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=4',
    '-af', "volume=volume=0:enable='not(between(t,1.0,1.1)+between(t,2.2,2.3)+between(t,3.0,3.1))'",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest'
  ])
  // A voice over take, named as the app names them, silent but for a beep at 0.5 s.
  const take = await generate('Voice over 2026-09-22 14-03-05.wav', [
    '-f', 'lavfi', '-i', 'sine=frequency=700:sample_rate=48000:duration=1',
    '-af', "volume=volume=0:enable='not(between(t,0.5,0.6))'",
    '-ac', '1'
  ])
  own = { talk: await onsets(talking, 4), take: (await onsets(take, 1))[0]! }
  // A song, loud all the way through, which is not listened to.
  const song = await generate('song.wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=4', '-ac', '2'])

  let t: Timeline = {
    ...createTimeline(30, { width: 1080, height: 1920 }),
    media: [
      media('talk', talking, 4),
      media('take', take, 1, { hasVideo: false, width: 0, height: 0 }),
      media('song', song, 4, { hasVideo: false, width: 0, height: 0 })
    ]
  }
  t = addSource(t, { mediaId: 'talk', clipId: 'talk', at: 0, onTrack: 'v1' })
  // Cut at 2 s, and the second piece's first half second taken out, closing up:
  // the beep at 2.2 s goes, and the one at 3.0 s comes to 2.5 s.
  t = splitClip(t, 60, 'talk')
  t = rippleTrim(t, v1Clips(t)[1]!.id, 'start', 75)
  t = addSource(t, { mediaId: 'song', clipId: 'song', at: 0 })
  // The take at 3 s, so its beep is heard at 3.5 s.
  sequence = addSource(t, { mediaId: 'take', clipId: 'take', at: 90 })
})

describe('the mix whisper hears', () => {
  it('is one channel at 16 kHz, as long as what is listened to', async () => {
    const out = join(work, 'mix.wav')
    await makeMix(sequence, listenTracks(sequence), out)
    const probed = JSON.parse(await runFfprobe(['-v', 'error', '-show_streams', '-of', 'json', out])) as {
      streams: { sample_rate: string; channels: number; duration: string }[]
    }
    expect(probed.streams[0]).toMatchObject({ sample_rate: '16000', channels: 1 })
    expect(Number(probed.streams[0]!.duration)).toBeCloseTo(4, 1)
    // Its graph is not left beside it.
    await expect(stat(`${out}.txt`)).rejects.toThrow()
  })

  it('has the talking as cut, and the voice over where it was put, and not the song', async () => {
    const out = join(work, 'mix-beeps.wav')
    await makeMix(sequence, listenTracks(sequence), out)
    // The mix runs to the end of the take, at 4 s. Each beep is held to where
    // its own file plays it, a little late of what was asked for as a
    // compressed sound's is: the one at 1 s where it was, the one at 3 s
    // half a second earlier, and the take's 3 s on.
    const heard = await onsets(out, 4)
    expect(own.talk).toHaveLength(3)
    expect(heard).toHaveLength(3)
    ;[own.talk[0]!, own.talk[2]! - 0.5, own.take + 3].forEach((at, i) => expect(Math.abs(heard[i]! - at), `sound ${i + 1} at ${heard[i]} s, not ${at}`).toBeLessThan(0.015))
  })
})

describe('the mix of a sequence cut out of order', () => {
  it('has each piece where it is put, however far into its recording it comes from', async () => {
    // The talking alone, cut at 2 s, and its second half moved first with Ctrl.
    let t: Timeline = { ...sequence, audioTracks: sequence.audioTracks.map((r) => ({ ...r, clips: [] })), videoTracks: [{ id: 'v1', clips: [] }] }
    t = addSource(t, { mediaId: 'talk', clipId: 'talk', at: 0, onTrack: 'v1' })
    t = splitClip(t, 60, 'talk')
    t = moveClipTo(t, v1Clips(t)[1]!.id, 'v1', 0, { insert: true })
    expect(v1Clips(t).map((c) => [c.sourceIn, c.timelineStart])).toEqual([
      [60, 0],
      [0, 60]
    ])
    const out = join(work, 'mix-reordered.wav')
    await makeMix(t, listenTracks(t), out)
    // The beeps at 2.2 and 3.0 s of the recording come first, 2 s earlier, and the one at 1.0 s 2 s later.
    const heard = await onsets(out, 4)
    expect(heard).toHaveLength(3)
    ;[own.talk[1]! - 2, own.talk[2]! - 2, own.talk[0]! + 2].forEach((at, i) => expect(Math.abs(heard[i]! - at), `sound ${i + 1} at ${heard[i]} s, not ${at}`).toBeLessThan(0.015))
  })
})

describe('transcribing', () => {
  const runner = (env: Record<string, string>): SpeechRunner => ({ command: process.execPath, prefix: [fake], env: { ...process.env, ...env } })

  it('gives back the words the engine heard, at frames of the sequence, having handed it the mix', async () => {
    const log = join(work, 'fake.json')
    const scratch = join(work, 'scratch')
    const seen: number[] = []
    const words = await transcribe({
      timeline: sequence,
      trackIds: listenTracks(sequence),
      runner: runner({
        EDITBAY_FAKE_WHISPER_WORDS: JSON.stringify([
          { text: 'Hello', start: 1.0, end: 1.4 },
          { text: 'world.', start: 2.5, end: 3.0 }
        ]),
        EDITBAY_FAKE_WHISPER_LOG: log,
        // A pause between its progress lines, as the real engine has: without one a fast machine reads them all in one go.
        EDITBAY_FAKE_WHISPER_DELAY_MS: '20'
      }),
      model: join(work, 'model.bin'),
      dtw: 'medium.en',
      scratchDir: scratch,
      onProgress: (f) => seen.push(f)
    })
    // The stand-in is told the words are said at 1.0 s and 2.5 s and writes
    // its DTW times as late as the real engine's run. Taking that off again
    // puts them back where they were said: frame 30 and frame 75.
    expect(words).toEqual([
      { text: 'Hello', start: 30, length: 12 },
      { text: 'world.', start: 75, length: 15 }
    ])
    const given = JSON.parse((await readFile(log)).toString()) as { args: string[]; wav: { sampleRate: number; channels: number; seconds: number } }
    expect(given.wav).toMatchObject({ sampleRate: 16000, channels: 1 })
    expect(given.wav.seconds).toBeCloseTo(4, 1)
    expect(given.args).toContain('-dtw')
    expect(seen.at(-1)).toBe(1)
    expect(seen.some((f) => f > 0.1 && f < 1)).toBe(true)
    // Nothing is left behind.
    await expect(stat(scratch)).rejects.toThrow()
  })

  it('reads what whisper-cli itself writes, handed it by the stand-in', async () => {
    const words = await transcribe({
      timeline: sequence,
      trackIds: listenTracks(sequence),
      runner: runner({ EDITBAY_FAKE_WHISPER_FILE: join(process.cwd(), 'test', 'fixtures', 'whisper-real.json') }),
      model: join(work, 'model.bin'),
      dtw: 'medium.en',
      scratchDir: join(work, 'scratch-real'),
      onProgress: () => undefined
    })
    expect(words.map((w) => w.text).slice(0, 4)).toEqual(["I've", 'been', 'meaning', 'to'])
    expect(words.at(-1)).toMatchObject({ text: 'software.' })
    // DTW hears the first word at 1.70 s, frame 51, and runs late, so it lands
    // a little before that rather than at the start of the file its own token
    // timestamps claim.
    expect(words[0]!.start).toBe(51 - Math.round(DTW_LATE_SEC * 30))
  })

  it('stops when cancelled, leaving nothing behind', async () => {
    const scratch = join(work, 'scratch-cancelled')
    const controller = new AbortController()
    const going = transcribe({
      timeline: sequence,
      trackIds: listenTracks(sequence),
      runner: runner({ EDITBAY_FAKE_WHISPER_DELAY_MS: '400' }),
      model: join(work, 'model.bin'),
      dtw: 'medium.en',
      scratchDir: scratch,
      onProgress: (f) => {
        if (f > 0.1) controller.abort()
      },
      signal: controller.signal
    })
    await expect(going).rejects.toThrow(/cancelled/)
    await expect(stat(scratch)).rejects.toThrow()
  })

  it('says so when nothing is heard on the tracks chosen', async () => {
    await mkdir(join(work, 'x'), { recursive: true })
    const empty = sequence.audioTracks.find((r) => r.clips.length === 0)?.id ?? 'none'
    await expect(
      transcribe({ timeline: sequence, trackIds: [empty], runner: runner({}), model: 'm', dtw: 'medium.en', scratchDir: join(work, 'x', 's'), onProgress: () => undefined })
    ).rejects.toThrow(/Nothing is heard/)
  })
})
