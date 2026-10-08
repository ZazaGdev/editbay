import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runFfmpeg } from '../ffmpeg/run'
import { scratchPath, commitScratch } from './cache'
import { cappedSize } from './conform'
import { filmstripLayout, tileHeight } from '../../shared/filmstrip'
import { STILL_SEC } from '../../shared/project'

/**
 * A picture made ready for editing: the one file both the preview and the
 * export read it from.
 *
 * Made upright, because ffmpeg turns a phone photo the way its EXIF says and
 * so does Chromium, but ffprobe reports the size it was stored at. Read from
 * a copy that is already upright, all three agree on its shape. Within the
 * same size cap as a recording, since nothing is exported bigger, and a PNG
 * so its transparency comes with it.
 */
export function stillArgs(input: string, output: string, width: number, height: number): string[] {
  const { w, h } = cappedSize(width, height)
  const scale = w !== width || h !== height ? `scale=${w}:${h}:flags=lanczos,` : ''
  return ['-i', input, '-frames:v', '1', '-vf', `${scale}format=rgba`, '-f', 'image2', '-c:v', 'png', '-y', output]
}

/**
 * A picture's filmstrip: the picture, as a tile, repeated in the sprite
 * layout a source of its nominal length has, so everything that reads a
 * filmstrip reads this one unchanged. Its transparent parts show over black,
 * as they do on V1.
 */
export function stillFilmstripArgs(input: string, output: string, width: number, height: number): string[] {
  const layout = filmstripLayout(STILL_SEC)
  const tileH = tileHeight(layout.tileWidth, width, height)
  return [
    '-i',
    input,
    '-filter_complex',
    `color=c=black:s=${layout.tileWidth}x${tileH}[bg];` +
      `[0:v]scale=${layout.tileWidth}:${tileH},format=rgba[p];` +
      `[bg][p]overlay=shortest=1,loop=loop=${layout.tileCount - 1}:size=1:start=0,tile=${layout.cols}x${layout.rows}`,
    '-frames:v',
    '1',
    '-q:v',
    '4',
    '-y',
    output
  ]
}

async function writeWith(args: (scratch: string) => string[], output: string, signal?: AbortSignal): Promise<void> {
  await mkdir(dirname(output), { recursive: true })
  const scratch = scratchPath(output)
  try {
    await runFfmpeg(args(scratch), signal ? { signal } : {})
    await commitScratch(scratch, output)
  } catch (err) {
    await rm(scratch, { force: true })
    throw err
  }
}

/** Write a picture's upright copy into the cache. */
export async function makeStill(input: string, output: string, width: number, height: number, signal?: AbortSignal): Promise<void> {
  await writeWith((scratch) => stillArgs(input, scratch, width, height), output, signal)
}

/** Write a picture's filmstrip into the cache, from its upright copy. */
export async function extractStillFilmstrip(
  input: string,
  output: string,
  width: number,
  height: number,
  signal?: AbortSignal
): Promise<void> {
  await writeWith((scratch) => stillFilmstripArgs(input, scratch, width, height), output, signal)
}

/** The fewest and most frames a second an animation is unpacked at, and the most frames it keeps. A slow GIF keeps its own rate: two frames a second is two frames. */
export const ANIMATION_MIN_RATE = 0.1
export const ANIMATION_MAX_RATE = 30
export const ANIMATION_MAX_FRAMES = 600

/**
 * The steady rate an animation is unpacked at: its own frames over its own
 * length, which is what a GIF's varying delays average to, held to a range a
 * video frame rate can show. 10 when the file does not say.
 */
export function animationRate(frames: number, durationSec: number): number {
  const rate = frames / durationSec
  if (!Number.isFinite(rate) || rate <= 0) return 10
  return Math.round(Math.min(ANIMATION_MAX_RATE, Math.max(ANIMATION_MIN_RATE, rate)) * 1000) / 1000
}

/**
 * An animation unpacked into numbered PNGs at a steady rate, `0001.png` on,
 * upright, within the size cap, with their transparency.
 */
export function unpackArgs(input: string, pattern: string, rate: number, width: number, height: number): string[] {
  const { w, h } = cappedSize(width, height)
  const scale = w !== width || h !== height ? `,scale=${w}:${h}:flags=lanczos` : ''
  return [
    '-i', input,
    '-vf', `fps=${rate}${scale},format=rgba`,
    '-frames:v', String(ANIMATION_MAX_FRAMES),
    '-start_number', '1',
    '-f', 'image2', '-c:v', 'png',
    '-y', pattern
  ]
}

/** Unpack an animation into a folder of its own. Written to a scratch folder first, so a half-made one is never taken for done. */
export async function unpackAnimation(
  input: string,
  dir: string,
  rate: number,
  width: number,
  height: number,
  signal?: AbortSignal
): Promise<number> {
  const scratch = `${dir}.part`
  await rm(scratch, { recursive: true, force: true })
  await mkdir(scratch, { recursive: true })
  try {
    await runFfmpeg(unpackArgs(input, join(scratch, '%04d.png'), rate, width, height), signal ? { signal } : {})
    await rm(dir, { recursive: true, force: true })
    await rename(scratch, dir)
  } catch (err) {
    await rm(scratch, { recursive: true, force: true })
    throw err
  }
  return countFrames(dir)
}

/** How many numbered frames a folder holds. */
export async function countFrames(dir: string): Promise<number> {
  try {
    return (await readdir(dir)).filter((f) => /^\d{4}\.png$/.test(f)).length
  } catch {
    return 0
  }
}
