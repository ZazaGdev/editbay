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

/** Take away an empty track. V1 and A1 always stay. */
export function removeTrack(p: Timeline, trackId: string): Timeline {
  const found = trackOf(p, trackId)
  if (!found || found.index === 0 || found.track.clips.length > 0) return p
  return {
    ...p,
    videoTracks: p.videoTracks.filter((r) => r.id !== trackId),
    audioTracks: p.audioTracks.filter((r) => r.id !== trackId)
  }
}
