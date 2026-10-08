/**
 * A sequence cut into pieces with the same pictures over all of each, the
 * fades and blends over them, and the sound files an export reads.
 */

import {
  cleanedFile,
  isStill,
  playedCopy,
  shownTracks,
  timelineDuration,
  trackFile,
  v1Clips,
  type Clip,
  type SoundClip,
  type Timeline
} from './project'
import { spanEnd } from './tracks'
import { PICTURE_KINDS, pictureKind, shownSpans, transitionWindows, washColour, type Shown } from './transitions'
import { clipNameFromPath } from './filename'
import { heardOver } from './render-sound'
import { mediaOf } from './render-pictures'
import type { ExportMode } from './render-plan'

/** The picture kinds by their id, for turning a stored kind into an `xfade` name. */
const PICTURE_KINDS_BY_ID = new Map(PICTURE_KINDS.map((k) => [k.id, k]))

/** A dip's late start going to its colour, for the wash that goes to it. */
function lateOf(kind: string): { late?: number } {
  const late = pictureKind(kind)?.late
  return late ? { late } : {}
}

/** A colour laid over a clip's picture across a whole piece: a dip to black or to white. */
export interface Wash {
  clipId: string
  colour: 'black' | 'white'
  /** `out` goes to the colour across the piece, `in` comes back out of it. */
  dir: 'in' | 'out'
  /** How far into going to the colour it waits before the colour comes up, 0 to 1 (a flash, plan 95). */
  late?: number
  /** The stretch it covers. A piece is cut at both ends of it. */
  from: number
  to: number
}

/** Two clips of one track blended across a whole piece: a dissolve, a wipe or a push. */
export interface Blend {
  /** The clip the piece starts on, which is the one `base` or `overlays` names. */
  clipId: string
  /** The clip it turns into, shown over the same frames. */
  into: Clip
  /** The `xfade` transition it renders as. */
  xfade: string
  /** The kind it is, for what the export lays on the `xfade` (plan 95). */
  kind: string
  /** The stretch it covers. A piece is cut at both ends of it. */
  from: number
  to: number
}

/** One segment: a stretch of the sequence with the same pictures over all of it. */
export interface Piece {
  from: number
  to: number
  /** The clip on the lowest video track over it, or null for black. */
  base: Clip | null
  /** The clips on the higher video tracks over it, in track order. */
  overlays: Clip[]
  sounds: SoundClip[]
  /**
   * The clips blended into over the whole of this piece, by the clip each one
   * starts from. A piece is cut at every window edge, so a blend either covers
   * all of a piece or none of it.
   */
  blends: Blend[]
  /** The colours laid over a clip's picture across the whole of this piece. */
  washes: Wash[]
}

/**
 * The whole sequence, from its first frame to its end, cut at every edge of
 * every clip on a video track, so each piece has the same pictures over all
 * of it: the lowest clip underneath, or black, and the higher ones over it.
 * Without a frame to place pictures in, as under Handoff, only V1 counts.
 *
 * A hidden track is left out, as a muted one is: hiding a track is a decision
 * about the edit, so what comes out of the app has to honour it. Unframed,
 * V1 is the output itself, so a hidden V1 leaves black rather than promoting
 * V2 into a frame that was never laid out for it.
 */
export function spansOf(timeline: Timeline, framed: boolean, range?: { from: number; to: number }): Piece[] {
  const end = timelineDuration(timeline)
  const tracks = shownTracks(timeline, framed)
  const cuts = new Set([0, end])
  // A part of it only: cut there too, so no piece runs across its edges.
  if (range) for (const edge of [range.from, range.to]) if (edge > 0 && edge < end) cuts.add(edge)
  const shown = new Map<string, Shown>()
  const washes: Wash[] = []
  const blends: Blend[] = []
  for (const track of tracks) {
    const spans = shownSpans(track.clips, 'picture')
    for (const [id, at] of spans) {
      shown.set(id, at)
      // The shown edges and not the stored ones: a transition puts a clip on
      // screen past its own last frame, and that stretch is part of the piece.
      for (const edge of [at.from, at.to]) if (edge > 0 && edge < end) cuts.add(edge)
    }
    for (const w of transitionWindows(track.clips, 'picture')) {
      // Where the picture changes hands inside a window, a piece ends: a dip to
      // black is one piece going to the colour and another coming out of it.
      for (const edge of [w.from, w.to, w.splitAt]) if (edge !== null && edge > 0 && edge < end) cuts.add(edge)
      // And the picture is the one handed to, whatever each clip's own edges
      // say: a dip that ends at the cut hands over before the first clip has
      // ended, and that first clip, still there underneath, must not be what
      // the piece shows at full brightness until the cut.
      if (w.splitAt !== null) {
        const out = w.fromClipId !== null ? shown.get(w.fromClipId) : undefined
        const into = w.toClipId !== null ? shown.get(w.toClipId) : undefined
        if (out) shown.set(w.fromClipId!, { from: out.from, to: Math.min(out.to, w.splitAt) })
        if (into) shown.set(w.toClipId!, { from: Math.max(into.from, w.splitAt), to: into.to })
      }
      const colour = washColour(w.kind)
      const found = colour ? null : PICTURE_KINDS_BY_ID.get(w.kind)
      if (colour) {
        // The clip that runs out goes to the colour up to the handover, and the
        // one that arrives comes out of it from there.
        const handover = w.splitAt ?? (w.toClipId === null ? w.to : w.from)
        if (w.fromClipId !== null) washes.push({ clipId: w.fromClipId, colour, dir: 'out', from: w.from, to: handover, ...lateOf(w.kind) })
        if (w.toClipId !== null) washes.push({ clipId: w.toClipId, colour, dir: 'in', from: handover, to: w.to })
      } else if (found && w.fromClipId !== null && w.toClipId !== null) {
        const into = track.clips.find((c) => c.id === w.toClipId)
        if (into) blends.push({ clipId: w.fromClipId, into, xfade: found.xfade, kind: found.id, from: w.from, to: w.to })
      }
    }
  }
  const spanOf = (c: Clip): Shown => shown.get(c.id) ?? { from: c.timelineStart, to: spanEnd(c) }
  const points = [...cuts].sort((a, b) => a - b)
  return points.slice(1).map((to, i) => {
    const from = points[i]!
    // In track order, and the clip a blend starts from first, so `base` is the
    // one the piece opens on and the one it turns into hangs off it.
    const over = tracks.flatMap((track) => {
      const here = track.clips.filter((c) => spanOf(c).from < to && spanOf(c).to > from)
      const blended = here.length > 1 ? blends.find((b) => here.some((c) => c.id === b.clipId) && here.some((c) => c.id === b.into.id)) : undefined
      return blended ? here.filter((c) => c.id === blended.clipId) : here.slice(0, 1)
    })
    const ids = new Set(over.map((c) => c.id))
    // A picture is laid over black rather than being the picture underneath:
    // only an overlay can put a box partly outside the frame, or turn it.
    const laid = framed && over[0] !== undefined && isStill(mediaOf(timeline, over[0]))
    return {
      from,
      to,
      base: laid ? null : (over[0] ?? null),
      overlays: laid ? over : over.slice(1),
      sounds: heardOver(timeline, from, to),
      blends: blends.filter((b) => ids.has(b.clipId) && b.from <= from && b.to >= to),
      washes: washes.filter((x) => ids.has(x.clipId) && x.from <= from && x.to >= to)
    }
  })
}

/**
 * The fades against a colour on one clip's own edges, for a file of its own.
 *
 * Exporting each clip separately cannot carry a transition at a cut, because
 * the two clips are two different files, and it cannot show the part of a fade
 * that falls before the clip's own first frame either. What is left is what
 * belongs to this clip alone, and that is kept.
 */
export function washesOfClip(timeline: Timeline, clip: Clip): Wash[] {
  const track = timeline.videoTracks.find((r) => r.clips.some((c) => c.id === clip.id))
  if (!track) return []
  const out: Wash[] = []
  for (const w of transitionWindows(track.clips, 'picture')) {
    const colour = washColour(w.kind)
    if (!colour) continue
    const handover = w.splitAt ?? (w.toClipId === null ? w.to : w.from)
    if (w.fromClipId === clip.id && w.from >= clip.timelineStart) {
      out.push({ clipId: clip.id, colour, dir: 'out', from: w.from, to: handover, ...lateOf(w.kind) })
    }
    if (w.toClipId === clip.id && handover >= clip.timelineStart) {
      out.push({ clipId: clip.id, colour, dir: 'in', from: handover, to: w.to })
    }
  }
  return out
}

/**
 * The copies of recordings' other tracks an export reads, with what to call
 * each if it is missing. They live in the cache, and can be missing while a
 * cleared cache is being rebuilt.
 */
export function trackCopiesRead(timeline: Timeline, mode: ExportMode): { path: string; label: string }[] {
  const out = new Map<string, string>()
  const heard = mode === 'join' ? heardOver(timeline, 0, Infinity) : v1Clips(timeline).flatMap((c) => linkedSound(timeline, c))
  for (const c of heard) {
    const media = timeline.media.find((m) => m.id === c.mediaId)
    const file = media && c.track > 0 ? trackFile(media, c.track) : null
    if (media && file) out.set(file.path, `track ${c.track + 1} of ${clipNameFromPath(media.originalPath)}`)
    const copy = media ? playedCopy(media, c) : null
    if (media && copy) {
      out.set(copy, `${c.voice !== undefined && copy !== cleanedFile(media, c.track) ? 'the enhanced voice' : 'the cleaned sound'} of ${clipNameFromPath(media.originalPath)}`)
    }
  }
  return [...out].map(([path, label]) => ({ path, label }))
}

/** The heard sound clips linked to a clip, over its stretch: its own sound, which a file of its own carries. */
export function linkedSound(timeline: Timeline, clip: Clip): SoundClip[] {
  if (clip.link === undefined) return []
  const linked = new Set(timeline.audioTracks.flatMap((r) => r.clips.filter((c) => c.link === clip.link).map((c) => c.id)))
  return heardOver(timeline, clip.timelineStart, spanEnd(clip), linked)
}
