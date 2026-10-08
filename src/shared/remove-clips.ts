/**
 * Taking clips out and closing up behind them: one clip, several, a gap, a
 * stretch on every track, and a marked range, with what refuses each.
 */

import { newId } from './ids'
import { closeUpStarts, withStarts, type TrackOf, type Span, spanEnd, hasRoom, gapClosable } from './tracks'
import type { Timeline, Clip, SoundClip } from './project'
import { findClip, linkedIds, allClips, trackOf } from './timeline-query'
import { asTwoPieces, splitEverything } from './split-join'

/** Take clips away, leaving gaps where they were. */
export function without(p: Timeline, ids: ReadonlySet<string>): Timeline {
  return {
    ...p,
    videoTracks: p.videoTracks.map((r) => ({ ...r, clips: r.clips.filter((c) => !ids.has(c.id)) })),
    audioTracks: p.audioTracks.map((r) => ({ ...r, clips: r.clips.filter((c) => !ids.has(c.id)) }))
  }
}

/**
 * Take a clip away, and the clips linked to it unless it is to go on its
 * own. It leaves a gap, on every track, V1 included.
 */
export function removeClip(p: Timeline, clipId: string, alone = false): Timeline {
  if (!findClip(p, clipId)) return p
  return without(p, new Set(alone ? [clipId] : linkedIds(p, clipId)))
}

/**
 * Take `length` frames from `at` out of the sequence: everything that starts
 * after them moves earlier by that much, on every track, and what starts
 * inside them moves to `at`. What starts before them stays, so music laid
 * under the whole cut does not move. A linked group moves as one. The clips
 * named in `leave` are left where they are.
 */
export function closeUpStretch(p: Timeline, at: number, length: number, leave: ReadonlySet<string> = new Set()): Timeline {
  if (length <= 0) return p
  const starts = closeUpStarts(allClips(p), at, length, leave)
  return {
    ...p,
    videoTracks: p.videoTracks.map((r) => withStarts(r, starts)),
    audioTracks: p.audioTracks.map((r) => withStarts(r, starts))
  }
}

/**
 * The clips that taking `length` frames from `at` out of the sequence would
 * push along their tracks, off where closing up means them to go, where that
 * matters: one of a linked group, which would part from the rest of it, or
 * one that came after the stretch, which would part from what it was laid
 * against. It happens when a clip left whole across the stretch, such as a
 * voice over or music, is in the way of one moving up on the same track, such
 * as a recording's microphone stream. Empty when closing up is clean. Two
 * clips of their own that both start inside the stretch, and so both move to
 * its start, one going on after the other, are no trouble, as they never were.
 */
export function closeUpBlockers(p: Timeline, at: number, length: number, leave: ReadonlySet<string> = new Set()): (Clip | SoundClip)[] {
  if (length <= 0) return []
  const meant = closeUpStarts(allClips(p), at, length, leave)
  const members = new Map<string, number>()
  for (const c of allClips(p)) if (c.link !== undefined) members.set(c.link, (members.get(c.link) ?? 0) + 1)
  const before = new Map(allClips(p).map((c) => [c.id, c.timelineStart]))
  return allClips(closeUpStretch(p, at, length, leave)).filter((c) => {
    const want = meant.get(c.id)
    if (want === undefined || c.timelineStart === want) return false
    const grouped = c.link !== undefined && (members.get(c.link) ?? 0) > 1
    return grouped || (before.get(c.id) ?? 0) >= at + length
  })
}

/**
 * Make room for `length` frames at `at`: everything that starts at or after
 * `at`, on every track, moves later by that much. A clip running across `at`
 * on one of the tracks named in `cutOn`, where something is to go in, is cut
 * there first, its second piece moving with the rest, and so is every clip
 * linked to one that is cut, so both pieces stay in step with their linked
 * clips. Any other clip running across `at` stays whole where it is, as music
 * laid under the whole cut does when the sequence closes up. The second
 * pieces of one group are linked to each other. The clips named in `leave`
 * stay as they are.
 */
export function openUpStretch(
  p: Timeline,
  at: number,
  length: number,
  leave: ReadonlySet<string> = new Set(),
  cutOn: ReadonlySet<string> = new Set()
): Timeline {
  if (length <= 0) return p
  const onTrack = new Map<string, string>()
  for (const r of [...p.videoTracks, ...p.audioTracks] as TrackOf<Span>[]) for (const c of r.clips) onTrack.set(c.id, r.id)
  const clips = allClips(p).filter((c) => !leave.has(c.id))
  const running = clips.filter((c) => c.timelineStart < at && spanEnd(c) > at)
  // The groups with a clip that moves on, such as a picture whose sound leads in across the point.
  const moving = new Set(clips.filter((c) => c.timelineStart >= at && c.link !== undefined).map((c) => c.link!))
  const cutLinks = new Set([...moving, ...running.filter((c) => cutOn.has(onTrack.get(c.id) ?? '') && c.link !== undefined).map((c) => c.link!)])
  const across = running.filter((c) => cutOn.has(onTrack.get(c.id) ?? '') || (c.link !== undefined && cutLinks.has(c.link)))
  const cutting = new Set(across.map((c) => c.id))
  // Each group cut becomes two, one each side of the point. The side that
  // keeps the group's link is the one with its other clips: the second pieces
  // when some of the group moves on, the first otherwise.
  const links = new Map<string, string>()
  for (const c of across) if (c.link !== undefined && !links.has(c.link)) links.set(c.link, newId())
  const open = <T extends Span>(c: T): T[] => {
    if (leave.has(c.id)) return [c]
    if (c.timelineStart >= at) return [{ ...c, timelineStart: c.timelineStart + length }]
    if (!cutting.has(c.id)) return [c]
    const cut = c.sourceIn + (at - c.timelineStart)
    const { link: old, ...rest } = c
    const fresh = old === undefined ? undefined : links.get(old)
    const [firstLink, secondLink] = old !== undefined && moving.has(old) ? [fresh, old] : [old, fresh]
    const first = { ...rest, sourceOut: cut, ...(firstLink !== undefined ? { link: firstLink } : {}) } as T
    const second = { ...rest, id: newId(), sourceIn: cut, timelineStart: at + length, ...(secondLink !== undefined ? { link: secondLink } : {}) } as T
    return asTwoPieces(first, second)
  }
  return {
    ...p,
    videoTracks: p.videoTracks.map((r) => ({ ...r, clips: r.clips.flatMap(open) })),
    audioTracks: p.audioTracks.map((r) => ({ ...r, clips: r.clips.flatMap(open) }))
  }
}

/**
 * Take a clip and every clip linked to it away, and the stretch they covered
 * out of the sequence, closing up. Always the whole group: taking time out of
 * one track of it would put it out of step.
 */
export function closeUpClip(p: Timeline, clipId: string): Timeline {
  const ids = linkedIds(p, clipId)
  if (ids.length === 0) return p
  const clips = allClips(p).filter((c) => ids.includes(c.id))
  const from = Math.min(...clips.map((c) => c.timelineStart))
  const to = Math.max(...clips.map(spanEnd))
  const out = without(p, new Set(ids))
  // Not when it would push a clip out of step: see closeUpBlockers.
  if (closeUpBlockers(out, from, to - from).length > 0) return p
  return closeUpStretch(out, from, to - from)
}

/** What would be pushed out of step by taking a clip away and closing up, as `closeUpClip` does: nothing when it can. */
export function closeUpClipBlockers(p: Timeline, clipId: string): (Clip | SoundClip)[] {
  const ids = linkedIds(p, clipId)
  if (ids.length === 0) return []
  const clips = allClips(p).filter((c) => ids.includes(c.id))
  const from = Math.min(...clips.map((c) => c.timelineStart))
  return closeUpBlockers(without(p, new Set(ids)), from, Math.max(...clips.map(spanEnd)) - from)
}

/** The clips a removal takes: each named, with the clips linked to it unless they go on their own. */
function goingWith(p: Timeline, clipIds: readonly string[], alone: boolean): Set<string> {
  const out = new Set<string>()
  for (const id of clipIds) {
    if (!findClip(p, id)) continue
    for (const other of alone ? [id] : linkedIds(p, id)) out.add(other)
  }
  return out
}

/**
 * Where the stretch a close-up removal takes out begins: the first frame of
 * the clips named and those going with them, which is where the join is
 * once it has closed up. Null when none of them is there.
 */
export function closeUpStart(p: Timeline, clipIds: readonly string[], alone = false): number | null {
  const going = goingWith(p, clipIds, alone)
  const clips = allClips(p).filter((c) => going.has(c.id))
  return clips.length === 0 ? null : Math.min(...clips.map((c) => c.timelineStart))
}

/** Why several clips cannot be taken away closing up. */
export type ClipsRefusal =
  /** They do not cover one stretch of the sequence: there is a hole between them. */
  | { why: 'apart' }
  /** Closing up would push these out of step, as `closeUpBlockers` says. */
  | { why: 'blocked'; clips: (Clip | SoundClip)[] }

/**
 * Why `removeClips` would not close up, or null when it would. Closing up
 * takes one stretch out of the sequence, so several clips can only come out
 * that way when they cover one between them: clips with a hole between them
 * would leave whatever is in the hole to be dragged back to the start.
 */
export function removeClipsRefusal(p: Timeline, clipIds: readonly string[], alone = false): ClipsRefusal | null {
  const going = goingWith(p, clipIds, alone)
  if (going.size === 0) return null
  const spans = allClips(p)
    .filter((c) => going.has(c.id))
    .map((c) => [c.timelineStart, spanEnd(c)] as [number, number])
    .sort((a, b) => a[0] - b[0])
  const from = spans[0]![0]
  let reach = spans[0]![1]
  for (const [start, end] of spans) {
    if (start > reach) return { why: 'apart' }
    reach = Math.max(reach, end)
  }
  const blockers = closeUpBlockers(without(p, going), from, reach - from)
  return blockers.length > 0 ? { why: 'blocked', clips: blockers } : null
}

/**
 * Take several clips away at once, as one edit: Delete with more than one
 * selected. Each goes with the clips linked to it unless they are to go on
 * their own, and a clip named twice goes once. With `closeUp`, the stretch
 * they covered comes out of the sequence as well; nothing changes at all if
 * that is refused.
 */
export function removeClips(p: Timeline, clipIds: readonly string[], opts: { alone?: boolean; closeUp?: boolean } = {}): Timeline {
  const going = goingWith(p, clipIds, opts.alone === true)
  if (going.size === 0) return p
  const out = without(p, going)
  if (opts.closeUp !== true) return out
  if (removeClipsRefusal(p, clipIds, opts.alone === true)) return p
  const clips = allClips(p).filter((c) => going.has(c.id))
  const from = Math.min(...clips.map((c) => c.timelineStart))
  return closeUpStretch(out, from, Math.max(...clips.map(spanEnd)) - from)
}

/** A gap on a track: the empty stretch from `from` to `to`. */
export interface Gap {
  trackId: string
  from: number
  to: number
}

/**
 * Whether a gap can be closed up: it is empty on its own track, nothing on
 * another track starts, ends or lies inside it, closing it would not part a
 * linked group, and nothing left whole across it is in the way of a clip that
 * would move up beside it. A clip running right across it, like music, is no
 * trouble otherwise.
 */
export function gapCanClose(p: Timeline, gap: Gap): boolean {
  const found = trackOf(p, gap.trackId)
  if (!found || gap.to <= gap.from) return false
  const own = found.track.clips as Span[]
  if (!hasRoom(own, gap.from, gap.to - gap.from)) return false
  const others = allClips(p).filter((c) => !own.some((x) => x.id === c.id))
  return gapClosable(others, gap.from, gap.to) && !gapPartsGroup(p, gap) && closeUpBlockers(p, gap.from, gap.to - gap.from).length === 0
}

/**
 * Whether closing a gap would move some of a linked group and not the rest: a
 * clip after the gap linked to one that starts before the gap ends, such as
 * the next picture's sound brought in under the gap. A group moves by its
 * earliest clip, so the picture after the gap would stay where it is while
 * everything not linked to it moved.
 */
export function gapPartsGroup(p: Timeline, gap: Gap): boolean {
  const earliest = new Map<string, number>()
  for (const c of allClips(p)) {
    if (c.link !== undefined) earliest.set(c.link, Math.min(earliest.get(c.link) ?? Infinity, c.timelineStart))
  }
  return allClips(p).some((c) => c.link !== undefined && c.timelineStart >= gap.to && earliest.get(c.link)! < gap.to)
}

/** Take a gap's time out of the sequence, when it can be. */
export function closeUpGap(p: Timeline, gap: Gap): Timeline {
  return gapCanClose(p, gap) ? closeUpStretch(p, gap.from, gap.to - gap.from) : p
}

/**
 * Take the frames from `from` to `to` out of every track, leaving a gap the
 * same length: Delete over a marked range. Every clip running across either
 * edge is cut there first, so nothing is left straddling and nothing else
 * moves.
 */
export function liftRange(p: Timeline, from: number, to: number): Timeline {
  if (to <= from) return p
  const cut = splitEverything(splitEverything(p, from), to)
  const inside = allClips(cut).filter((c) => c.timelineStart >= from && spanEnd(c) <= to)
  return without(cut, new Set(inside.map((c) => c.id)))
}

/**
 * The same, closing up: everything after the range moves earlier by its
 * length, on every track. This can never be refused, unlike taking one clip
 * out: cutting every track at both edges leaves nothing running across the
 * stretch, so nothing can be pushed out of step.
 */
export function removeRange(p: Timeline, from: number, to: number): Timeline {
  if (to <= from) return p
  return closeUpStretch(liftRange(p, from, to), from, to - from)
}
