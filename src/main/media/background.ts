import { captureFfmpeg } from '../ffmpeg/run'
import { backgroundOfEdges, plainOfEdges } from '../../shared/effects'
import type { BackgroundColour, FoundBackground } from '../../shared/looks'

/** How small the frame is read: enough to tell its edges' colour, and quick. */
const SIDE = 16

/**
 * Whether a file stands on a green, blue or black background, read from the
 * edges of a frame half a second after `from` seconds, or the frame at `from`
 * when it is shorter (plan 90). Null for anything else, or a file that cannot
 * be read. A picture's clear pixels count as no background: it needs none
 * taken out.
 */
export async function detectBackground(path: string, from = 0): Promise<BackgroundColour | null> {
  const frame = await smallFrame(path, from)
  return frame ? backgroundOfEdges(frame, SIDE) : null
}

/**
 * The background Remove background takes out (plan 98): green, blue or black
 * as `detectBackground` finds them, or else any other plain colour nearly all
 * of the edge is. Null for a busy background or a file that cannot be read.
 * The effects library keeps to the three: an effect on white is meant to be.
 */
export async function detectRemovable(path: string, from = 0): Promise<FoundBackground | null> {
  const frame = await smallFrame(path, from)
  if (!frame) return null
  const colour = backgroundOfEdges(frame, SIDE)
  if (colour) return { colour }
  const rgb = plainOfEdges(frame, SIDE)
  return rgb ? { colour: 'plain', rgb } : null
}

/** A frame half a second after `from`, or at `from` when that cannot be read, shrunk to SIDE square as RGBA. */
async function smallFrame(path: string, from: number): Promise<Uint8Array | null> {
  for (const at of [String(from + 0.5), String(from)]) {
    try {
      const { stdout } = await captureFfmpeg([
        '-v', 'error', '-ss', at, '-i', path, '-frames:v', '1',
        '-vf', `scale=${SIDE}:${SIDE}:flags=area,format=rgba`, '-f', 'rawvideo', 'pipe:1'
      ])
      if (stdout.length >= SIDE * SIDE * 4) return stdout
    } catch {
      // Too short to seek into, or not a picture at all: try the first frame, then give up.
    }
  }
  return null
}
