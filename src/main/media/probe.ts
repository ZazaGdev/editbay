import { runFfprobe } from '../ffmpeg/run'
import type { Chapter } from '../../shared/markers'

export type { Chapter }

export interface VideoStreamInfo {
  codec: string
  width: number
  height: number
  pixFmt: string
  bitDepth: number
  colorTransfer: string | null
  /** The matrix its colours were made with, as the file says, or null when it says nothing. */
  colorSpace: string | null
  /** How wide a pixel is against its height, 1 for square, as the file says; 1 when it says nothing. */
  pixelAspect?: number
  nominalFps: number
  averageFps: number
  rotationDeg: number
}

export interface AudioStreamInfo {
  codec: string
  sampleRate: number
  channels: number
}

export interface ProbeResult {
  path: string
  durationSec: number
  /**
   * Where the file's earliest stream starts, which is where ffmpeg counts its
   * time from. Not always 0: AAC sound usually starts a few milliseconds
   * before the picture. The preview counts from 0, so it needs this to agree.
   */
  startSec: number
  /** ffprobe's name for the container, such as `mpegts` or `mov,mp4,m4a,3gp,3g2,mj2`. Absent when not read. */
  container?: string
  video: VideoStreamInfo
  /** The first audio track, the one that plays. */
  audio: AudioStreamInfo | null
  /** How many audio tracks the file has. OBS records up to six. */
  audioTracks: number
  /** Each audio track's name, as the file gives it in its title, '' where it gives none. */
  trackNames: string[]
  /** How many channels each audio track has, in order. */
  trackChannels: number[]
  /**
   * Chapters the file carries, earliest first. OBS writes one for every press
   * of its chapter hotkey, in its Hybrid MP4 format. Empty for a file with
   * none, which is most of them and is not a fault.
   */
  chapters: Chapter[]
}

/**
 * The chapters out of ffprobe's JSON.
 *
 * `start_time` is seconds as a string; `start` with `time_base` is the same in
 * the chapter's own units and is read when there is no `start_time`. Anything
 * without a readable start is not a chapter this can use.
 */
export function readChapters(json: unknown): Chapter[] {
  const root = json as { chapters?: Array<Record<string, any>> }
  const out: Chapter[] = []
  for (const c of root.chapters ?? []) {
    const fromString = Number(c.start_time)
    const base = parseRational(typeof c.time_base === 'string' ? c.time_base : undefined)
    const fromUnits = base > 0 ? Number(c.start) * base : Number.NaN
    const atSec = Number.isFinite(fromString) ? fromString : fromUnits
    if (!Number.isFinite(atSec) || atSec < 0) continue
    const title = c.tags?.title
    out.push({ atSec, title: typeof title === 'string' ? title.trim() : '' })
  }
  return out.sort((a, b) => a.atSec - b.atSec)
}

/** Parse an ffprobe rational such as "30000/1001". Returns 0 when undefined. */
export function parseRational(value: string | undefined): number {
  if (!value) return 0
  const [numText, denText] = value.split('/')
  const num = Number(numText)
  const den = Number(denText ?? '1')
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0
  return num / den
}

const DEPTH_SUFFIX = /(\d+)(le|be)$/

function bitDepthFromPixFmt(pixFmt: string): number {
  const m = pixFmt.match(DEPTH_SUFFIX)
  return m?.[1] ? Number(m[1]) : 8
}

function normaliseRotation(deg: number): number {
  const r = Math.round(deg / 90) * 90
  return ((r % 360) + 360) % 360
}

/** A stream's title, whatever case the container writes the tag in. */
function streamTitle(stream: Record<string, any>): string {
  const tags: Record<string, unknown> = stream.tags ?? {}
  const key = Object.keys(tags).find((k) => k.toLowerCase() === 'title')
  const value = key === undefined ? undefined : tags[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readRotation(stream: Record<string, any>): number {
  const sideData: Array<Record<string, any>> = stream.side_data_list ?? []
  for (const sd of sideData) {
    if (typeof sd.rotation === 'number') return normaliseRotation(sd.rotation)
  }
  const tag = stream.tags?.rotate
  if (tag !== undefined) return normaliseRotation(Number(tag))
  return 0
}

/** What the app needs to know about a sound file, which has no picture. */
export interface SoundProbe {
  path: string
  durationSec: number
  /** Where the file's time starts, as ffmpeg counts it. */
  startSec: number
  /** ffprobe's name for the container, such as `wav` or `mov,mp4,m4a,3gp,3g2,mj2`. */
  container: string
  /** The first audio track, the one that plays. */
  audio: AudioStreamInfo
  audioTracks: number
  trackNames: string[]
  /** How many channels each audio track has, in order. */
  trackChannels: number[]
}

/** A sound file's ffprobe JSON in the shape the rest of the app uses. */
export function parseSoundProbeJson(json: unknown, path: string): SoundProbe {
  const root = json as { streams?: Array<Record<string, any>>; format?: Record<string, any> }
  const audioStreams = (root.streams ?? []).filter((s) => s.codec_type === 'audio')
  const a = audioStreams[0]
  if (!a) throw new Error(`no video or sound in ${path}`)
  return {
    path,
    durationSec: Number(root.format?.duration ?? 0),
    startSec: Number.isFinite(Number(root.format?.start_time)) ? Number(root.format?.start_time) : 0,
    container: String(root.format?.format_name ?? ''),
    audio: { codec: a.codec_name ?? 'unknown', sampleRate: Number(a.sample_rate ?? 0), channels: Number(a.channels ?? 0) },
    audioTracks: audioStreams.length,
    trackNames: audioStreams.map(streamTitle),
    trackChannels: audioStreams.map((s) => Number(s.channels ?? 0))
  }
}

/** Whether ffprobe's JSON describes a file with a picture, as opposed to a sound file. */
export function hasVideoStream(json: unknown): boolean {
  const root = json as { streams?: Array<Record<string, any>> }
  return (root.streams ?? []).some((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
}

/** Turn ffprobe's JSON into the shape the rest of the app uses. */
export function parseProbeJson(json: unknown, path: string): ProbeResult {
  const root = json as { streams?: Array<Record<string, any>>; format?: Record<string, any> }
  const streams = root.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  if (!v) throw new Error(`no video stream in ${path}`)
  const audioStreams = streams.filter((s) => s.codec_type === 'audio')
  const a = audioStreams[0] ?? null

  const pixFmt: string = v.pix_fmt ?? 'yuv420p'
  const taggedDepth = Number(v.bits_per_raw_sample)

  return {
    path,
    durationSec: Number(root.format?.duration ?? 0),
    startSec: Number.isFinite(Number(root.format?.start_time)) ? Number(root.format?.start_time) : 0,
    container: String(root.format?.format_name ?? ''),
    video: {
      codec: v.codec_name ?? 'unknown',
      width: Number(v.width ?? 0),
      height: Number(v.height ?? 0),
      pixFmt,
      bitDepth: Number.isFinite(taggedDepth) && taggedDepth > 0 ? taggedDepth : bitDepthFromPixFmt(pixFmt),
      colorTransfer: v.color_transfer ?? null,
      colorSpace: v.color_space ?? null,
      pixelAspect: readPixelAspect(v.sample_aspect_ratio),
      nominalFps: parseRational(v.r_frame_rate),
      averageFps: parseRational(v.avg_frame_rate),
      rotationDeg: readRotation(v)
    },
    audio: a
      ? {
          codec: a.codec_name ?? 'unknown',
          sampleRate: Number(a.sample_rate ?? 0),
          channels: Number(a.channels ?? 0)
        }
      : null,
    audioTracks: audioStreams.length,
    trackNames: audioStreams.map(streamTitle),
    trackChannels: audioStreams.map((s) => Number(s.channels ?? 0)),
    chapters: readChapters(json)
  }
}

async function probeJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const stdout = await runFfprobe([
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    // OBS writes one chapter per press of its hotkey while recording. Asking
    // for them costs nothing on a file that has none.
    '-show_chapters',
    path
  ], signal)
  return JSON.parse(stdout) as unknown
}

/** Probe a real file on disk. */
export async function probeFile(path: string, signal?: AbortSignal): Promise<ProbeResult> {
  return parseProbeJson(await probeJson(path, signal), path)
}

/** The files taken to be pictures, by extension. A GIF is one too, moving or not. */
const STILL_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'])

/** Whether a file may be an animation, which only a GIF is here. */
export function isGifPath(path: string): boolean {
  return path.toLowerCase().endsWith('.gif')
}

/** A GIF's size, how many frames it has, and how long it runs. */
export async function probeAnimation(path: string, signal?: AbortSignal): Promise<{ width: number; height: number; frames: number; durationSec: number }> {
  const root = (await probeJson(path, signal)) as { streams?: Array<Record<string, any>>; format?: Record<string, any> }
  const v = (root.streams ?? []).find((s) => s.codec_type === 'video')
  if (!v || !(Number(v.width) > 0) || !(Number(v.height) > 0)) throw new Error(`no picture in ${path}`)
  const duration = Number(v.duration ?? root.format?.duration ?? 0)
  return { width: Number(v.width), height: Number(v.height), frames: Number(v.nb_frames ?? 1) || 1, durationSec: Number.isFinite(duration) ? duration : 0 }
}

/** Whether a file is a picture, judged by its name. */
export function isStillPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot >= 0 && STILL_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

/** A picture's size, as its first video stream gives it. */
export async function probeStill(path: string, signal?: AbortSignal): Promise<{ width: number; height: number; codec: string }> {
  const root = (await probeJson(path, signal)) as { streams?: Array<Record<string, any>> }
  const v = (root.streams ?? []).find((s) => s.codec_type === 'video')
  if (!v || !(Number(v.width) > 0) || !(Number(v.height) > 0)) throw new Error(`no picture in ${path}`)
  return { width: Number(v.width), height: Number(v.height), codec: String(v.codec_name ?? 'unknown') }
}

/** Probe a file that may be a recording or a sound file, and say which. */
export async function probeAny(
  path: string,
  signal?: AbortSignal
): Promise<{ kind: 'video'; probe: ProbeResult } | { kind: 'sound'; probe: SoundProbe }> {
  const json = await probeJson(path, signal)
  return hasVideoStream(json)
    ? { kind: 'video', probe: parseProbeJson(json, path) }
    : { kind: 'sound', probe: parseSoundProbeJson(json, path) }
}

/** Probe a sound file on disk. */
export async function probeSound(path: string, signal?: AbortSignal): Promise<SoundProbe> {
  return parseSoundProbeJson(await probeJson(path, signal), path)
}

/**
 * Whether a sound file plays as it is, in the preview and exactly where it
 * should when sought: WAV, and AAC in an MP4 container, as an M4A is. MP3
 * and the rest seek only roughly in a browser, which would put a song in the
 * preview out of step with the export, so they are converted.
 */
export function soundPlaysAsItIs(p: SoundProbe): boolean {
  const container = p.container.split(',')
  if (container.includes('wav')) return true
  return (container.includes('mp4') || container.includes('m4a') || container.includes('mov')) && p.audio.codec === 'aac'
}

export type ConformReason =
  | 'variable-frame-rate'
  | 'unsupported-codec'
  | 'high-bit-depth'
  | 'hdr-transfer'
  | 'rotation-metadata'
  | 'container'
  | 'non-square-pixels'

/** Codecs an HTML video element in Electron plays dependably. */
const PLAYABLE_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1'])

/**
 * Whether the window's player opens this container: MP4 and its family, and
 * Matroska and WebM, as OBS writes MKV. It has no MPEG-TS, FLV or AVI, which
 * OBS can also write, so such a file opened ready and showed black.
 */
export function playableContainer(container: string | undefined): boolean {
  if (container === undefined || container === '') return true
  const names = container.split(',')
  return names.includes('mp4') || names.includes('mov') || names.includes('matroska') || names.includes('webm')
}

/** A sample aspect ratio as ffprobe writes it, `16:15`, as a number; 1 for none, `0:1`, or anything unreadable. */
export function readPixelAspect(sar: unknown): number {
  const m = typeof sar === 'string' ? sar.match(/^(\d+):(\d+)$/) : null
  if (!m) return 1
  const [n, d] = [Number(m[1]), Number(m[2])]
  return n > 0 && d > 0 ? n / d : 1
}

/** Transfer characteristics that mean high dynamic range. */
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67'])

/**
 * Every reason this file must be conformed. An empty array means it is used
 * from its original location, untouched.
 *
 * A frame rate that differs from the project's is deliberately not a reason.
 * Frame rate is reconciled once, at render.
 */
export function conformReasons(probe: ProbeResult, isVariableFrameRate: boolean): ConformReason[] {
  const reasons: ConformReason[] = []
  if (isVariableFrameRate) reasons.push('variable-frame-rate')
  if (!PLAYABLE_CODECS.has(probe.video.codec)) reasons.push('unsupported-codec')
  if (probe.video.bitDepth > 8) reasons.push('high-bit-depth')
  if (probe.video.colorTransfer && HDR_TRANSFERS.has(probe.video.colorTransfer)) reasons.push('hdr-transfer')
  if (probe.video.rotationDeg !== 0) reasons.push('rotation-metadata')
  if (!playableContainer(probe.container)) reasons.push('container')
  // A pixel wider or narrower than it is tall, as DV and some camcorders
  // record: the preview and the export stretch it differently, so a crop
  // landed in different places. Made square once, on the way in.
  if (Math.abs((probe.video.pixelAspect ?? 1) - 1) > 0.01) reasons.push('non-square-pixels')
  return reasons
}
