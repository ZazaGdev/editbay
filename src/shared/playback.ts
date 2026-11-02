import {
  allClips,
  clipLength,
  clipToCut,
  closingOn,
  findClip,
  findVideoClip,
  linkedIds,
  pictureAt,
  MAIN_PICTURE,
  targetAspect,
  type Clip,
  type Timeline,
  type ProjectMedia
} from './project'
import { spanHolds, sourceAt, type Span } from './tracks'
import { framesToSeconds } from './time'
import type { ClipEdit } from './types'

/** A picture under a frame of the sequence, and where in its recording that is. */
export interface PlayPosition {
  clip: Clip
  media: ProjectMedia
  /** Frames at the project rate, from the start of the source file. */
  sourceFrame: number
  sourceSec: number
  /** How many frames of this clip are left, counting the one you are on. */
  framesRemaining: number
}

/** Where `frame` is in a clip that covers it. */
export function positionIn(p: Timeline, clip: Clip, frame: number): PlayPosition | null {
  const media = p.media.find((m) => m.id === clip.mediaId)
  if (!media) return null
  const into = frame - clip.timelineStart
  const sourceFrame = sourceAt(clip, frame)
  return {
    clip,
    media,
    sourceFrame,
    sourceSec: framesToSeconds(sourceFrame, p.fps),
    framesRemaining: clipLength(clip) - into
  }
}

/**
 * The picture on the lowest video track under `frame`, V1's when it has one
 * there, and where in its recording that is. Null where no video track has a
 * clip, which the monitor shows as black.
 */
export function positionAt(p: Timeline, frame: number): PlayPosition | null {
  const clip = pictureAt(p, frame)
  return clip ? positionIn(p, clip, frame) : null
}

/**
 * The picture the monitor edits at `frame`: the selected clip when it is a
 * picture under the playhead, on any track, and otherwise the one on the
 * lowest video track there, V1's when it has one. Under a shape with no frame
 * only V1's, since the others are left out of the picture.
 */
export function editedAt(p: Timeline, frame: number, selectedClipId: string | null): PlayPosition | null {
  const framed = targetAspect(p) !== null
  const under = (c: Clip): boolean => frame >= c.timelineStart && frame < c.timelineStart + clipLength(c)
  const chosen = selectedClipId ? findVideoClip(p, selectedClipId) : null
  if (chosen && under(chosen.clip) && (framed || chosen.index === 0)) return positionIn(p, chosen.clip, frame)
  const lowest = positionAt(p, frame)
  return lowest && (framed || p.videoTracks[0]?.clips.includes(lowest.clip)) ? lowest : null
}

/**
 * The text on top at a point of the frame, at a frame of the sequence: what a
 * double click there on the Output view types into. The point is a share of
 * the frame's width and height. Tracks higher up are drawn over lower ones,
 * so they answer first; a hidden track is passed over.
 */
export function textAt(p: Timeline, frame: number, x: number, y: number): string | null {
  for (let i = p.videoTracks.length - 1; i >= 0; i--) {
    const track = p.videoTracks[i]!
    if (track.hidden) continue
    for (const c of track.clips) {
      if (frame < c.timelineStart || frame >= c.timelineStart + clipLength(c)) continue
      if (!p.media.find((m) => m.id === c.mediaId)?.text) continue
      const { place } = c.transform
      if (x >= place.x && x <= place.x + place.w && y >= place.y && y <= place.y + place.h) return c.id
    }
  }
  return null
}

/**
 * The picture of a clip at a point of the frame, given as fractions of it:
 * the one drawn on top where they overlap, which is the last of its further
 * pictures, and the main picture under them all. Null where it has none.
 */
export function pictureUnder(c: Pick<Clip, 'transform' | 'layers'>, x: number, y: number): string | null {
  const pictures = [{ id: MAIN_PICTURE, place: c.transform.place }, ...c.layers.map((l) => ({ id: l.id, place: l.place }))]
  for (let i = pictures.length - 1; i >= 0; i--) {
    const { id, place } = pictures[i]!
    if (x >= place.x && x <= place.x + place.w && y >= place.y && y <= place.y + place.h) return id
  }
  return null
}

/**
 * Where the playhead goes when a clip is selected: where it is when that is
 * already inside the clip, so a click to see a clip's settings never loses the
 * frame you were looking at, and otherwise the clip's first frame. The clip
 * pressed decides it, not its group: pressing a sound clip that starts before
 * its picture goes to the sound clip's start.
 */
export function playheadInto(clip: Span, playhead: number): number {
  return spanHolds(clip, playhead) ? playhead : clip.timelineStart
}

/**
 * What stays selected once a clip is taken away: the next clip on the same
 * track, so Delete pressed again and again clears a row of splits, or the one
 * before it when nothing follows, or nothing when the track is left empty.
 * The clips going with it, its linked clips unless it goes on its own, are
 * never the answer. Worked out before the edit, since taking a clip away does
 * not change the ids of the others.
 */
export function nextAfterRemoved(p: Timeline, clipId: string, alone = false): string | null {
  const found = findClip(p, clipId)
  if (!found) return null
  const going = new Set(alone ? [clipId] : linkedIds(p, clipId))
  const left = (found.track.clips as Span[])
    .filter((c) => !going.has(c.id))
    .sort((a, b) => a.timelineStart - b.timelineStart)
  const from = found.clip.timelineStart
  const before = left.filter((c) => c.timelineStart < from)
  return (left.find((c) => c.timelineStart >= from) ?? before[before.length - 1])?.id ?? null
}

/**
 * The edit I or O makes: the clip under the playhead trimmed to it, so the
 * frame under the playhead becomes its first frame, or the first after it
 * ends. The selected clip when it is under the playhead, otherwise the one S
 * would cut. Null when there is nothing to do: no clip there, or the playhead
 * on a clip's first frame.
 */
export function trimToPlayhead(
  p: Timeline,
  frame: number,
  edge: 'start' | 'end',
  selected?: string | null,
  alone = false
): ClipEdit | null {
  const clipId = clipToCut(p, frame, selected)
  // Alone is for the clip selected alone. Another clip trimmed in its place takes its linked clips with it.
  return clipId ? { kind: 'trimToFrame', clipId, edge, frame, ...(alone && clipId === selected ? { alone } : {}) } : null
}

/**
 * Why I or O did nothing, in words, when `trimToPlayhead` has no edit to
 * make. Said aloud rather than left silent: a key that does nothing reads as
 * a broken key, and the usual reason, the playhead parked on a cut by Up or
 * Down, is not something you can see.
 */
export function trimToPlayheadRefusal(p: Timeline, frame: number, edge: 'start' | 'end'): string {
  const onCut = allClips(p).some((c) => c.timelineStart === frame)
  if (!onCut) return 'There is no clip under the playhead to trim.'
  return edge === 'start'
    ? 'The playhead is on the first frame of this clip, so there is nothing before it to trim. Move into the clip first.'
    : 'The playhead is on the first frame of this clip, so trimming its end here would leave nothing of it. Move into the clip first.'
}

/**
 * What I or O says once it has trimmed a clip on V1, or the sound linked to one: how much it took, since the
 * clip keeps its start and the rest closes up behind it, so the timeline can
 * look just as it did. Nothing for a trim elsewhere, which leaves a gap you
 * can see.
 */
export function trimToPlayheadWords(p: Timeline, edit: ClipEdit): string | null {
  if (edit.kind !== 'trimToFrame' || p.fps <= 0) return null
  // Said of the picture on V1 it closes up behind, whichever half was chosen.
  const c = closingOn(p, edit.clipId, edit.alone === true) ?? (edit.alone === true ? null : (findClip(p, edit.clipId)?.clip ?? null))
  if (!c) return null
  if (!spanHolds(c, edit.frame) || edit.frame === c.timelineStart) return null
  const frames = edit.edge === 'start' ? edit.frame - c.timelineStart : c.timelineStart + clipLength(c) - edit.frame
  const sec = (frames / p.fps).toFixed(1)
  return edit.edge === 'start'
    ? `Trimmed ${sec} s off the start of this clip, and closed up behind it.`
    : `Trimmed ${sec} s off the end of this clip, and closed up behind it.`
}
