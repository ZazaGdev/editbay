/**
 * Linking and unlinking clips, and a timeline's tracks: adding and removing one,
 * and its name, sound, lock and visibility.
 */

import { newId } from './ids'
import { type Span, MAX_VIDEO_TRACKS, MAX_AUDIO_TRACKS, cleanTrackName } from './tracks'
import type { Timeline, TrackKind, VideoTrack, AudioTrack } from './project'
import { findClip, linkedIds, mapClips, trackIdTaken, trackOf } from './timeline-query'

/** Separate a clip from the clips linked to it, for good. */
/**
 * Link clips into one group: every clip named, with whatever each was linked
 * to already, so they select, move, trim and cut together. Undoes Unlink,
 * which until this had nothing but Ctrl+Z to reverse it. Nothing happens
 * unless it would join more than one group.
 */
export function linkClips(p: Timeline, clipIds: readonly string[]): Timeline {
  const ids = new Set(clipIds.flatMap((id) => (findClip(p, id) ? linkedIds(p, id) : [])))
  const groups = new Set([...ids].map((id) => findClip(p, id)!.clip.link ?? `alone:${id}`))
  if (groups.size < 2) return p
  const link = newId()
  const join = <T extends Span>(c: T): T => (ids.has(c.id) ? { ...c, link } : c)
  return mapClips(p, join, join)
}

export function unlinkClip(p: Timeline, clipId: string): Timeline {
  const link = findClip(p, clipId)?.clip.link
  if (link === undefined) return p
  const drop = <T extends Span>(c: T): T => {
    if (c.link !== link) return c
    const { link: _gone, ...rest } = c
    return rest as T
  }
  return mapClips(p, drop, drop)
}

/**
 * Another track, above the top video track or below the last audio track, up
 * to the most there may be.
 */
export function addTrack(p: Timeline, kind: TrackKind, trackId: string): Timeline {
  if (trackIdTaken(p, trackId)) return p
  if (kind === 'video') {
    return p.videoTracks.length >= MAX_VIDEO_TRACKS ? p : { ...p, videoTracks: [...p.videoTracks, { id: trackId, clips: [] }] }
  }
  return p.audioTracks.length >= MAX_AUDIO_TRACKS ? p : { ...p, audioTracks: [...p.audioTracks, { id: trackId, clips: [] }] }
}

/**
 * Mute a track, or hear it again. Saved with the project and honoured by the
 * export, unlike solo, which is a way of listening rather than a decision.
 */
export function setTrackMuted(p: Timeline, trackId: string, muted: boolean): Timeline {
  return withTrack(p, trackId, (track) => ({ ...track, ...(muted ? { muted: true } : { muted: undefined }) }))
}

/** Have an audio track come down under everything heard on the others, or stop it. */
export function setTrackDuck(p: Timeline, trackId: string, duck: boolean): Timeline {
  if (!p.audioTracks.some((r) => r.id === trackId)) return p
  return withTrack(p, trackId, (track) => ({ ...track, ...(duck ? { duck: true } : { duck: undefined }) }))
}

/** Lock a track against every edit, or let it be changed again. */
export function setTrackLocked(p: Timeline, trackId: string, locked: boolean): Timeline {
  return withTrack(p, trackId, (track) => ({ ...track, ...(locked ? { locked: true } : { locked: undefined }) }))
}

/**
 * Call a track something, or give it its number back. A name cleared is a
 * name removed: the track is V1 again rather than a track with no label.
 */
export function setTrackName(p: Timeline, trackId: string, name: string): Timeline {
  const clean = cleanTrackName(name)
  return withTrack(p, trackId, (track) => ({ ...track, ...(clean === undefined ? { name: undefined } : { name: clean }) }))
}

/**
 * Hide a track's pictures, or show them again. The picture track's answer to
 * mute: saved with the project and honoured by the export, because leaving a
 * take out of the cut is a decision about the edit.
 */
export function setTrackHidden(p: Timeline, trackId: string, hidden: boolean): Timeline {
  return withTrack(p, trackId, (track) => ({ ...track, ...(hidden ? { hidden: true } : { hidden: undefined }) }))
}

/**
 * What a track is called: its own name, or V1 and A1 as it has always been.
 *
 * One place decides, so the header, the track menu, a notice about a locked
 * track and the tests all say the same thing about the same track.
 */
export function trackLabel(p: Timeline, trackId: string): string {
  const found = trackOf(p, trackId)
  if (!found) return ''
  return found.track.name ?? `${found.kind === 'video' ? 'V' : 'A'}${found.index + 1}`
}

/** One track changed, whichever kind it is, leaving every other alone. */
function withTrack(p: Timeline, trackId: string, change: <T extends VideoTrack | AudioTrack>(track: T) => T): Timeline {
  if (!trackOf(p, trackId)) return p
  return {
    ...p,
    videoTracks: p.videoTracks.map((r) => (r.id === trackId ? change(r) : r)),
    audioTracks: p.audioTracks.map((r) => (r.id === trackId ? change(r) : r))
  }
}

/**
 * A track, with its clips, moved to another place among the tracks of its
 * kind (task 2613): `to` counts as V1 and A1 do, 0 being V1 at the bottom of
 * the pictures and A1 at the top of the sound. A track keeps its name; one
 * without a name takes the number of its new place, as the others do.
 */
export function moveTrack(p: Timeline, trackId: string, to: number): Timeline {
  // With captions, they are one of the pictures' tracks (task 2621): `to` is a
  // place among the video tracks and the caption track together.
  if (p.captions.clips.length > 0 && (trackId === CAPTION_TRACK_ID || p.videoTracks.some((r) => r.id === trackId))) {
    const stack = p.videoTracks.map((r) => r.id)
    stack.splice(captionsAbove(p), 0, CAPTION_TRACK_ID)
    const from = stack.indexOf(trackId)
    const at = Math.max(0, Math.min(stack.length - 1, Math.round(to)))
    if (at === from) return p
    stack.splice(from, 1)
    stack.splice(at, 0, trackId)
    const above = stack.indexOf(CAPTION_TRACK_ID)
    const { above: _was, ...captions } = p.captions
    return {
      ...p,
      videoTracks: stack.filter((id) => id !== CAPTION_TRACK_ID).map((id) => p.videoTracks.find((r) => r.id === id)!),
      captions: above === p.videoTracks.length ? captions : { ...captions, above }
    }
  }
  const found = trackOf(p, trackId)
  if (!found) return p
  const count = found.kind === 'video' ? p.videoTracks.length : p.audioTracks.length
  const at = Math.max(0, Math.min(count - 1, Math.round(to)))
  if (at === found.index) return p
  const move = <T extends { id: string }>(tracks: readonly T[]): T[] => {
    const rest = tracks.filter((r) => r.id !== trackId)
    return [...rest.slice(0, at), tracks[found.index]!, ...rest.slice(at)]
  }
  return found.kind === 'video' ? { ...p, videoTracks: move(p.videoTracks) } : { ...p, audioTracks: move(p.audioTracks) }
}

/** Take away an empty track. V1 and A1 always stay. */
export function removeTrack(p: Timeline, trackId: string): Timeline {
  const found = trackOf(p, trackId)
  if (!found || found.index === 0 || found.track.clips.length > 0) return p
  // Captions over the track taken away are over one fewer.
  const under = found.kind === 'video' && p.captions.above !== undefined && found.index < p.captions.above
  return {
    ...p,
    videoTracks: p.videoTracks.filter((r) => r.id !== trackId),
    audioTracks: p.audioTracks.filter((r) => r.id !== trackId),
    ...(under ? { captions: { ...p.captions, above: p.captions.above! - 1 } } : {})
  }
}

/** The caption track, where a track id is asked for: in a drag, or for the track shown in the Inspector. */
export const CAPTION_TRACK_ID = 'captions'

/**
 * How many video tracks, from V1 up, the captions are drawn over (task
 * 2621): every one of them unless the caption track was dragged down.
 */
export function captionsAbove(p: Timeline): number {
  const n = p.videoTracks.length
  return p.captions.above === undefined ? n : Math.max(0, Math.min(n, p.captions.above))
}

/** The video tracks under the captions, by id: the preview and the export draw the captions over these and under the rest. */
export function tracksUnderCaptions(p: Timeline): Set<string> {
  return new Set(p.videoTracks.slice(0, captionsAbove(p)).map((r) => r.id))
}
