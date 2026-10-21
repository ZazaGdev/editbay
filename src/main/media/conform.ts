import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProbeResult } from './probe'
import { runFfmpeg } from '../ffmpeg/run'
import { scratchPath, commitScratch } from './cache'
import { toStereo } from '../../shared/sound'
import { BT601_TO_709, isBt601 } from '../../shared/colour-space'
import { RECORDING_BT709 } from '../../shared/render-pictures'

const RESOLUTION_CAP = 3840
const STANDARD_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60]
const MAX_RATE = 120
const DEFAULT_RATE = 30

/** Fit a frame inside the resolution cap, keeping aspect and even dimensions. */
export function cappedSize(width: number, height: number, cap = RESOLUTION_CAP): { w: number; h: number } {
  const longest = Math.max(width, height)
  const scale = longest > cap ? cap / longest : 1
  const even = (n: number): number => Math.max(2, Math.round((n * scale) / 2) * 2)
  return { w: even(width), h: even(height) }
}

/**
 * The constant rate to conform this file to: its own, not the project's.
 *
 * Recorders that write variable files usually report a nominal rate of 1000,
 * so a nominal rate above the sane maximum is discarded in favour of the average.
 */
export function targetFrameRate(probe: ProbeResult): number {
  const { nominalFps, averageFps } = probe.video
  let rate = nominalFps > 0 && nominalFps <= MAX_RATE ? nominalFps : averageFps
  if (!(rate > 0)) rate = DEFAULT_RATE
  rate = Math.min(rate, MAX_RATE)
  for (const standard of STANDARD_RATES) {
    if (Math.abs(rate - standard) < 0.01) return standard
  }
  return rate
}

function formatRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(3)
}

/** Whether a recording's matrix is BT.709 or not said at all, so its frames may be said to be BT.709. */
function saysNoOtherMatrix(colorSpace: string | null | undefined): boolean {
  return colorSpace === null || colorSpace === undefined || ['', 'unknown', 'unspecified', 'reserved', 'bt709'].includes(colorSpace)
}

/** Whether a recording is HDR, by its transfer: PQ or HLG. */
function isHdr(probe: ProbeResult): boolean {
  return probe.video.colorTransfer === 'smpte2084' || probe.video.colorTransfer === 'arib-std-b67'
}

function videoFilters(probe: ProbeResult, hasZscale: boolean): string {
  const filters: string[] = []
  // Its frames said to be BT.709 first, as the export says of them, when its
  // header names no other matrix. `-colorspace bt709` below is not enough for
  // one that names its primaries and leaves the matrix unspecified: the
  // header wins, and ffmpeg 9 converted it as BT.601 into the copy the
  // preview plays, so the shift was never seen (audit 2026-10-19).
  if (!isHdr(probe) && saysNoOtherMatrix(probe.video.colorSpace)) filters.push(RECORDING_BT709)
  // Pixels made square by widening or narrowing the picture, so its width
  // and height are what it shows; then capped as any picture is.
  const aspect = probe.video.pixelAspect ?? 1
  const shownW = Math.abs(aspect - 1) > 0.01 ? Math.round((probe.video.width * aspect) / 2) * 2 : probe.video.width
  const { w, h } = cappedSize(shownW, probe.video.height)
  if (w !== probe.video.width || h !== probe.video.height) {
    filters.push(`scale=${w}:${h}:flags=lanczos`, 'setsar=1')
  }
  if (isHdr(probe) && hasZscale) {
    filters.push('zscale=t=linear:npl=100', 'tonemap=tonemap=hable:desat=0', 'zscale=p=bt709:t=bt709:m=bt709')
  }
  // Colours made by the older SD matrix turned into BT.709's, which the
  // export and a player both read the conformed file by (audit 2026-10-01).
  if (isBt601(probe.video.colorSpace)) filters.push(BT601_TO_709)
  filters.push('format=yuv420p')
  return filters.join(',')
}

export interface ConformArgsInput {
  probe: ProbeResult
  output: string
  hasZscale: boolean
}

/**
 * The full ffmpeg argument list for conforming one file.
 *
 * Rotation needs no handling here: ffmpeg applies a display matrix while
 * decoding by default, so re-encoding bakes the rotation into the pixels and
 * the output carries no rotation metadata.
 */
export function conformArgs({ probe, output, hasZscale }: ConformArgsInput): string[] {
  const rate = targetFrameRate(probe)
  const gop = String(Math.max(1, Math.round(rate)))
  return [
    // Read as BT.709, as the export reads it: ffmpeg 9 converts a picture that
    // says nothing into the matrix written below as if it were BT.601 (plan 89).
    // Not an HDR one, whose tone mapping reads its real colours.
    ...(isHdr(probe) ? [] : ['-colorspace', 'bt709']),
    '-i',
    probe.path,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    videoFilters(probe, hasZscale),
    // One channel to both sides at its own level, as a player plays it.
    ...(probe.audio ? ['-af', toStereo(probe.audio.channels)] : []),
    '-fps_mode',
    'cfr',
    '-r',
    formatRate(rate),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '16',
    '-x264-params',
    'scenecut=0',
    '-g',
    gop,
    '-keyint_min',
    gop,
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    // Said in the file, so a player does not guess BT.601 for a small picture.
    '-colorspace',
    'bt709',
    '-movflags',
    '+faststart',
    '-y',
    output
  ]
}

/**
 * A file the player only cannot open, as an OBS recording in MPEG-TS or FLV
 * is, put into an MP4 as it is: its picture copied, not encoded again, so it
 * takes seconds and loses nothing, and its first sound made AAC, which MP4
 * holds dependably, one channel spread to both sides.
 */
export function rewrapArgs(probe: ProbeResult, output: string): string[] {
  return [
    '-i', probe.path,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'copy',
    ...(probe.audio ? ['-af', toStereo(probe.audio.channels), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : []),
    '-movflags', '+faststart',
    '-y', output
  ]
}

/**
 * Converting a sound file that does not play dependably as it is into an M4A:
 * its first audio track, as AAC at the settings a conformed file's sound has.
 */
export function soundConformArgs(input: string, output: string, channels?: number): string[] {
  return [
    '-i', input,
    '-map', '0:a:0',
    '-vn',
    '-af', toStereo(channels),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
    '-y', output
  ]
}

/** Convert one sound file into the cache, by way of a scratch name. */
export async function conformSound(
  input: string,
  output: string,
  durationSec: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
  channels?: number
): Promise<void> {
  await mkdir(dirname(output), { recursive: true })
  const scratch = scratchPath(output)
  try {
    await runFfmpeg(soundConformArgs(input, scratch, channels), {
      onProgress: (u) => {
        if (u.timeMs !== undefined && durationSec > 0) onProgress?.(Math.min(1, u.timeMs / (durationSec * 1000)))
      },
      ...(signal ? { signal } : {})
    })
    await commitScratch(scratch, output)
  } catch (err) {
    await rm(scratch, { force: true })
    throw err
  }
}

export interface ConformOptions {
  probe: ProbeResult
  output: string
  hasZscale: boolean
  /** Only its kind of file is wrong: put it into an MP4 as it is, rather than encoding it again. */
  rewrapOnly?: boolean
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/**
 * Conform one file into the cache. Writes to a scratch name and renames on
 * success, so a cancelled or crashed run never leaves a file that looks done.
 */
export async function conformFile(opts: ConformOptions): Promise<void> {
  await mkdir(dirname(opts.output), { recursive: true })
  const scratch = scratchPath(opts.output)
  const totalMs = opts.probe.durationSec * 1000

  try {
    await runFfmpeg(opts.rewrapOnly ? rewrapArgs(opts.probe, scratch) : conformArgs({ probe: opts.probe, output: scratch, hasZscale: opts.hasZscale }), {
      onProgress: (u) => {
        if (u.timeMs !== undefined && totalMs > 0) {
          opts.onProgress?.(Math.min(1, u.timeMs / totalMs))
        }
      },
      ...(opts.signal ? { signal: opts.signal } : {})
    })
    await commitScratch(scratch, opts.output)
  } catch (err) {
    await rm(scratch, { force: true })
    throw err
  }
}
