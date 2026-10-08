import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { runFfmpeg } from '../ffmpeg/run'
import { scratchPath, commitScratch } from './cache'
import { filmstripLayout, type FilmstripLayout } from '../../shared/filmstrip'

// The layout lives in shared, because the timeline needs it to work out which
// tile of the sprite belongs at a given moment.
export { filmstripLayout }
export type { FilmstripLayout }

/**
 * How far apart the tiles must be before only keyframes are decoded for them.
 *
 * Decoding every frame of a long 4K recording to keep one in a few hundred is
 * most of the cost of an import after the conform; decoding only keyframes
 * measured five times faster. But a tile can then only show the last keyframe
 * at or before the frame it would otherwise show, and x264's default puts one
 * about every 8 seconds at 30 fps, so tiles closer together than that would
 * show the same picture twice. Conformed copies have one every second, which
 * any spacing here clears, and a tile at least 10 seconds wide moved back by
 * a keyframe's distance still shows the stretch it stands for.
 */
export const KEYFRAME_TILE_INTERVAL_SEC = 10

export function filmstripArgs(
  input: string,
  output: string,
  layout: FilmstripLayout,
  keyframesOnly = layout.intervalSec >= KEYFRAME_TILE_INTERVAL_SEC
): string[] {
  const fps = 1 / layout.intervalSec
  // With only keyframes, the last one has nothing after it to show where it
  // ends, and the fps filter drops it at the end unless told to pass it on,
  // which would leave the last tile black.
  const eof = keyframesOnly ? ':eof_action=pass' : ''
  return [
    ...(keyframesOnly ? ['-skip_frame', 'nokey'] : []),
    '-i',
    input,
    '-vf',
    `fps=${fps.toFixed(6)}${eof},scale=${layout.tileWidth}:-2,tile=${layout.cols}x${layout.rows}`,
    '-frames:v',
    '1',
    '-q:v',
    '4',
    '-y',
    output
  ]
}

/** Extract a filmstrip sprite into the cache. */
export async function extractFilmstrip(input: string, output: string, durationSec: number, signal?: AbortSignal): Promise<void> {
  await mkdir(dirname(output), { recursive: true })
  const scratch = scratchPath(output)
  try {
    await runFfmpeg(filmstripArgs(input, scratch, filmstripLayout(durationSec)), signal ? { signal } : {})
    await commitScratch(scratch, output)
  } catch (err) {
    await rm(scratch, { force: true })
    throw err
  }
}
