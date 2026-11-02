/**
 * Transitions and fades on a clip's edges: adding, changing and taking them off,
 * and filling the cuts an edit makes.
 */

import { spanEnd, spanLength } from './tracks'
import {
  type KindSet, pictureKind, soundKind, defaultKind, type TransitionSide, type Transition,
  MIN_TRANSITION_FRAMES, beforeFor
} from './transitions'
import type { TrackKind, Clip, SoundClip, Timeline } from './project'
import { findClip, linkedIds, mapClips } from './timeline-query'

/** Which set of kinds a clip's transitions come from: pictures blend, sounds curve. */
function kindSetOf(kind: TrackKind): KindSet {
  return kind === 'video' ? 'picture' : 'sound'
}

/** A kind a clip of this sort can actually use, or the default of its sort. */
function kindFor(kinds: KindSet, wanted: string | undefined): string {
  const known = wanted !== undefined && (kinds === 'picture' ? pictureKind(wanted) !== null : soundKind(wanted) !== null)
  return known ? wanted : defaultKind(kinds)
}

/** A clip with a transition put on one of its edges, or taken off it. */
function withTransition<T extends Clip | SoundClip>(c: T, side: TransitionSide, t: Transition | undefined): T {
  return side === 'in' ? { ...c, transitionIn: t } : { ...c, transitionOut: t }
}

function transitionOn(c: Clip | SoundClip, side: TransitionSide): Transition | undefined {
  return side === 'in' ? c.transitionIn : c.transitionOut
}

/**
 * Put a transition on a clip's edge, and on the same edge of every clip linked
 * to it, so one gesture on a picture fades its sound with it.
 *
 * A picture gets the kind asked for and its linked sound the default curve:
 * "Wipe left" means nothing to a sound. Centred on the cut, as Premiere puts
 * it, with the clamps in `transitions.ts` pushing it onto one side where there
 * is not the room, which is what Premiere does too.
 */
export function addTransition(
  p: Timeline,
  clipId: string,
  side: TransitionSide,
  at: { kind?: string; length: number; alone?: boolean }
): Timeline {
  if (!findClip(p, clipId)) return p
  const ids = new Set(at.alone === true ? [clipId] : linkedIds(p, clipId))
  const length = Math.max(MIN_TRANSITION_FRAMES, Math.round(at.length))
  const put =
    (kinds: KindSet) =>
    <T extends Clip | SoundClip>(c: T): T =>
      ids.has(c.id) ? withTransition(c, side, { kind: kindFor(kinds, at.kind), length, before: beforeFor('centre', length) }) : c
  return mapClips(p, put('picture'), put('sound'))
}

/**
 * How long a transition is and where it sits across the cut, as a drag on one
 * of its ends or on its body leaves it.
 *
 * The clips linked to it follow, so a picture and its sound stay the same
 * length, but only where they already have one: a sound fade taken off on
 * purpose is not brought back by dragging the picture's.
 */
export function setTransition(
  p: Timeline,
  clipId: string,
  side: TransitionSide,
  at: { length: number; before: number; alone?: boolean }
): Timeline {
  if (!findClip(p, clipId)) return p
  const ids = new Set(at.alone === true ? [clipId] : linkedIds(p, clipId))
  const length = Math.max(MIN_TRANSITION_FRAMES, Math.round(at.length))
  const before = Math.min(length, Math.max(0, Math.round(at.before)))
  const set = <T extends Clip | SoundClip>(c: T): T => {
    const had = transitionOn(c, side)
    return ids.has(c.id) && had ? withTransition(c, side, { ...had, length, before }) : c
  }
  return mapClips(p, set, set)
}

/**
 * Which kind a transition is, changed after the fact rather than by taking it
 * off and putting another on. Only the clip asked: a picture kind means
 * nothing on a sound, so a linked fade keeps its own curve.
 */
export function setTransitionKind(p: Timeline, clipId: string, side: TransitionSide, kind: string): Timeline {
  const found = findClip(p, clipId)
  const had = found ? transitionOn(found.clip, side) : undefined
  if (!found || !had) return p
  const wanted = { ...had, kind: kindFor(kindSetOf(found.kind), kind) }
  const set = <T extends Clip | SoundClip>(c: T): T => (c.id === clipId ? withTransition(c, side, wanted) : c)
  return mapClips(p, set, set)
}

/** Take a transition off an edge, and off the same edge of the clips linked to it. */
export function removeTransition(p: Timeline, clipId: string, side: TransitionSide, alone = false): Timeline {
  if (!findClip(p, clipId)) return p
  const ids = new Set(alone ? [clipId] : linkedIds(p, clipId))
  const off = <T extends Clip | SoundClip>(c: T): T => (ids.has(c.id) ? withTransition(c, side, undefined) : c)
  return mapClips(p, off, off)
}

/**
 * A sound clip's fade from silence at its start, or to silence at its end,
 * `length` frames long and wholly inside it, as its fade handle drags it: a
 * sound transition like any other, kept on the side it starts from so the
 * clip's first or last frame is where the fade reaches silence. It keeps the
 * kind of a fade already there. Nothing, or less than a frame, takes it away.
 * On this clip alone: a picture linked to it does not dip with its sound.
 * At most half the clip, so a fade in and a fade out never cross.
 */
export function setFade(p: Timeline, clipId: string, side: TransitionSide, length: number): Timeline {
  const found = findClip(p, clipId)
  if (!found || found.kind !== 'audio') return p
  const most = Math.floor(spanLength(found.clip) / 2)
  const frames = Math.min(most, Math.round(length))
  if (frames < MIN_TRANSITION_FRAMES) return removeTransition(p, clipId, side, true)
  const had = transitionOn(found.clip, side) !== undefined
  const put = had ? p : addTransition(p, clipId, side, { length: frames, alone: true })
  return setTransition(put, clipId, side, { length: frames, before: side === 'in' ? 0 : frames, alone: true })
}

/**
 * Whether `next` carries straight on from `prior`: the same recording, and the
 * same stream of it for a sound, picking up on the very frame `prior` stops.
 */
function carriesOn(prior: Clip | SoundClip, next: Clip | SoundClip): boolean {
  if (prior.mediaId !== next.mediaId || prior.sourceOut !== next.sourceIn) return false
  return !('track' in prior) || !('track' in next) || prior.track === next.track
}

/** Where two clips of one track meet exactly, by the track they are on and the frame. */
function touchingSeams(p: Timeline): Set<string> {
  const out = new Set<string>()
  for (const track of [...p.videoTracks, ...p.audioTracks]) {
    const ends = new Set(track.clips.map(spanEnd))
    for (const c of track.clips) if (ends.has(c.timelineStart)) out.add(`${track.id}:${c.timelineStart}`)
  }
  return out
}

/**
 * A transition on every cut this edit has just made, for anyone who wants one
 * on all of them without putting each one on by hand.
 *
 * Only the cuts the edit made. Filling every bare cut each time would put back
 * the one you took off a moment ago, and nothing you could do would keep it
 * off while the setting was on.
 *
 * Never a cut where the footage carries straight on, as a plain split leaves:
 * the two sides are one recording at one moment, so there is nothing to blend,
 * and blending it played the same sound twice at once, a few milliseconds
 * apart, heard as an echo. Such a cut gets one when footage is taken out of it.
 */
export function fillNewCuts(before: Timeline, after: Timeline, at: { kind?: string; length: number }): Timeline {
  const was = touchingSeams(before)
  let out = after
  for (const track of [...after.videoTracks, ...after.audioTracks]) {
    const ends = new Set(track.clips.map(spanEnd))
    for (const c of track.clips) {
      if (!ends.has(c.timelineStart) || was.has(`${track.id}:${c.timelineStart}`)) continue
      const prior = (track.clips as (Clip | SoundClip)[]).find((x) => spanEnd(x) === c.timelineStart)
      if (prior && carriesOn(prior, c)) continue
      // The clip may have been given one already, through the picture it is linked to.
      if (findClip(out, c.id)?.clip.transitionIn !== undefined) continue
      out = addTransition(out, c.id, 'in', at)
    }
  }
  return out
}
