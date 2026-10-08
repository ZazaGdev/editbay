import type { BackgroundColour, Rgb } from './looks'
import type { Timeline, TrackKind } from './project'
import { findClip } from './project'

/** Where an effect goes: dropped on a track at a frame, or over a clip. */
export type EffectPlace = { trackId: string; frame: number; newTrack?: TrackKind } | { clipId: string }

/**
 * The effects library (plan 90): what an effect's background is, read from a
 * small frame of it, and where an effect goes when it is put over a clip.
 */

/** What colour one pixel is, as a background: green, blue, black, clear, or none of them. */
function pixelKind(r: number, g: number, b: number, a: number): BackgroundColour | 'clear' | null {
  if (a < 128) return 'clear'
  if (Math.max(r, g, b) < 30) return 'black'
  if (g > 100 && g > r + 50 && g > b + 50) return 'green'
  if (b > 100 && b > r + 50 && b > g + 30) return 'blue'
  return null
}

/**
 * The background of a square RGBA frame `side` pixels across, from the
 * pixels round its edge: the colour most of them are, when nearly all are
 * the same one, and otherwise none. A picture clear round its edge has none
 * to take out.
 */
export function backgroundOfEdges(rgba: Uint8Array, side: number): BackgroundColour | null {
  const counts = new Map<string, number>()
  let total = 0
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (x !== 0 && y !== 0 && x !== side - 1 && y !== side - 1) continue
      const i = (y * side + x) * 4
      const kind = pixelKind(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, rgba[i + 3]!) ?? 'none'
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
      total += 1
    }
  }
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['none', 0]
  if (n < total * 0.8 || best === 'none' || best === 'clear') return null
  return best as BackgroundColour
}

/** How close, as an average over red, green and blue in levels, an edge pixel is to count as the plain colour. */
const PLAIN_NEAR = 20

/**
 * The plain colour round the edge of a square RGBA frame `side` pixels across
 * (plan 98): the middle value of each of red, green and blue over the edge,
 * when nearly all of the edge is within a few levels of it, and otherwise
 * null, as for a busy background. Clear pixels count against it: a picture
 * clear round its edge has nothing to take out.
 */
export function plainOfEdges(rgba: Uint8Array, side: number): Rgb | null {
  const edge: [number, number, number, number][] = []
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (x !== 0 && y !== 0 && x !== side - 1 && y !== side - 1) continue
      const i = (y * side + x) * 4
      edge.push([rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, rgba[i + 3]!])
    }
  }
  const solid = edge.filter((p) => p[3] >= 128)
  if (solid.length === 0) return null
  const middle = (c: 0 | 1 | 2): number => {
    const v = solid.map((p) => p[c]).sort((a, b) => a - b)
    return v[Math.floor(v.length / 2)]!
  }
  const rgb: Rgb = [middle(0), middle(1), middle(2)]
  const near = solid.filter((p) => (Math.abs(p[0] - rgb[0]) + Math.abs(p[1] - rgb[1]) + Math.abs(p[2] - rgb[2])) / 3 <= PLAIN_NEAR).length
  return near >= edge.length * 0.8 ? rgb : null
}

/**
 * Where an effect goes over a clip: starting where the clip starts, a picture
 * on the video track above the clip's, made when there is none, and a sound
 * left to find a free sound track of its own. Null when the clip is gone.
 */
export function effectPlacement(
  t: Timeline,
  clipId: string,
  picture: boolean,
  makeTrackId: () => string
): { at: number; onTrack?: string; newTrack?: 'video' } | null {
  const found = findClip(t, clipId)
  if (!found) return null
  const at = found.clip.timelineStart
  if (!picture) return { at }
  const tracks = t.videoTracks
  const i = found.kind === 'video' ? tracks.findIndex((r) => r.id === found.track.id) : -1
  const above = tracks[i + 1]
  return above ? { at, onTrack: above.id } : { at, onTrack: makeTrackId(), newTrack: 'video' }
}
