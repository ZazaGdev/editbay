/**
 * Moving and trimming clips: where a move lands, setting a clip's in and out,
 * ripple trims, and I and O, which trim a clip to a frame and close up on V1.
 */

import { newId } from './ids'
import {
  spanLength, placeCovering, type Span, headLimit, tailLimit, spanEnd, closedUpStart, closeUpStarts,
  type TrackOf, withStarts
} from './tracks'
import { clamp } from './project-core'
import type { TrackKind, Timeline, Clip, SoundClip } from './project'
import { findClip, trackOf, linkedIds, maxTracks, allClips, mediaDurationFrames, mapClips, groupOnV1 } from './timeline-query'
import { without, closeUpBlockers, closeUpStretch, openUpStretch } from './remove-clips'
import { asTwoPieces, relinkCovered, strictlyInside } from './split-join'
import { addTrack } from './track-edits'

/** Where each clip of a move lands: its track, by kind and place among its kind, and its start. */
export interface Landing {
  clipId: string
  kind: TrackKind
  index: number
  start: number
  length: number
}

/**
 * Where a clip moved to `start` on the track `trackId` lands, and the clips
 * linked to it unless it moves on its own: all by the same time, the others
 * of its kind by as many tracks as it moved, the others on their own tracks.
 * None before the timeline's start, and none past the last track there may
 * be. Empty when the move cannot be made: a track of the other kind, or one
 * that is not there.
 */
export function plannedMove(
  p: Timeline,
  clipId: string,
  trackId: string,
  start: number,
  alone = false,
  withIds: readonly string[] = []
): Landing[] {
  const found = findClip(p, clipId)
  const dest = trackOf(p, trackId)
  if (!found || !dest || dest.kind !== found.kind) return []
  // The clip, its linked clips unless alone, and whatever else is selected
  // with it, all by the same time and the same number of tracks.
  const ids = new Set([...(alone ? [clipId] : linkedIds(p, clipId)), ...withIds])
  const members = [...ids].flatMap((id) => {
    const m = findClip(p, id)
    return m ? [m] : []
  })
  const earliest = Math.min(...members.map((m) => m.clip.timelineStart))
  const delta = Math.max(-earliest, Math.round(start) - found.clip.timelineStart)
  const sameKind = members.filter((m) => m.kind === found.kind).map((m) => m.index)
  const shift = clamp(dest.index - found.index, -Math.min(...sameKind), maxTracks(found.kind) - 1 - Math.max(...sameKind))
  return members.map((m) => ({
    clipId: m.clip.id,
    kind: m.kind,
    index: m.kind === found.kind ? m.index + shift : m.index,
    start: m.clip.timelineStart + delta,
    length: spanLength(m.clip)
  }))
}

/**
 * Move a clip to another time, and to another track of its kind, with the
 * clips linked to it unless it moves on its own, and `withIds`, the rest of a
 * selection it was dragged in. Each covers what it lands on, as Premiere does.
 * A move past the last track adds tracks.
 */
export function moveClip(
  p: Timeline,
  clipId: string,
  trackId: string,
  start: number,
  alone = false,
  withIds: readonly string[] = []
): Timeline {
  const landings = plannedMove(p, clipId, trackId, start, alone, withIds)
  if (landings.length === 0) return p
  const moving = new Map(landings.map((l) => [l.clipId, l]))
  const lifted = without(p, new Set(moving.keys()))
  const videoTracks = [...lifted.videoTracks]
  const audioTracks = [...lifted.audioTracks]
  for (const l of landings) {
    const tracks = l.kind === 'video' ? videoTracks : audioTracks
    while (tracks.length <= l.index) tracks.push({ id: newId(), clips: [] })
  }
  for (const found of allClips(p)) {
    const l = moving.get(found.id)
    if (!l) continue
    if (l.kind === 'video') {
      const track = videoTracks[l.index]!
      videoTracks[l.index] = { ...track, clips: placeCovering(track.clips, { ...(found as Clip), timelineStart: l.start }, newId, asTwoPieces) }
    } else {
      const track = audioTracks[l.index]!
      audioTracks[l.index] = { ...track, clips: placeCovering(track.clips, { ...(found as SoundClip), timelineStart: l.start }, newId, asTwoPieces) }
    }
  }
  return relinkCovered({ ...lifted, videoTracks, audioTracks })
}

/** A group of clips, each with its track's clips, for trimming them together. */
function membersOf(p: Timeline, clipId: string, alone: boolean): { clip: Span; track: Span[]; frames: number }[] {
  return (alone ? [clipId] : linkedIds(p, clipId)).flatMap((id) => {
    const found = findClip(p, id)
    if (!found) return []
    const m = p.media.find((x) => x.id === found.clip.mediaId)
    return m ? [{ clip: found.clip as Span, track: found.track.clips as Span[], frames: mediaDurationFrames(m, p.fps) }] : []
  })
}

/** Every clip named moved by `fn`, wherever it is. */
export function reshape(p: Timeline, ids: ReadonlySet<string>, fn: <T extends Span>(c: T) => T): Timeline {
  return mapClips(
    p,
    (c) => (ids.has(c.id) ? fn(c) : c),
    (c) => (ids.has(c.id) ? fn(c) : c)
  )
}

/**
 * Move the head of a clip to a frame of its recording, and the heads of the
 * clips linked to it by as much, unless it is trimmed on its own. Each tail
 * stays where it is. They all stop together at the first limit any of them
 * meets: the clip before it on its track, the timeline's start, its
 * recording's start, or one frame before its tail.
 */
export function setClipIn(p: Timeline, clipId: string, frame: number, alone = false): Timeline {
  const found = findClip(p, clipId)
  if (!found) return p
  const members = membersOf(p, clipId, alone)
  let low = -Infinity
  let high = Infinity
  for (const m of members) {
    low = Math.max(low, headLimit(m.track, m.clip) - m.clip.timelineStart)
    high = Math.min(high, spanLength(m.clip) - 1)
  }
  const d = clamp(Math.round(frame) - found.clip.sourceIn, low, high)
  if (d === 0 || low > high) return p
  return reshape(p, new Set(members.map((m) => m.clip.id)), (c) => ({ ...c, sourceIn: c.sourceIn + d, timelineStart: c.timelineStart + d }))
}

/**
 * Move the tail of a clip to a frame of its recording, and the tails of the
 * clips linked to it by as much, unless it is trimmed on its own. They all
 * stop together at the first limit any of them meets: the clip after it on
 * its track, its recording's end, or one frame after its head.
 */
export function setClipOut(p: Timeline, clipId: string, frame: number, alone = false): Timeline {
  const found = findClip(p, clipId)
  if (!found) return p
  const members = membersOf(p, clipId, alone)
  let low = -Infinity
  let high = Infinity
  for (const m of members) {
    low = Math.max(low, 1 - spanLength(m.clip))
    high = Math.min(high, tailLimit(m.track, m.clip, m.frames) - spanEnd(m.clip))
  }
  const d = clamp(Math.round(frame) - found.clip.sourceOut, low, high)
  if (d === 0 || low > high) return p
  return reshape(p, new Set(members.map((m) => m.clip.id)), (c) => ({ ...c, sourceOut: c.sourceOut + d }))
}

/**
 * Trim a clip's edge to a frame of its recording and close up or open up the
 * sequence with it, as I and O do on V1: on a head trim the clip keeps its
 * start and what it shows moves; either way everything after it, on every
 * track, moves by the same frames. The clips linked to it are trimmed with
 * it, all as far as all of them can go. A clip with nothing of its group on
 * V1 is trimmed as a plain trim is, alone when `alone` says so: an overlay
 * made longer covers more of V1, and one made shorter shows V1 again.
 */
export function rippleTrim(p: Timeline, clipId: string, edge: 'start' | 'end', frame: number, alone = false): Timeline {
  const plan = ripplePlan(p, clipId, edge, frame, alone)
  return plan.blockers.length > 0 ? p : plan.result
}

/**
 * What would stop a ripple trim to `frame`, as `rippleTrim` refuses it: the
 * clips a close-up would push out of step. None when it can be made, and
 * always none for a trim that makes the clip longer (audit 2026-10-01: the
 * drag's warning asked about taking the whole clip out, on the timeline the
 * drag had already changed, and so warned of the wrong thing).
 */
export function rippleTrimBlockers(p: Timeline, clipId: string, edge: 'start' | 'end', frame: number, alone = false): (Clip | SoundClip)[] {
  return ripplePlan(p, clipId, edge, frame, alone).blockers
}

function ripplePlan(p: Timeline, clipId: string, edge: 'start' | 'end', frame: number, alone: boolean): { result: Timeline; blockers: (Clip | SoundClip)[] } {
  const done = (result: Timeline): { result: Timeline; blockers: (Clip | SoundClip)[] } => ({ result, blockers: [] })
  const found = findClip(p, clipId)
  if (!found) return done(p)
  if (!groupOnV1(p, clipId)) return done(edge === 'start' ? setClipIn(p, clipId, frame, alone) : setClipOut(p, clipId, frame, alone))
  const c = found.clip
  const members = membersOf(p, clipId, false)
  const ids = new Set(members.map((m) => m.clip.id))
  const wanted = Math.round(frame) - (edge === 'start' ? c.sourceIn : c.sourceOut)
  let low = -Infinity
  let high = Infinity
  for (const m of members) {
    if (edge === 'start') {
      low = Math.max(low, -m.clip.sourceIn)
      high = Math.min(high, spanLength(m.clip) - 1)
    } else {
      low = Math.max(low, 1 - spanLength(m.clip))
      high = Math.min(high, m.frames - m.clip.sourceOut)
    }
  }
  const d = clamp(wanted, low, high)
  if (d === 0 || low > high) return done(p)
  // The group's own edge, its earliest start or end: where its clips do not
  // start or end together, as a J-cut or an L-cut, the dragged clip's edge
  // would leave the others growing into what does not move.
  if (edge === 'start') {
    // From the picture's own start on V1: a J-cut's sound leads in before it,
    // under whatever ends there, and opening from the sound's start pushed a
    // clip sitting in that lead-in into the picture (audit 2026-10-01).
    const onV1 = new Set(p.videoTracks[0]!.clips.map((x) => x.id))
    const picture = members.find((m) => onV1.has(m.clip.id))
    const point = picture ? picture.clip.timelineStart : Math.min(...members.map((m) => m.clip.timelineStart))
    const trimmed = reshape(p, ids, (x) => ({ ...x, sourceIn: x.sourceIn + d }))
    // Shorter at the head: its first `d` frames come out. Longer: that much comes in.
    if (d > 0) {
      const blockers = closeUpBlockers(trimmed, point, d, ids)
      return blockers.length > 0 ? { result: p, blockers } : done(closeUpStretch(trimmed, point, d, ids))
    }
    return done(openUpStretch(trimmed, point, -d, ids))
  }
  const point = Math.min(...members.map((m) => spanEnd(m.clip)))
  const trimmed = reshape(p, ids, (x) => ({ ...x, sourceOut: x.sourceOut + d }))
  if (d < 0) {
    const blockers = closeUpBlockers(trimmed, point + d, -d, ids)
    return blockers.length > 0 ? { result: p, blockers } : done(closeUpStretch(trimmed, point + d, -d, ids))
  }
  return done(openUpStretch(trimmed, point, d, ids))
}

/**
 * Move a clip by taking it out where it was, closing up there, and putting it
 * in at `start` on the track `trackId`, opening up there, with every clip
 * linked to it: the way V1's clips are put in another order. Only V1's time
 * closes up or opens up: taken out of another track it leaves a gap, and put
 * in on another track it covers what is there. `start` is where it was let
 * go, on the sequence as it was before; the others of its kind move by as
 * many tracks as it did, the others stay on their tracks.
 */
export function rearrangeClip(p: Timeline, clipId: string, trackId: string, start: number): Timeline {
  const found = findClip(p, clipId)
  const dest = trackOf(p, trackId)
  if (!found || !dest || dest.kind !== found.kind) return p
  const ids = linkedIds(p, clipId)
  const members = ids.map((id) => findClip(p, id)!)
  const from = Math.min(...members.map((m) => m.clip.timelineStart))
  const length = Math.max(...members.map((m) => spanEnd(m.clip))) - from
  const groupStart = Math.max(0, Math.round(start) - (found.clip.timelineStart - from))
  const sameKind = members.filter((m) => m.kind === found.kind).map((m) => m.index)
  const shift = clamp(dest.index - found.index, -Math.min(...sameKind), maxTracks(found.kind) - 1 - Math.max(...sameKind))
  const landsAt = (m: { kind: TrackKind; index: number }): number => (m.kind === found.kind ? m.index + shift : m.index)
  const fromV1 = members.some((m) => m.kind === 'video' && m.index === 0)
  const ontoV1 = members.some((m) => m.kind === 'video' && landsAt(m) === 0)
  const at = fromV1 ? closedUpStart(groupStart, from, length) : groupStart
  // Let go where it began: nothing to take out or put in.
  if (at === from && shift === 0) return p
  // Cut through on the tracks it goes in on, and on every video track.
  const landsOn = new Set([
    ...p.videoTracks.map((r) => r.id),
    ...members.flatMap((m) => {
      const tracks = m.kind === 'video' ? p.videoTracks : p.audioTracks
      const track = tracks[landsAt(m)]
      return track ? [track.id] : []
    })
  ])
  const out = without(p, new Set(ids))
  // Not when taking it out would push a clip out of step: see closeUpBlockers.
  if (fromV1 && closeUpBlockers(out, from, length).length > 0) return p
  const closed = fromV1 ? closeUpStretch(out, from, length) : out
  const opened = ontoV1 ? openUpStretch(closed, at, length, new Set(), landsOn) : closed
  const videoTracks = [...opened.videoTracks]
  const audioTracks = [...opened.audioTracks]
  for (const m of members) {
    const index = m.kind === found.kind ? m.index + shift : m.index
    const start = m.clip.timelineStart - from + at
    if (m.kind === 'video') {
      while (videoTracks.length <= index) videoTracks.push({ id: newId(), clips: [] })
      const track = videoTracks[index]!
      videoTracks[index] = { ...track, clips: placeCovering(track.clips, { ...m.clip, timelineStart: start }, newId, asTwoPieces) }
    } else {
      while (audioTracks.length <= index) audioTracks.push({ id: newId(), clips: [] })
      const track = audioTracks[index]!
      audioTracks[index] = { ...track, clips: placeCovering(track.clips, { ...m.clip, timelineStart: start }, newId, asTwoPieces) }
    }
  }
  return relinkCovered({ ...opened, videoTracks, audioTracks })
}

/**
 * A move, or a take out and put in with `insert`, onto the track `trackId`,
 * made first when it is not there and `newTrack` says so: the lane past the
 * last track of the clip's kind. Taking out and putting in is from V1 or onto
 * it only; anywhere else `insert` is a plain move.
 */
export function moveClipTo(
  p: Timeline,
  clipId: string,
  trackId: string,
  start: number,
  opts: { alone?: boolean; insert?: boolean; newTrack?: boolean; with?: readonly string[] } = {}
): Timeline {
  const found = findClip(p, clipId)
  if (!found) return p
  const withTrack = opts.newTrack && !trackOf(p, trackId) ? addTrack(p, found.kind, trackId) : p
  if (withTrack === p && opts.newTrack && !trackOf(p, trackId)) return p
  const fromOrOntoV1 = groupOnV1(p, clipId) || trackId === p.videoTracks[0]!.id
  return opts.insert && fromOrOntoV1
    ? rearrangeClip(withTrack, clipId, trackId, start)
    : moveClip(withTrack, clipId, trackId, start, opts.alone === true, opts.with ?? [])
}

export function trimStart(p: Timeline, clipId: string, deltaFrames: number): Timeline {
  const c = findClip(p, clipId)?.clip
  return c ? setClipIn(p, clipId, c.sourceIn + deltaFrames) : p
}

export function trimEnd(p: Timeline, clipId: string, deltaFrames: number): Timeline {
  const c = findClip(p, clipId)?.clip
  return c ? setClipOut(p, clipId, c.sourceOut + deltaFrames) : p
}

/**
 * Trim a clip to `frame`, which becomes its first frame, or the first after
 * it ends. On V1 it closes up, as I and O always have there: the clip keeps
 * its start, its linked clips lose the same frames, and everything after
 * moves earlier on every track. On another track it is a trim, leaving a gap,
 * with its linked clips trimmed with it unless it is on its own.
 */
export function trimToFrame(p: Timeline, clipId: string, edge: 'start' | 'end', frame: number, alone = false): Timeline {
  const found = findClip(p, clipId)
  if (!found || !strictlyInside(found.clip, frame)) return p
  const c = found.clip
  const into = frame - c.timelineStart
  const closing = closingTrim(p, clipId, edge, frame, alone)
  if (!closing) {
    // Selected alone, it was detached on purpose: trimmed where it is, leaving a gap.
    const own = alone ? null : ownTracksTrim(p, clipId, edge, frame)
    if (!own) return edge === 'start' ? setClipIn(p, clipId, c.sourceIn + into, alone) : setClipOut(p, clipId, c.sourceIn + into, alone)
    return own.blockers.length === 0 ? own.result : p
  }
  // Not when it would push a clip out of step: see closeUpBlockers, and tooShortFor.
  if (closing.short.length > 0 || closeUpBlockers(closing.trimmed, closing.at, closing.length, closing.ids).length > 0) return p
  return closeUpStretch(closing.trimmed, closing.at, closing.length, closing.ids)
}

/**
 * The V1 clip I or O trims and closes up behind: the clip itself when it is
 * on V1, or the picture on V1 it is linked to, as the sound half of a
 * recording is, unless it was selected alone. Null for anything else.
 */
export function closingOn(p: Timeline, clipId: string, alone: boolean): Clip | null {
  const found = findClip(p, clipId)
  if (!found) return null
  if (found.kind === 'video' && found.index === 0) return found.clip as Clip
  if (alone) return null
  const onV1 = linkedIds(p, clipId).find((id) => {
    const x = findClip(p, id)
    return x?.kind === 'video' && x.index === 0
  })
  return onV1 ? (findClip(p, onV1)!.clip as Clip) : null
}

/**
 * I or O on a clip that closes up: the group trimmed, and the stretch that
 * then closes up, worked out on its picture on V1, whichever half of it was
 * chosen. Null for a clip that does not close up or a frame not inside it.
 */
function closingTrim(
  p: Timeline,
  clipId: string,
  edge: 'start' | 'end',
  frame: number,
  alone = false
): { trimmed: Timeline; at: number; length: number; ids: ReadonlySet<string>; short: (Clip | SoundClip)[] } | null {
  const c = closingOn(p, clipId, alone)
  if (!c || !strictlyInside(c, frame)) return null
  const into = frame - c.timelineStart
  const ids = new Set(linkedIds(p, clipId))
  const length = edge === 'start' ? into : spanLength(c) - into
  const trimmed = reshape(p, ids, (x) =>
    edge === 'start'
      ? { ...x, sourceIn: Math.min(x.sourceIn + length, x.sourceOut - 1) }
      : { ...x, sourceOut: Math.max(x.sourceOut - length, x.sourceIn + 1) }
  )
  return { trimmed, at: edge === 'start' ? c.timelineStart : frame, length, ids, short: tooShortFor(p, ids, length) }
}

/**
 * The linked clips too short to lose `length` frames, as a sound shorter than
 * its picture's cut is: trimmed anyway, each would be held at one frame and
 * put out of step with the rest (audit 2026-10-01), so the trim is refused.
 */
function tooShortFor(p: Timeline, ids: ReadonlySet<string>, length: number): (Clip | SoundClip)[] {
  return allClips(p).filter((x) => ids.has(x.id) && spanLength(x) <= length)
}

/** What I or O would push out of step, as `trimToFrame` closes up: nothing when it can. */
export function trimToFrameBlockers(p: Timeline, clipId: string, edge: 'start' | 'end', frame: number, alone = false): (Clip | SoundClip)[] {
  const closing = closingTrim(p, clipId, edge, frame, alone)
  if (closing) return [...closing.short, ...closeUpBlockers(closing.trimmed, closing.at, closing.length, closing.ids)]
  return alone ? [] : (ownTracksTrim(p, clipId, edge, frame)?.blockers ?? [])
}

/**
 * I or O on a clip that is not on V1 and not linked to anything there, as a
 * picture laid over another track or a sound on its own: trimmed, with what
 * is after it on its own tracks, and its linked clips' tracks, moving earlier
 * to close up. Nothing on any other track moves, so the edit underneath stays
 * as it is, as a ripple trim in other editors leaves the tracks it is not on.
 *
 * `blockers` are clips it would move that are linked to a clip it would not,
 * which would put the two out of step; with any, it is refused.
 */
function ownTracksTrim(
  p: Timeline,
  clipId: string,
  edge: 'start' | 'end',
  frame: number
): { result: Timeline; blockers: (Clip | SoundClip)[] } | null {
  const found = findClip(p, clipId)
  if (!found || !strictlyInside(found.clip, frame)) return null
  const c = found.clip
  const into = frame - c.timelineStart
  const ids = new Set(linkedIds(p, clipId))
  const length = edge === 'start' ? into : spanLength(c) - into
  const trimmed = reshape(p, ids, (x) =>
    edge === 'start'
      ? { ...x, sourceIn: Math.min(x.sourceIn + length, x.sourceOut - 1) }
      : { ...x, sourceOut: Math.max(x.sourceOut - length, x.sourceIn + 1) }
  )
  const at = edge === 'start' ? c.timelineStart : frame
  const tracks = new Set([...trimmed.videoTracks, ...trimmed.audioTracks].filter((r) => (r.clips as Span[]).some((x) => ids.has(x.id))).map((r) => r.id))
  const onTracks = [...trimmed.videoTracks, ...trimmed.audioTracks].filter((r) => tracks.has(r.id)).flatMap((r) => r.clips as (Clip | SoundClip)[])
  const starts = closeUpStarts(onTracks, at, length, ids)
  const moving = new Set(onTracks.filter((x) => starts.get(x.id) !== undefined && starts.get(x.id) !== x.timelineStart).map((x) => x.id))
  const staying = allClips(trimmed).filter((x) => !moving.has(x.id))
  const blockers = [
    ...tooShortFor(p, ids, length),
    ...allClips(trimmed).filter((x) => moving.has(x.id) && x.link !== undefined && staying.some((y) => y.link === x.link && !ids.has(y.id)))
  ]
  const shift = <T extends Span>(r: TrackOf<T>): TrackOf<T> => (tracks.has(r.id) ? withStarts(r, starts) : r)
  return { result: { ...trimmed, videoTracks: trimmed.videoTracks.map(shift), audioTracks: trimmed.audioTracks.map(shift) }, blockers }
}
