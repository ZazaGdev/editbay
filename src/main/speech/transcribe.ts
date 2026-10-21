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
import { runFfmpeg } from '../ffmpeg/run'
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
 * The filter graph that mixes the clips heard, and the files it reads, one
 * input each however many clips are cut from it: each file's first audio
 * stream is decoded once, at whisper's rate in one channel, and split. Each
 * clip is its stretch of that, counted in samples from where the file's time
 * starts, as the export counts it, so a sound that starts a little after its
 * picture keeps that gap and its words are not heard early. Each is set to its
 * level and delayed to where it starts in the sequence; they are summed, as
 * the export's sound is, never averaged.
 */
export function mixGraph(clips: Listened[]): { inputs: string[]; graph: string } {
  const inputs = [...new Set(clips.map((c) => c.path))]
  const parts: string[] = []
  const branch = new Map<string, number>()
  const labels = clips.map((c, i) => {
    const k = inputs.indexOf(c.path)
    const j = branch.get(c.path) ?? 0
    branch.set(c.path, j + 1)
    const from = Math.round(c.fromSec * SPEECH_RATE)
    const speed = c.speed ?? 1
    const to = from + Math.max(1, Math.round(c.lengthSec * speed * SPEECH_RATE))
    const delay = Math.round(c.atSec * SPEECH_RATE)
    parts.push(
      `[i${k}_${j}]atrim=start_sample=${from}:end_sample=${to},asetpts=PTS-STARTPTS,${speed !== 1 ? `${tempoFilters(speed)},` : ''}volume=${level(c.gain)}` +
        `${delay > 0 ? `,adelay=${delay}S:all=1` : ''}[m${i}]`
    )
    return `[m${i}]`
  })
  const heads = inputs.map((path, k) => {
    const n = clips.filter((c) => c.path === path).length
    const outs = Array.from({ length: n }, (_, j) => `[i${k}_${j}]`).join('')
    return `[${k}:a:0]aresample=${SPEECH_RATE}:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=mono,${n > 1 ? `asplit=${n}` : 'anull'}${outs}`
  })
  const summed = labels.length > 1 ? `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[sum]` : `${labels[0]}anull[sum]`
  return { inputs, graph: [...heads, ...parts, summed, `[sum]${SPEECH_LEVEL}[out]`].join(';\n') }
}

/** The command that makes the mix, its filter graph read from a file: a long cut is too long a graph for a command line. */
export function mixArgs(inputs: string[], graphPath: string, output: string): string[] {
  return [
    ...inputs.flatMap((path) => ['-i', path]),
    '-/filter_complex', graphPath,
    '-map', '[out]',
    '-c:a', 'pcm_s16le',
    '-ar', String(SPEECH_RATE),
    '-ac', '1',
    '-y', output
  ]
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
  const { inputs, graph } = mixGraph(clips)
  const graphPath = `${output}.txt`
  await writeFile(graphPath, graph)
  const totalMs = Math.max(1, ...clips.map((c) => (c.atSec + c.lengthSec) * 1000))
  const onProgress = opts.onProgress
  try {
    await runFfmpeg(mixArgs(inputs, graphPath, output), {
      ...(onProgress ? { onProgress: (u) => u.timeMs !== undefined && onProgress(Math.min(1, u.timeMs / totalMs)) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {})
    })
  } finally {
    await rm(graphPath, { force: true })
  }
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
