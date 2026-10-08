/**
 * Placing a source on a timeline: a drop from Sources, onto a track or a new one,
 * inserted or laid over what is there.
 */

import { newId } from './ids'
import { hasRoom, MAX_VIDEO_TRACKS, placeCovering, MAX_AUDIO_TRACKS } from './tracks'
import { FULL_PLACE } from './layout'
import { evenDown } from './project-core'
import type { Timeline, Clip, SoundClip, TrackKind } from './project'
import { markedSpan, trackCount } from './project-media'
import { targetAspect } from './sequences'
import { isStill, stillPlace, startingCrop } from './drawn-media'
import { clipIdTaken, mediaDurationFrames, v1End, hasPicture, trackOf } from './timeline-query'
import { openUpStretch } from './remove-clips'
import { asTwoPieces, relinkCovered } from './split-join'
import { addTrack } from './track-edits'

/**
 * A source put on the timeline: dropped on a track, or added with Add to
 * timeline at the end of V1.
 */
export interface SourceDrop {
  mediaId: string
  /**
   * The new picture's id, or the sound clip's for a source with no picture.
   * The others, the link and any new tracks are named from it.
   */
  clipId: string
  /** The frame it starts at; the end of V1 when not given. */
  at?: number
  /** The track it was dropped on. */
  onTrack?: string
  /**
   * Which of its streams have sound in them, as the window can tell from
   * their waveforms. Every stream when not given.
   */
  streams?: number[]
  /** The whole recording, whatever is marked on it. */
  whole?: boolean
  /** How many frames a picture lands for, in place of the few seconds it usually does. */
  length?: number
}

/**
 * Where a source would land, or why it cannot. It lands as its picture on a
 * video track and one sound clip for each of its streams with sound, all
 * starting at the same frame, all the whole recording long, and linked when
 * there is more than one. Only the first sound is heard; the rest are muted,
 * because OBS puts everything mixed on its first track.
 *
 * - Dropped on a video track, the picture goes there, covering what is
 *   there. Each sound goes on the first audio track, from A1 down, with room
 *   for all of it that no other sound of this drop has taken, or a new one.
 * - Dropped on an audio track, its first sound goes there, covering what is
 *   there, and the rest as above. The picture goes on the first video track
 *   from V1 up with room for all of it, or a new one at the top.
 * - With Add to timeline, the picture goes on V1 straight after its last
 *   clip, and the sound as above.
 */
export function placeSource(p: Timeline, drop: SourceDrop): { timeline: Timeline; refused: string | null } {
  const refuse = (why: string): { timeline: Timeline; refused: string } => ({ timeline: p, refused: why })
  const m = p.media.find((x) => x.id === drop.mediaId)
  if (!m) return refuse('That source is not in the project.')
  if (clipIdTaken(p, drop.clipId)) return refuse('That clip is already on the timeline.')
  // What goes on the timeline: the part marked on the recording, or the whole
  // of it. A recording is marked before it lands, so a 28 minute take can
  // become the 43 seconds worth keeping without going on the timeline first.
  const whole = mediaDurationFrames(m, p.fps)
  const marked = drop.whole === true && !isStill(m) ? { from: 0, to: whole } : markedSpan(m, p.fps)
  const sourceIn = Math.min(marked.from, Math.max(0, whole - 1))
  const length =
    isStill(m) && drop.length !== undefined ? Math.max(1, Math.round(drop.length)) : Math.max(1, Math.min(whole, marked.to) - sourceIn)
  const at = drop.at === undefined ? v1End(p) : Math.max(0, Math.round(drop.at))
  const picture = hasPicture(m)
  const count = trackCount(m)
  const wanted = drop.streams ?? Array.from({ length: count }, (_, i) => i)
  // A sound file plays its first stream only.
  const streams = [...new Set(wanted.map(Math.round))].filter((s) => s >= 0 && s < count && (picture || s === 0)).sort((a, b) => a - b)
  if (!picture && streams.length === 0) return refuse('That source has neither a picture nor any sound.')
  const dropped = drop.onTrack === undefined ? null : trackOf(p, drop.onTrack)
  const link = (picture ? 1 : 0) + streams.length > 1 ? drop.clipId : undefined
  const videoTracks = [...p.videoTracks]
  const audioTracks = [...p.audioTracks]

  if (picture) {
    let index: number
    if (dropped?.kind === 'video') index = dropped.index
    else if (drop.onTrack === undefined) index = 0
    else {
      index = videoTracks.findIndex((r) => hasRoom(r.clips, at, length))
      if (index < 0) {
        if (videoTracks.length >= MAX_VIDEO_TRACKS) return refuse(`No room for its picture: a sequence has at most ${MAX_VIDEO_TRACKS} video tracks.`)
        index = videoTracks.length
        videoTracks.push({ id: `${drop.clipId}.v${index + 1}`, clips: [] })
      }
    }
    // A picture starts whole, in a box of its own shape: cropped to the frame
    // it would lose the edges of the meme it is. Without a frame, as under
    // Handoff, there is nothing to place it in and it is the output as it is.
    const full = isStill(m) ? { x: 0, y: 0, w: evenDown(m.width), h: evenDown(m.height) } : null
    const framed = targetAspect(p) !== null
    const clip: Clip = {
      id: drop.clipId,
      mediaId: m.id,
      sourceIn,
      sourceOut: sourceIn + length,
      timelineStart: at,
      // Start on the project shape rather than the whole frame. A landscape clip on
      // a vertical project would otherwise export as a small letterboxed strip.
      transform: full
        ? { mode: 'crop', crop: full, place: framed ? stillPlace(p, full, m) : FULL_PLACE }
        : { mode: 'crop', crop: startingCrop(p, m), place: FULL_PLACE },
      layers: [],
      layout: full && framed ? 'custom' : 'single',
      ...(link !== undefined ? { link } : {})
    }
    const track = videoTracks[index]!
    videoTracks[index] = { ...track, clips: placeCovering(track.clips, clip, newId, asTwoPieces) }
  }

  const taken = new Set<number>()
  for (const [n, stream] of streams.entries()) {
    let index = n === 0 && dropped?.kind === 'audio' ? dropped.index : -1
    if (index < 0) {
      index = audioTracks.findIndex((r, i) => !taken.has(i) && !(dropped?.kind === 'audio' && i === dropped.index) && hasRoom(r.clips, at, length))
    }
    if (index < 0) {
      if (audioTracks.length >= MAX_AUDIO_TRACKS) return refuse(`No room for all of its sound: a sequence has at most ${MAX_AUDIO_TRACKS} audio tracks.`)
      index = audioTracks.length
      audioTracks.push({ id: `${drop.clipId}.a${index + 1}`, clips: [] })
    }
    taken.add(index)
    const clip: SoundClip = {
      id: picture || n > 0 ? `${drop.clipId}.${stream + 1}` : drop.clipId,
      mediaId: m.id,
      track: stream,
      sourceIn,
      sourceOut: sourceIn + length,
      timelineStart: at,
      gain: 1,
      muted: n > 0,
      ...(link !== undefined ? { link } : {})
    }
    const track = audioTracks[index]!
    audioTracks[index] = { ...track, clips: placeCovering(track.clips, clip, newId, asTwoPieces) }
  }
  return { timeline: relinkCovered({ ...p, videoTracks, audioTracks }), refused: null }
}

/** Put a source on the timeline, as `placeSource` says, or leave it as it is when it cannot go. */
export function addSource(p: Timeline, drop: SourceDrop): Timeline {
  return placeSource(p, drop).timeline
}

/**
 * What a drop with Ctrl or onto the lane past the last track does first: with
 * `insert`, onto V1, the sequence opened up where it lands, by the source's
 * length, so it covers nothing; onto any other track it is a plain drop, and
 * V1 stays as it is. With `newTrack`, a track of that kind made for it, named
 * as the drop's track.
 */
export function prepareDrop(p: Timeline, drop: SourceDrop, opts: { insert?: boolean; newTrack?: TrackKind }): Timeline {
  const m = p.media.find((x) => x.id === drop.mediaId)
  if (!m) return p
  let next = p
  // A new track only when something of the source goes on one of that kind.
  const count = trackCount(m)
  const streams = (drop.streams ?? Array.from({ length: count }, (_, i) => i)).filter((s) => s >= 0 && s < count && (hasPicture(m) || s === 0))
  const fills = opts.newTrack === 'video' ? hasPicture(m) : streams.length > 0
  if (opts.newTrack && fills && drop.onTrack !== undefined && !trackOf(next, drop.onTrack)) next = addTrack(next, opts.newTrack, drop.onTrack)
  if (opts.insert && (drop.onTrack === undefined || drop.onTrack === next.videoTracks[0]!.id)) {
    // Cut through where it goes in, and on every video track, so the time
    // opened sits under it rather than after a picture running across.
    const on = new Set([...next.videoTracks.map((r) => r.id), drop.onTrack ?? next.videoTracks[0]!.id])
    // By as much as lands: the part marked on it, or a picture's five seconds.
    const lands = drop.whole === true && !isStill(m) ? { from: 0, to: mediaDurationFrames(m, next.fps) } : markedSpan(m, next.fps)
    next = openUpStretch(next, drop.at === undefined ? v1End(next) : Math.max(0, Math.round(drop.at)), lands.to - lands.from, new Set(), on)
  }
  return next
}

/** Add the whole of a source at the end of V1, with its sound: what Add to timeline does. */
export function addClip(p: Timeline, mediaId: string, clipId: string = newId()): Timeline {
  return addSource(p, { mediaId, clipId })
}
