import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { trackFile, trackName, type Timeline } from '../../shared/project'
import { spanLength, speedOf } from '../../shared/tracks'
import { soundHeard } from '../../shared/speed'
import { tempoFilters } from '../../shared/render-sound'
import { framesToSeconds } from '../../shared/time'
import { readWhisperJson, wordsToFrames, type TimedWord } from '../../shared/captions'
import { clipNameFromPath } from '../../shared/filename'
import { runFfmpeg, streamFfmpeg } from '../ffmpeg/run'
import { capture } from '../ffmpeg/spawn'
import { exists } from '../media/cache'
import { SpeechError } from './engine'

/**
 * Listening to a sequence: its heard sound on the tracks chosen, mixed down
 * to one channel at 16 kHz, which is what whisper wants, and whisper's words
 * brought back to the sequence's frames.
 */

/** The rate whisper listens at. */
export const SPEECH_RATE = 16000

/** A heard clip on a track listened to: where in its file, for how long, where it starts in the sequence, and how loud. */
export interface Listened {
  path: string
  fromSec: number
  lengthSec: number
  atSec: number
  gain: number
  /** What to call its file if it is missing. */
  label: string
  /** Its file is a copy of one of the recording's streams, made in the cache, rather than the recording itself. */
  copy: boolean
  /** The speed it plays at, so `lengthSec` of it is that many times as much of its file. Absent for 1. */
  speed?: number
}

/**
 * Every heard clip on the tracks listened to, in track order. Muted and
 * silent clips are left out, and so is one sped up or slowed down past where
 * its sound is heard. A clip at a speed is heard as the export plays it: all
 * of its recording, stretched to its time on the timeline (audit 2026-10-19:
 * read for its timeline length at 1x, its captions ran late and stopped part
 * way through it).
 */
export function listened(t: Timeline, trackIds: readonly string[]): Listened[] {
  const wanted = new Set(trackIds)
  return t.audioTracks
    .filter((r) => wanted.has(r.id))
    .flatMap((r) =>
      r.clips.flatMap((c) => {
        const m = t.media.find((x) => x.id === c.mediaId)
        const file = m ? trackFile(m, c.track) : null
        if (!m || !file || c.muted || c.gain <= 0 || !soundHeard(c)) return []
        const speed = speedOf(c)
        return [
          {
            path: file.path,
            fromSec: framesToSeconds(c.sourceIn, t.fps),
            lengthSec: framesToSeconds(spanLength(c), t.fps),
            atSec: framesToSeconds(c.timelineStart, t.fps),
            gain: c.gain,
            label: c.track > 0 ? `${trackName(m, c.track)} of ${clipNameFromPath(m.originalPath)}` : clipNameFromPath(m.originalPath),
            copy: c.track > 0,
            ...(speed !== 1 ? { speed } : {})
          }
        ]
      })
    )
}

/**
 * The mix is levelled before whisper hears it. Clips are mixed at the volumes
 * the video wants, which for a quiet voice under game sound is far below what
 * a speech recogniser needs: audio that gave nothing at all gives its words
 * back once it is levelled. `speechnorm` is made for this and works in one
 * pass, so a long cut is not read twice.
 */
const SPEECH_LEVEL = 'speechnorm=e=12.5:r=0.0001:l=1'

/** A level as ffmpeg is given it: no more digits than it can use. */
function level(n: number): string {
  return String(Number(n.toFixed(6)))
}

/**
 * Where a clip heard goes in the mix, in samples at whisper's rate: its file's
 * samples `from` to `to`, counted from where the file's time starts, as the
 * export counts it, so a sound that starts a little after its picture keeps
 * that gap and its words are not heard early; laid at `at`, at its level.
 */
export interface Laid {
  from: number
  to: number
  at: number
  /** Its level, as ffmpeg's volume holds it. */
  gain: number
  speed: number
}

export function laidOut(c: Listened): Laid {
  const from = Math.round(c.fromSec * SPEECH_RATE)
  const speed = c.speed ?? 1
  return { from, to: from + Math.max(1, Math.round(c.lengthSec * speed * SPEECH_RATE)), at: Math.round(c.atSec * SPEECH_RATE), gain: Math.fround(c.gain), speed }
}

/**
 * One file's clips laid into the mix as the file's samples stream in, each
 * stretch of them added, at its level, wherever a clip takes it; a clip at a
 * speed has its stretch kept instead, to be stretched to its time first.
 *
 * Summed, as the export's sound is, never averaged. Each sample is read once
 * however many clips are cut from the file: a filter graph that gave every
 * clip the whole file and a mix of every clip padded to the sequence's length
 * took 72 s for 10 minutes in 1000 pieces, squared in the pieces (audit
 * 2026-11-07, fix first 5).
 */
export class Layer {
  private readonly clips: { laid: Laid; kept?: Float32Array; got: number }[]
  private next = 0
  private open: Layer['clips'] = []
  /** Where the last sample laid ends in the mix. */
  end = 0

  constructor(laid: Laid[], private readonly mix: Float32Array) {
    this.clips = [...laid].sort((a, b) => a.from - b.from).map((l) => ({ laid: l, got: 0, ...(l.speed !== 1 ? { kept: new Float32Array(l.to - l.from) } : {}) }))
  }

  /** A stretch of the file's samples, the first of them its sample `start`. */
  add(samples: Float32Array, start: number): void {
    const end = start + samples.length
    while (this.next < this.clips.length && this.clips[this.next]!.laid.from < end) this.open.push(this.clips[this.next++]!)
    this.open = this.open.filter((c) => c.laid.to > start)
    for (const c of this.open) {
      const { from, to, at, gain } = c.laid
      const a = Math.max(from, start)
      const b = Math.min(to, end)
      if (b <= a) continue
      c.got = b - from
      if (c.kept) c.kept.set(samples.subarray(a - start, b - start), a - from)
      else {
        for (let i = a; i < b; i++) this.mix[at + i - from]! += samples[i - start]! * gain
        this.end = Math.max(this.end, at + b - from)
      }
    }
  }

  /** The clips at a speed, each with as much of its stretch as the file had. */
  kept(): { laid: Laid; samples: Float32Array }[] {
    return this.clips.flatMap((c) => (c.kept && c.got > 0 ? [{ laid: c.laid, samples: c.kept.subarray(0, c.got) }] : []))
  }
}

/** Raw samples, as ffmpeg writes `f32le`, from a stream cut wherever it happened to be cut. */
class Samples {
  private carry = Buffer.alloc(0)
  take(chunk: Buffer): Float32Array {
    const bytes = this.carry.length > 0 ? Buffer.concat([this.carry, chunk]) : chunk
    const n = Math.floor(bytes.length / 4)
    const out = new Float32Array(n)
    Buffer.from(out.buffer).set(bytes.subarray(0, n * 4))
    this.carry = Buffer.from(bytes.subarray(n * 4))
    return out
  }
}

/** The arguments that read a file's first audio stream as one channel of raw samples at whisper's rate, up to `toSample`. */
export function decodeArgs(path: string, toSample: number): string[] {
  return [
    '-i', path, '-map', '0:a:0',
    '-af', `aresample=${SPEECH_RATE}:async=1:first_pts=0,aformat=sample_fmts=flt:channel_layouts=mono,atrim=end_sample=${toSample}`,
    '-f', 'f32le', '-'
  ]
}

/** Raw samples run through ffmpeg filters, at whisper's rate in one channel, through a scratch file. */
async function filtered(samples: Float32Array, filters: string, scratch: string, signal?: AbortSignal): Promise<Float32Array> {
  await writeFile(scratch, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
  try {
    const parts: Float32Array[] = []
    const reader = new Samples()
    await streamFfmpeg(['-f', 'f32le', '-ar', String(SPEECH_RATE), '-ac', '1', '-i', scratch, '-af', filters, '-f', 'f32le', '-'], (chunk) => parts.push(reader.take(chunk)), signal)
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  } finally {
    await rm(scratch, { force: true })
  }
}

/**
 * Mix the clips heard into `output`, one channel of 16-bit samples at 16 kHz,
 * levelled: each file read once, its clips laid in where they are heard, the
 * clips at a speed stretched by ffmpeg first, then the whole levelled in one
 * pass. `onProgress` hears the share done.
 */
export async function mixClips(
  clips: Listened[],
  output: string,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}
): Promise<void> {
  const files = [...new Set(clips.map((c) => c.path))].map((path) => ({ path, laid: clips.filter((c) => c.path === path).map(laidOut) }))
  // Room for every clip, a stretched one with some to spare: the mix is cut to what was laid.
  const room = Math.max(1, ...files.flatMap((f) => f.laid.map((l) => l.at + Math.ceil((l.to - l.from) / l.speed) + SPEECH_RATE)))
  let mix = new Float32Array(room)
  const needed = files.reduce((n, f) => n + Math.max(...f.laid.map((l) => l.to)), 0)
  let read = 0
  let end = 0
  const later: { laid: Laid; samples: Float32Array }[] = []
  for (const f of files) {
    const toSample = Math.max(...f.laid.map((l) => l.to))
    const layer = new Layer(f.laid, mix)
    const reader = new Samples()
    let at = 0
    await streamFfmpeg(
      decodeArgs(f.path, toSample),
      (chunk) => {
        const samples = reader.take(chunk)
        layer.add(samples, at)
        at += samples.length
        read += samples.length
        opts.onProgress?.(Math.min(0.9, (0.9 * read) / Math.max(1, needed)))
      },
      opts.signal
    )
    end = Math.max(end, layer.end)
    later.push(...layer.kept())
  }
  for (const [i, k] of later.entries()) {
    const heard = await filtered(k.samples, `${tempoFilters(k.laid.speed)},volume=${level(k.laid.gain)}`, `${output}.${i}.raw`, opts.signal)
    if (k.laid.at + heard.length > mix.length) {
      const grown = new Float32Array(k.laid.at + heard.length)
      grown.set(mix)
      mix = grown
    }
    for (let j = 0; j < heard.length; j++) mix[k.laid.at + j]! += heard[j]!
    end = Math.max(end, k.laid.at + heard.length)
  }
  const raw = `${output}.raw`
  await writeFile(raw, Buffer.from(mix.buffer, 0, Math.max(1, end) * 4))
  try {
    await runFfmpeg(
      ['-f', 'f32le', '-ar', String(SPEECH_RATE), '-ac', '1', '-i', raw, '-af', SPEECH_LEVEL, '-c:a', 'pcm_s16le', '-ar', String(SPEECH_RATE), '-ac', '1', '-y', output],
      opts.signal ? { signal: opts.signal } : {}
    )
  } finally {
    await rm(raw, { force: true })
  }
  opts.onProgress?.(1)
}

/**
 * How whisper-cli is run: English, the full JSON with every token's time,
 * token times from DTW, which needs flash attention off, and its progress,
 * written beside `outBase` as `outBase.json`.
 *
 * `dtw` names the model being run, and comes with the model rather than being
 * written here: the alignment heads belong to one model, and a preset naming a
 * different one puts every word time in the wrong place.
 *
 * `-sns` suppresses the non-speech tokens. Without it, on a recording with
 * game sound or music under the talking, whisper writes what it heard as a
 * sound event, `[I'm not sure what he's doing here]`, and a whole sentence in
 * brackets reads as a noise rather than as words. With it, the same audio
 * comes back as speech.
 */
export function whisperArgs(model: string, dtw: string, wav: string, outBase: string, threads: number): string[] {
  return ['-m', model, '-f', wav, '-l', 'en', '-ojf', '-dtw', dtw, '-nfa', '-sns', '-t', String(threads), '-pp', '-of', outBase]
}

/** How far whisper says it has got, from what it printed, or null when it has not said. */
export function parseWhisperProgress(text: string): number | null {
  const all = [...text.matchAll(/progress\s*=\s*(\d+)\s*%/g)]
  const last = all.at(-1)
  return last ? Math.min(1, Number(last[1]) / 100) : null
}

/** How the engine is started: the program, anything before its own arguments, and its environment. */
export interface SpeechRunner {
  command: string
  prefix: string[]
  env?: NodeJS.ProcessEnv
}

/** Every core but one, so the window stays responsive. */
export function speechThreads(): number {
  return Math.max(1, availableParallelism() - 1)
}

/** The mix takes a small share of the work; whisper the rest. */
const MIX_SHARE = 0.1

/**
 * Mix a sequence's heard sound on the tracks chosen into `output`, one
 * channel at 16 kHz, its filter graph written beside it. `onProgress` hears
 * the share of the sequence mixed so far.
 */
export async function makeMix(
  timeline: Timeline,
  trackIds: string[],
  output: string,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}
): Promise<void> {
  const clips = listened(timeline, trackIds)
  if (clips.length === 0) throw new SpeechError('Nothing is heard on the tracks chosen.')
  for (const c of clips) {
    if (await exists(c.path)) continue
    // A copy is missing while a cleared cache is rebuilt; a recording, when its drive is not there or it has moved.
    throw new SpeechError(
      c.copy ? `${c.label} is not ready yet. Try again once it has been prepared.` : `${c.label} cannot be found. Find it in the bin, then try again.`
    )
  }
  await mixClips(clips, output, opts)
}

/**
 * Listen to a sequence's sound on the tracks chosen and give back every word
 * heard, at its frames. Everything it writes goes in `scratchDir`, which is
 * removed however it ends.
 */
export async function transcribe(opts: {
  timeline: Timeline
  trackIds: string[]
  runner: SpeechRunner
  model: string
  /** The `-dtw` preset for that model, which has to name it. */
  dtw: string
  scratchDir: string
  onProgress: (fraction: number) => void
  signal?: AbortSignal
}): Promise<TimedWord[]> {
  const signal = opts.signal ? { signal: opts.signal } : {}
  await mkdir(opts.scratchDir, { recursive: true })
  try {
    const wav = join(opts.scratchDir, 'mix.wav')
    opts.onProgress(0)
    await makeMix(opts.timeline, opts.trackIds, wav, { onProgress: (f) => opts.onProgress(MIX_SHARE * f), ...signal })
    opts.onProgress(MIX_SHARE)

    const outBase = join(opts.scratchDir, 'words')
    let printed = ''
    await capture(opts.runner.command, [...opts.runner.prefix, ...whisperArgs(opts.model, opts.dtw, wav, outBase, speechThreads())], {
      collectStdout: false,
      onStderr: (chunk) => {
        printed = (printed + chunk.toString()).slice(-200)
        const done = parseWhisperProgress(printed)
        if (done !== null) opts.onProgress(MIX_SHARE + (1 - MIX_SHARE) * done)
      },
      ...(opts.runner.env ? { env: opts.runner.env } : {}),
      ...signal
    })
    const text = (await readFile(`${outBase}.json`)).toString('latin1')
    return wordsToFrames(readWhisperJson(text), opts.timeline.fps)
  } finally {
    await rm(opts.scratchDir, { recursive: true, force: true })
  }
}
