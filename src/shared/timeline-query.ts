/**
 * Reading a timeline: its clips, their lengths and the timeline's, finding a clip
 * and what is linked to it, and the small helpers the edits share to change one
 * clip or every clip.
 */

import { secondsToFrames } from './time'
import { type Span, spanLength, spanEnd, isHidden, MAX_VIDEO_TRACKS, MAX_AUDIO_TRACKS } from './tracks'
import { captionEnd } from './captions'
import { type TransitionWindow, transitionWindows, type Shown, shownSpans } from './transitions'
import { clamp } from './project-core'
import type { ProjectMedia, Timeline, Clip, SoundClip, TrackKind, VideoTrack, AudioTrack } from './project'

/** How long a source is, in project frames. Never zero, so a clip always fits. */
export function mediaDurationFrames(m: ProjectMedia, fps: number): number {
  return Math.max(1, secondsToFrames(m.durationSec, fps))
}

/** How long a clip is, on any track. */
export function clipLength(c: Span): number {
  return spanLength(c)
}

/** V1's clips, in time order. */
export function v1Clips(p: Timeline): Clip[] {
  return p.videoTracks[0]?.clips ?? []
}

/** Where V1's last clip ends, or 0 when it has none. */
export function v1End(p: Timeline): number {
  return v1Clips(p).reduce((end, c) => Math.max(end, spanEnd(c)), 0)
}

/**
 * Whether anything is on the timeline besides V1's clips and the sound linked
 * to them: what one file per clip leaves out.
 */
export function besidesV1(p: Timeline): boolean {
  const v1 = v1Clips(p)
  const links = new Set(v1.flatMap((c) => (c.link !== undefined ? [c.link] : [])))
  const ids = new Set(v1.map((c) => c.id))
  return allClips(p).some((c) => !ids.has(c.id) && !(c.link !== undefined && links.has(c.link)))
}

/** Every clip on every track, pictures and sound alike. */
export function allClips(p: Timeline): (Clip | SoundClip)[] {
  return [...p.videoTracks.flatMap((r) => r.clips), ...p.audioTracks.flatMap((r) => r.clips)]
}

/**
 * Where the sequence ends: the end of the last clip on any track, muted or
 * not, or of the last caption. The playhead, playback and the export all go
 * this far.
 */
export function timelineDuration(p: Timeline): number {
  // The shown span and not `spanEnd`: a fade hanging off the end of the last
  // clip is part of the sequence, and the playhead and the export go that far.
  const shown = shownSpansOf(p)
  const clips = allClips(p).reduce((end, c) => Math.max(end, shown.get(c.id)?.to ?? spanEnd(c)), 0)
  return p.captions.clips.reduce((end, c) => Math.max(end, captionEnd(c)), clips)
}

/** One track's transitions, with the track they are on. */
export interface TrackTransitions {
  trackId: string
  kind: TrackKind
  windows: TransitionWindow[]
}

/**
 * Every transition of a sequence, track by track, the video tracks first.
 * Clamped against the clips around each one, so what is drawn is what renders.
 */
export function transitionsOf(p: Timeline): TrackTransitions[] {
  return [
    ...p.videoTracks.map((r) => ({ trackId: r.id, kind: 'video' as TrackKind, windows: transitionWindows(r.clips, 'picture') })),
    ...p.audioTracks.map((r) => ({ trackId: r.id, kind: 'audio' as TrackKind, windows: transitionWindows(r.clips, 'sound') }))
  ]
}

/**
 * Every clip's shown span, by id: where it is drawn from and to once the
 * transitions over it have stretched it. What the timeline, the export and
 * the preview read; `spanEnd` stays what the edits and the overlap checks do.
 */
export function shownSpansOf(p: Timeline): Map<string, Shown> {
  const out = new Map<string, Shown>()
  for (const r of p.videoTracks) for (const [id, at] of shownSpans(r.clips, 'picture')) out.set(id, at)
  for (const r of p.audioTracks) for (const [id, at] of shownSpans(r.clips, 'sound')) out.set(id, at)
  return out
}

export function mediaOf(p: Timeline, mediaId: string): ProjectMedia {
  const m = p.media.find((x) => x.id === mediaId)
  if (!m) throw new Error(`unknown media: ${mediaId}`)
  return m
}

/** Whether a source has a picture. One from before sound files could be imported always did. */
export function hasPicture(m: ProjectMedia): boolean {
  return m.hasVideo !== false
}

/** A track by id, and which kind it is and where it is among its kind. */
export function trackOf(
  p: Timeline,
  trackId: string
): { kind: 'video'; index: number; track: VideoTrack } | { kind: 'audio'; index: number; track: AudioTrack } | null {
  const v = p.videoTracks.findIndex((r) => r.id === trackId)
  if (v >= 0) return { kind: 'video', index: v, track: p.videoTracks[v]! }
  const a = p.audioTracks.findIndex((r) => r.id === trackId)
  if (a >= 0) return { kind: 'audio', index: a, track: p.audioTracks[a]! }
  return null
}

/** A clip on any track, the track it is on and where that track is among its kind. */
export type FoundClip =
  | { kind: 'video'; index: number; track: VideoTrack; clip: Clip }
  | { kind: 'audio'; index: number; track: AudioTrack; clip: SoundClip }

export function findClip(p: Timeline, clipId: string): FoundClip | null {
  for (const [index, track] of p.videoTracks.entries()) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) return { kind: 'video', index, track, clip }
  }
  for (const [index, track] of p.audioTracks.entries()) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) return { kind: 'audio', index, track, clip }
  }
  return null
}

/** A clip on a video track, by id. */
export function findVideoClip(p: Timeline, clipId: string): { index: number; track: VideoTrack; clip: Clip } | null {
  const found = findClip(p, clipId)
  return found?.kind === 'video' ? found : null
}

/** A sound clip on an audio track, by id. */
export function findSoundClip(p: Timeline, clipId: string): { index: number; track: AudioTrack; clip: SoundClip } | null {
  const found = findClip(p, clipId)
  return found?.kind === 'audio' ? found : null
}

/** A clip and every clip linked to it, by id: the clip alone when it is not linked. */
export function linkedIds(p: Timeline, clipId: string): string[] {
  const found = findClip(p, clipId)
  if (!found) return []
  const link = found.clip.link
  if (link === undefined) return [clipId]
  return allClips(p)
    .filter((c) => c.link === link)
    .map((c) => c.id)
}

/**
 * Whether a clip, or a clip linked to it, is on V1. Only an edit from V1
 * closes up or opens up the sequence with Ctrl: V1 is what everything else is
 * laid against, and an overlay or a sound edited on its own track leaves it,
 * and everything laid against it, where it is.
 */
export function groupOnV1(p: Timeline, clipId: string): boolean {
  const v1 = new Set(v1Clips(p).map((c) => c.id))
  return linkedIds(p, clipId).some((id) => v1.has(id))
}

/**
 * Every clip that `groupOnV1` says yes to, worked out in one pass: the clips
 * on V1 and every clip linked to one of them. The timeline asks this of every
 * clip it draws, and asking one clip at a time searched the whole sequence
 * for each.
 */
export function groupsOnV1(p: Timeline): Set<string> {
  const v1 = v1Clips(p)
  const links = new Set(v1.flatMap((c) => (c.link === undefined ? [] : [c.link])))
  const out = new Set(v1.map((c) => c.id))
  for (const c of allClips(p)) if (c.link !== undefined && links.has(c.link)) out.add(c.id)
  return out
}

/**
 * The clip on the lowest video track under `frame`: V1's when it has one
 * there. A hidden track is passed over, because this answers what is on
 * screen rather than what is on the timeline.
 */
export function pictureAt(p: Timeline, frame: number): Clip | undefined {
  for (const track of p.videoTracks) {
    if (isHidden(track)) continue
    const c = track.clips.find((x) => frame >= x.timelineStart && frame < spanEnd(x))
    if (c) return c
  }
  return undefined
}

/** Whether an id is taken by any clip. */
export function clipIdTaken(p: Timeline, clipId: string): boolean {
  return findClip(p, clipId) !== null
}

export function trackIdTaken(p: Timeline, trackId: string): boolean {
  return trackOf(p, trackId) !== null
}

/**
 * Force a clip inside its source and keep it at least one frame long.
 *
 * The tail is settled before the head, which matters when the source has become
 * shorter than the clip: clamping the head first against a stale tail leaves the
 * head past the end.
 */
export function clampToMedia<T extends Span>(c: T, durationFrames: number): T {
  const sourceOut = clamp(c.sourceOut, 1, durationFrames)
  const sourceIn = clamp(c.sourceIn, 0, sourceOut - 1)
  return { ...c, sourceIn, sourceOut }
}

/** Every clip rewritten by `video` or `sound`, on every track. */
export function mapClips(p: Timeline, video: (c: Clip) => Clip, sound: (c: SoundClip) => SoundClip): Timeline {
  return {
    ...p,
    videoTracks: p.videoTracks.map((r) => ({ ...r, clips: r.clips.map(video) })),
    audioTracks: p.audioTracks.map((r) => ({ ...r, clips: r.clips.map(sound) }))
  }
}

/**
 * Apply a change to one video clip. Every result is clamped inside its
 * source here, so the edits below only express intent.
 */
export function updateVideoClip(p: Timeline, clipId: string, fn: (c: Clip, m: ProjectMedia) => Clip): Timeline {
  const found = findVideoClip(p, clipId)
  if (!found) return p
  const m = mediaOf(p, found.clip.mediaId)
  const next = clampToMedia(fn(found.clip, m), mediaDurationFrames(m, p.fps))
  return mapClips(p, (c) => (c.id === clipId ? next : c), (c) => c)
}

/** Apply a change to one sound clip. */
export function updateSoundClip(p: Timeline, clipId: string, fn: (c: SoundClip, m: ProjectMedia) => SoundClip): Timeline {
  const found = findSoundClip(p, clipId)
  if (!found) return p
  const m = mediaOf(p, found.clip.mediaId)
  const next = fn(found.clip, m)
  return mapClips(p, (c) => c, (c) => (c.id === clipId ? next : c))
}

/** What a sequence can hold at most of each kind of track. */
export function maxTracks(kind: TrackKind): number {
  return kind === 'video' ? MAX_VIDEO_TRACKS : MAX_AUDIO_TRACKS
}
