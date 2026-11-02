/**
 * Setting a clip's speed (plan 105): its length on the timeline follows, and
 * the sequence after it closes up or moves on, as a trim of its end does.
 * What a speed is, and how it is kept, is in `speed.ts`.
 */

import { type Span, speedOf, spanLength, spanEnd, hasRoom, toSource, sourceAt } from './tracks'
import { isStill, type Timeline, type Clip, type SoundClip } from './project'
import { allClips, findClip, linkedIds, groupOnV1, mediaDurationFrames, mapClips } from './timeline-query'
import { closeUpBlockers, closeUpStretch } from './remove-clips'
import { openUpAfter, openUpStarts } from './move-trim'
import { cleanSpeed, type SpeedChange } from './speed'
import { clipLabel } from './clip-name'
import { trackLabel } from './track-edits'

/**
 * Why a clip's speed cannot be set to `speed`, in words, or null when it can.
 * A piece of a group is framed with the group's other pieces end to end on
 * the recording, which a speed of its own would break. Off V1, a clip made
 * longer must have room on its tracks: nothing is pushed along there.
 */
export function speedRefusal(p: Timeline, clipId: string, speed: number): string | null {
  const ids = linkedIds(p, clipId)
  const clips = allClips(p).filter((c) => ids.includes(c.id))
  if (clips.length === 0) return 'That clip is not there any more.'
  if (clips.some((c) => c.group !== undefined)) return 'This clip is part of a group. Ungroup it first to change its speed.'
  if (clips.some((c) => stillOf(p, c))) return 'A picture or a title has no speed: it is one frame, as long as you make it.'
  if (cleanSpeed(speed) === clips[0]!.speed) return null
  const { blockers } = speedPlan(p, clipId, { speed })
  const first = blockers[0]
  if (!first) return null
  if (!groupOnV1(p, clipId)) return 'There is no room for the clip at this speed. Move the clip after it first.'
  const track = [...p.videoTracks, ...p.audioTracks].find((r) => (r.clips as Span[]).some((c) => c.id === first.clip.id))
  const where = track ? `${clipLabel(p, first.clip.id)} on ${trackLabel(p, track.id)}` : clipLabel(p, first.clip.id)
  return first.early
    ? `At this speed ${where} would have to start before the sequence does. Move the shot later first.`
    : `Changing the speed would push a clip out of step: ${where} is in the way. Move it first.`
}

/** A clip that stops a speed being set: one in the way, or one of the clip's own that would start before frame 0. */
type SpeedBlocker = { clip: Span; early: boolean }

/**
 * A clip at `speed`, its recording's frames as they were, its length on the
 * timeline what they come to at that speed, and its end moved to exactly that
 * many frames, not past its recording's end. Back at 1x its ends go back to
 * whole frames of the recording, as a clip with no speed always has.
 */
function atSpeed<T extends Span>(c: T, speed: number | undefined, recordingFrames: number, frames?: number): T {
  const { speed: _was, ...rest } = c
  const plain = rest as T
  if (speed === undefined) {
    const sourceIn = Math.round(c.sourceIn)
    const length = Math.max(1, frames ?? Math.round(c.sourceOut - c.sourceIn))
    return { ...plain, sourceIn, sourceOut: Math.min(recordingFrames, sourceIn + length) }
  }
  const next = { ...plain, speed } as T
  let length = Math.max(1, frames ?? Math.round((c.sourceOut - c.sourceIn) / speed))
  while (length > 1 && c.sourceIn + toSource(next, length) > recordingFrames + 1e-6) length -= 1
  return { ...next, sourceOut: c.sourceIn + toSource(next, length) }
}

/**
 * Set a clip's speed, and its linked clips' with it, or its sound's keeping
 * and its plain frames. Its length changes with its speed, as a trim of its
 * end does: on V1, or linked to V1, everything after its picture closes up or
 * moves on by the change; anywhere else a faster clip leaves a gap, and a
 * slower one needs room after it. A linked clip that starts before or after
 * its picture, as a J-cut's sound does, keeps in step with it.
 *
 * Unchanged when it cannot be made: see `speedRefusal`.
 */
export function setSpeed(p: Timeline, clipId: string, change: SpeedChange): Timeline {
  const plan = speedPlan(p, clipId, change)
  return plan.blockers.length > 0 ? p : plan.result
}

/**
 * The speed set, and what is in the way of it. A linked clip that starts
 * before or ends after its picture, as a J-cut's or an L-cut's sound does,
 * is placed from its picture's start and end, both as far off them in its
 * recording as they were; then everything must land where the edit means it
 * to. Each clip's start was scaled on its own and the tracks settled, which
 * pushed a sound leading in under the shot before it along, out of step with
 * its picture by the whole overlap (audit 2026-10-19).
 */
function speedPlan(p: Timeline, clipId: string, change: SpeedChange): { result: Timeline; blockers: SpeedBlocker[] } {
  const done = (result: Timeline, blockers: SpeedBlocker[] = []): { result: Timeline; blockers: SpeedBlocker[] } => ({ result, blockers })
  if (!findClip(p, clipId)) return done(p)
  const ids = new Set(linkedIds(p, clipId))
  if (allClips(p).some((c) => ids.has(c.id) && (c.group !== undefined || stillOf(p, c)))) return done(p)

  // The switches alone change nothing about time.
  let next = mapClips(
    p,
    (c) => (ids.has(c.id) && change.plainFrames !== undefined ? withFlag(c, 'plainFrames', change.plainFrames) : c),
    (c) => (ids.has(c.id) && change.keepSound !== undefined ? withFlag(c, 'keepSound', change.keepSound) : c)
  )
  if (change.speed === undefined) return done(next)

  const speed = cleanSpeed(change.speed)
  const members = allClips(next).filter((c) => ids.has(c.id))
  if (members.every((c) => c.speed === speed)) return done(next)
  const onV1 = new Set(p.videoTracks[0]!.clips.map((c) => c.id))
  const anchor = members.find((c) => onV1.has(c.id)) ?? members.find((c) => c.id === clipId)!
  const was = speedOf(anchor)
  const now = speed ?? 1
  const frames = (c: Span): number => {
    const m = p.media.find((x) => x.id === c.mediaId)
    return m ? mediaDurationFrames(m, p.fps) : Infinity
  }
  // The anchor at the new speed, and each linked one off its start and end
  // kept as far off them in its recording, so a sound ends where its picture does.
  const anchorNow = atSpeed(anchor, speed, frames(anchor))
  // An offset that comes to a part frame is taken toward the picture, and the
  // sound's head moved to match, so it plays the picture's first frame with it.
  const scaled = (d: number): number => {
    const x = (d * was) / now
    return x < 0 ? Math.ceil(x - 1e-6) : Math.floor(x + 1e-6)
  }
  const moved = new Map<string, Span>()
  for (const c of members) {
    if (c.id === anchor.id) {
      moved.set(c.id, anchorNow)
      continue
    }
    const off = scaled(c.timelineStart - anchor.timelineStart)
    const start = anchor.timelineStart + off
    const end = spanEnd(anchorNow) + scaled(spanEnd(c) - spanEnd(anchor))
    const sourceIn = Math.max(0, sourceAt(c, anchor.timelineStart) + off * now)
    moved.set(c.id, { ...atSpeed({ ...c, sourceIn }, speed, frames(c), end - start), timelineStart: start })
  }
  const early = [...moved.values()].filter((c) => c.timelineStart < 0)
  if (early.length > 0) return done(p, early.map((clip) => ({ clip, early: true })))
  next = mapClips(
    next,
    (c) => (moved.has(c.id) ? (moved.get(c.id) as Clip) : c),
    (c) => (moved.has(c.id) ? (moved.get(c.id) as SoundClip) : c)
  )

  const oldEnd = spanEnd(anchor)
  const newEnd = spanEnd(anchorNow)
  const d = newEnd - oldEnd
  if (groupOnV1(p, clipId)) {
    if (d < 0) {
      const pushed = closeUpBlockers(next, newEnd, -d, ids)
      if (pushed.length > 0) return done(p, pushed.map((clip) => ({ clip, early: false })))
      const result = closeUpStretch(next, newEnd, -d, ids)
      return done(result, inTheWayOf(result, moved))
    }
    const meant = openUpStarts(next, oldEnd, d, ids, onV1)
    const result = openUpAfter(next, oldEnd, d, ids, onV1)
    const before = new Map(allClips(next).map((c) => [c.id, c.timelineStart]))
    const pushed = allClips(result).filter((c) => !ids.has(c.id) && c.timelineStart !== (meant.get(c.id) ?? before.get(c.id)))
    return done(result, [...inTheWayOf(result, moved), ...pushed.map((clip) => ({ clip, early: false }))])
  }
  // Off V1 nothing moves along: each clip needs room for its new length.
  for (const c of moved.values()) {
    const track = [...next.videoTracks, ...next.audioTracks].find((r) => (r.clips as Span[]).some((x) => x.id === c.id))
    if (track && !hasRoom(track.clips as Span[], c.timelineStart, spanLength(c), ids)) return done(p, [{ clip: c, early: false }])
  }
  return done(next)
}

/**
 * The clips that pushed one of the edited clips off where it was placed, as
 * a track is settled: what was already there under a lead-in made longer.
 */
function inTheWayOf(result: Timeline, moved: ReadonlyMap<string, Span>): SpeedBlocker[] {
  const out: SpeedBlocker[] = []
  for (const track of [...result.videoTracks, ...result.audioTracks]) {
    const clips = track.clips as Span[]
    for (const c of clips) {
      const meant = moved.get(c.id)
      if (!meant || c.timelineStart === meant.timelineStart) continue
      const end = meant.timelineStart + spanLength(meant)
      const there = clips.find((x) => !moved.has(x.id) && x.timelineStart < end && spanEnd(x) > meant.timelineStart)
      out.push({ clip: there ?? c, early: false })
    }
  }
  return out
}

/** Whether a clip is of a picture, a text or a drawing: one frame, with no speed to play at. */
function stillOf(p: Timeline, c: Span): boolean {
  const m = p.media.find((x) => x.id === c.mediaId)
  return m !== undefined && isStill(m)
}

/** A clip with a switch of its kind on, or taken off. */
function withFlag<T extends object>(c: T, key: 'plainFrames' | 'keepSound', on: boolean): T {
  const { [key]: _gone, ...rest } = c as Record<string, unknown>
  return (on ? { ...rest, [key]: true } : rest) as T
}
