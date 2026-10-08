import { capture, captureText, type SpawnOptions, type SpawnResult } from './spawn'
import { ffmpegPath, ffprobePath } from './locate'

export interface ProgressUpdate {
  timeMs?: number
  speed?: number
  done: boolean
}

/** Parse `-progress pipe:1` output. Later values win, so a chunk of several blocks reports the newest. */
export function parseProgressChunk(chunk: string): ProgressUpdate {
  const out: ProgressUpdate = { done: false }
  for (const line of chunk.split('\n')) {
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key === 'out_time_us') {
      const n = Number(value)
      if (Number.isFinite(n)) out.timeMs = Math.round(n / 1000)
    } else if (key === 'speed') {
      const n = Number(value.replace('x', ''))
      if (Number.isFinite(n)) out.speed = n
    } else if (key === 'progress' && value === 'end') {
      out.done = true
    }
  }
  return out
}

/**
 * The kinds of file ffmpeg and ffprobe may read a file you brought in as
 * (audit 2026-10-01): video, sound and pictures, by their demuxers' names.
 * Without a list, a playlist named like a video was read as one, and sent
 * ffprobe to whatever computer it named, which Windows signs in to as you.
 */
export const MEDIA_FORMATS = [
  'mov', 'matroska', 'webm', 'avi', 'flv', 'mpegts', 'mpeg', 'asf', 'mxf', 'm4v', 'h264', 'hevc',
  'wav', 'w64', 'mp3', 'aac', 'flac', 'ogg', 'aiff', 'caf',
  'image2', 'png_pipe', 'jpeg_pipe', 'webp_pipe', 'bmp_pipe', 'tiff_pipe', 'gif'
].join(',')

/**
 * Arguments with the list put before every input that does not name its own
 * kind: one that does, `-f lavfi` or `-f concat`, is one the app made itself.
 */
export function withMediaFormats(args: readonly string[]): string[] {
  const out: string[] = []
  let named = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '-f' && args[i + 1] !== undefined && args.indexOf('-i', i) > i) named = true
    if (a === '-i') {
      if (!named) out.push('-format_whitelist', MEDIA_FORMATS)
      named = false
    }
    out.push(a)
  }
  return out
}

export interface RunOptions {
  onProgress?: (u: ProgressUpdate) => void
  signal?: AbortSignal
  /** The folder ffmpeg runs in, which relative paths in its filters are read from. */
  cwd?: string
}

/**
 * How long ffmpeg may go without a word of progress before it is taken to
 * have hung, on a share that stopped answering or a damaged file: it reports
 * twice a second while it works, however slow the work. Without this, a copy
 * made in the background could wait for ever, and everything waiting on it
 * with it (audit 2026-10-01).
 */
export const FFMPEG_STALL_MS = 5 * 60_000

/** Thrown when ffmpeg went quiet for too long and was stopped. */
export class FfmpegStalled extends Error {
  constructor() {
    super('ffmpeg stopped making progress for five minutes, so it was stopped.')
    this.name = 'FfmpegStalled'
  }
}

/** Run ffmpeg with progress reporting. Rejects with a ProcessError carrying the tail of stderr. */
export async function runFfmpeg(args: string[], opts: RunOptions & { stallMs?: number } = {}): Promise<void> {
  const full = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1', ...withMediaFormats(args)]
  const stop = new AbortController()
  const outer = opts.signal
  const passOn = (): void => stop.abort()
  if (outer?.aborted) stop.abort()
  outer?.addEventListener('abort', passOn, { once: true })
  let stalled = false
  const stallMs = opts.stallMs ?? FFMPEG_STALL_MS
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const heard = (): void => {
    if (watchdog !== undefined) clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      stalled = true
      stop.abort()
    }, stallMs)
  }
  const spawnOpts: SpawnOptions = {
    collectStdout: false,
    signal: stop.signal,
    ...(opts.cwd ? { cwd: opts.cwd } : {})
  }
  const onProgress = opts.onProgress
  spawnOpts.onStdout = (chunk) => {
    heard()
    if (onProgress) onProgress(parseProgressChunk(chunk.toString()))
  }
  heard()
  try {
    await capture(ffmpegPath, full, spawnOpts)
  } catch (err) {
    if (stalled) throw new FfmpegStalled()
    throw err
  } finally {
    if (watchdog !== undefined) clearTimeout(watchdog)
    outer?.removeEventListener('abort', passOn)
  }
}

/**
 * Run ffmpeg and return what it said on stderr, for a pass whose result is
 * printed rather than written to a file.
 *
 * `runFfmpeg` sets `-loglevel error` and throws stderr away when the run
 * succeeds, which is right for everything that produces a file. A `loudnorm`
 * measuring pass prints its figures at info level and produces nothing else,
 * so it needs its own way in. Only the tail of stderr is kept, which is where
 * those figures are.
 */
export async function measureFfmpeg(args: string[], opts: RunOptions = {}): Promise<string> {
  const full = ['-hide_banner', '-nostdin', '-loglevel', 'info', '-progress', 'pipe:1', ...withMediaFormats(args)]
  const spawnOpts: SpawnOptions = {
    collectStdout: false,
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.cwd ? { cwd: opts.cwd } : {})
  }
  if (opts.onProgress) {
    const onProgress = opts.onProgress
    spawnOpts.onStdout = (chunk) => onProgress(parseProgressChunk(chunk.toString()))
  }
  return (await capture(ffmpegPath, full, spawnOpts)).stderr
}

/**
 * How long one ffprobe may take. Reading a file's header or its first few
 * hundred packets takes well under a second, even from a slow share; one that
 * is still going after this has hung on a damaged file or a share that stopped
 * answering, and would otherwise hold up every import queued behind it.
 */
export const FFPROBE_TIMEOUT_MS = 30_000

/** Run ffprobe and return its stdout. Used for JSON and CSV output alike. */
export function runFfprobe(args: string[], signal?: AbortSignal): Promise<string> {
  return captureText(ffprobePath, ['-hide_banner', '-format_whitelist', MEDIA_FORMATS, ...args], { timeoutMs: FFPROBE_TIMEOUT_MS, ...(signal ? { signal } : {}) })
}

/**
 * Run ffmpeg and keep what it wrote, for a frame or a few read straight into
 * memory. Every input is limited to the kinds of media `withMediaFormats`
 * allows: two detectors that ran ffmpeg on their own read a playlist beside a
 * crafted project, which sent ffmpeg to the computer it named (audit 2026-10-08).
 */
export function captureFfmpeg(args: string[], opts: SpawnOptions = {}): Promise<SpawnResult> {
  return capture(ffmpegPath, withMediaFormats(args), opts)
}

/** Run ffmpeg and hand its stdout over a chunk at a time, keeping none of it. */
export async function streamFfmpeg(args: string[], onStdout: (chunk: Buffer) => void, signal?: AbortSignal): Promise<void> {
  const full = ['-hide_banner', '-nostdin', '-loglevel', 'error', ...withMediaFormats(args)]
  await capture(ffmpegPath, full, { collectStdout: false, onStdout, ...(signal ? { signal } : {}) })
}
