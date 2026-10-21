/**
 * A picture's box moving over time (plan 97): where the box is and how
 * see-through on frames of the recording, worked out between keyframes as a
 * zoom is, and the edits that set them, the one-step "Move out of the way"
 * among them.
 *
 * Kept beside a picture's zoom keyframes rather than in them: a zoom edit
 * never moves the box, and a box edit never bends the zoom. The diamonds,
 * `Alt+K` and the ease menu stand for both at once.
 */

import { easeOf } from './crop-geometry'
import { isFullFrame, type Place } from './layout'
import { clamp, EASES, MAIN_PICTURE } from './project-core'
import type { BoxKey, Clip, Ease, Timeline } from './project'
import { findVideoClip, updateVideoClip } from './timeline-query'
import { sourceAt } from './tracks'

/** Where a box is and how much of it is drawn, 0 to 1. */
export interface BoxAt {
  place: Place
  opacity: number
}

/** A picture's box keyframes, the main picture's unless a further one is named. Undefined for none. */
export function boxKeysOf(c: Clip, picture: string = MAIN_PICTURE): BoxKey[] | undefined {
  if (picture === MAIN_PICTURE) return c.transform.boxKeys
  return c.layers.find((l) => l.id === picture)?.boxKeys
}

/** A picture's place as it stays without keyframes. */
export function staticPlaceOf(c: Clip, picture: string = MAIN_PICTURE): Place {
  if (picture === MAIN_PICTURE) return c.transform.place
  return c.layers.find((l) => l.id === picture)?.place ?? c.transform.place
}

/** A clip with one picture's box keyframes replaced; none, or an empty list, takes them off. */
export function withBoxKeys(c: Clip, picture: string, keys: readonly BoxKey[] | undefined): Clip {
  const put = <T extends { boxKeys?: BoxKey[] }>(x: T): T => {
    const { boxKeys: _gone, ...rest } = x
    return (keys && keys.length > 0 ? { ...rest, boxKeys: [...keys] } : rest) as T
  }
  if (picture === MAIN_PICTURE) return { ...c, transform: put(c.transform) }
  return { ...c, layers: c.layers.map((l) => (l.id === picture ? put(l) : l)) }
}

/**
 * The box on a frame of the recording: its own place and fully drawn with no
 * keyframes, the first keyframe's before them, the last's after, and between
 * two each of x, y, w, h and opacity moved by the eased fraction, as
 * `cropAtKeys` moves a crop. Nothing is rounded: the preview draws in
 * fractions and the export works its expressions out the same way.
 */
export function boxAtKeys(place: Place, keys: readonly BoxKey[] | undefined, frame: number): BoxAt {
  if (!keys || keys.length === 0) return { place, opacity: 1 }
  const of = (k: BoxKey): BoxAt => ({ place: k.place, opacity: k.opacity ?? 1 })
  const first = keys[0]!
  if (frame < first.at) return of(first)
  const last = keys[keys.length - 1]!
  if (frame >= last.at) return of(last)
  let i = 0
  while (keys[i + 1]!.at <= frame) i++
  const a = keys[i]!
  const b = keys[i + 1]!
  const t = easeOf(a.ease, (frame - a.at) / (b.at - a.at))
  const mix = (x: number, y: number): number => x + (y - x) * t
  return {
    place: { x: mix(a.place.x, b.place.x), y: mix(a.place.y, b.place.y), w: mix(a.place.w, b.place.w), h: mix(a.place.h, b.place.h) },
    opacity: mix(a.opacity ?? 1, b.opacity ?? 1)
  }
}

/** Whether a picture's box keyframes go anywhere: two or more that differ in place or opacity. */
export function boxMoves(keys: readonly BoxKey[] | undefined): boolean {
  if (!keys || keys.length < 2) return false
  const a = keys[0]!
  return keys.some(
    (k) =>
      Math.abs(k.place.x - a.place.x) > 1e-6 ||
      Math.abs(k.place.y - a.place.y) > 1e-6 ||
      Math.abs(k.place.w - a.place.w) > 1e-6 ||
      Math.abs(k.place.h - a.place.h) > 1e-6 ||
      Math.abs((k.opacity ?? 1) - (a.opacity ?? 1)) > 1e-6
  )
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** One keyframe as it is kept, or null for one that makes no sense. */
function cleanKey(raw: unknown): BoxKey | null {
  if (!raw || typeof raw !== 'object') return null
  const k = raw as { at?: unknown; place?: unknown; opacity?: unknown; ease?: unknown }
  const p = k.place as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined
  if (!finite(k.at) || !p || !finite(p.x) || !finite(p.y) || !finite(p.w) || !finite(p.h) || !(p.w > 0) || !(p.h > 0)) return null
  const opacity = finite(k.opacity) ? clamp(k.opacity, 0, 1) : 1
  const ease = typeof k.ease === 'string' && k.ease !== 'smooth' && EASES.includes(k.ease as Ease) ? { ease: k.ease as Ease } : {}
  return { at: Math.round(k.at), place: { x: p.x, y: p.y, w: p.w, h: p.h }, ...(opacity < 1 ? { opacity } : {}), ...ease }
}

/** Box keyframes as a file keeps them, sorted and one to a frame, or undefined for none. */
export function cleanBoxKeys(raw: unknown): BoxKey[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const byFrame = new Map<number, BoxKey>()
  for (const r of raw) {
    const k = cleanKey(r)
    if (k) byFrame.set(k.at, k)
  }
  const keys = [...byFrame.values()].sort((a, b) => a.at - b.at)
  return keys.length > 0 ? keys : undefined
}

/**
 * Box keyframes kept to what a clip can show, as zoom keyframes are: of those
 * before its first frame only the last matters, and of those at or after its
 * end only the first.
 */
function settled(keys: BoxKey[] | undefined, sourceIn: number, sourceOut: number): BoxKey[] | undefined {
  if (!keys || keys.length === 0) return undefined
  const before = keys.filter((k) => k.at < sourceIn)
  const after = keys.filter((k) => k.at >= sourceOut)
  if (before.length <= 1 && after.length <= 1) return keys
  return [...before.slice(-1), ...keys.filter((k) => k.at >= sourceIn && k.at < sourceOut), ...after.slice(0, 1)]
}

/** Every picture's box keyframes settled after a trim or a split. */
export function settleBoxKeys(c: Clip): Clip {
  let next = c
  const main = settled(c.transform.boxKeys, c.sourceIn, c.sourceOut)
  if (main !== c.transform.boxKeys) next = withBoxKeys(next, MAIN_PICTURE, main)
  for (const l of c.layers) {
    const keys = settled(l.boxKeys, c.sourceIn, c.sourceOut)
    if (keys !== l.boxKeys) next = withBoxKeys(next, l.id, keys)
  }
  return next
}

/** Which picture a box edit is for: a further picture of the clip, or the main one. */
function boxPicture(c: Clip, picture: string | undefined): string {
  return picture !== undefined && c.layers.some((l) => l.id === picture) ? picture : MAIN_PICTURE
}

/** A picture's box keyframes replaced, tidied: inside the clip, one to a frame, sorted. */
function withTidyKeys(c: Clip, picture: string, keys: readonly BoxKey[]): Clip {
  const byFrame = new Map<number, BoxKey>()
  for (const k of keys) {
    const at = clamp(Math.round(k.at), c.sourceIn, Math.max(c.sourceIn, c.sourceOut - 1))
    byFrame.delete(at)
    const tidy = cleanKey({ ...k, at })
    if (tidy) byFrame.set(at, tidy)
  }
  return withBoxKeys(c, picture, [...byFrame.values()].sort((a, b) => a.at - b.at))
}

/** Pin a picture's box on a frame of the recording, keeping the ease of a keyframe already there. */
export function setBoxKey(p: Timeline, clipId: string, at: number, place: Place, opacity?: number, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c) => {
    const pic = boxPicture(c, picture)
    const keys = boxKeysOf(c, pic) ?? []
    const frame = Math.round(at)
    const had = keys.find((k) => k.at === frame)
    const o = opacity ?? had?.opacity
    return withTidyKeys(c, pic, [...keys, { at: frame, place, ...(o !== undefined ? { opacity: o } : {}), ...(had?.ease ? { ease: had.ease } : {}) }])
  })
}

/** Take off the box keyframe on a frame of the recording, if there is one. */
export function removeBoxKey(p: Timeline, clipId: string, at: number, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c) => {
    const pic = boxPicture(c, picture)
    const keys = boxKeysOf(c, pic)
    return keys?.some((k) => k.at === at) ? withBoxKeys(c, pic, keys.filter((k) => k.at !== at)) : c
  })
}

/** Move a box keyframe to another frame of the clip, taking the place of any already there. */
export function moveBoxKey(p: Timeline, clipId: string, from: number, to: number, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c) => {
    const pic = boxPicture(c, picture)
    const keys = boxKeysOf(c, pic) ?? []
    const moving = keys.find((k) => k.at === from)
    if (!moving) return c
    const frame = clamp(Math.round(to), c.sourceIn, Math.max(c.sourceIn, c.sourceOut - 1))
    return withTidyKeys(c, pic, [...keys.filter((k) => k.at !== from && k.at !== frame), { ...moving, at: frame }])
  })
}

/** How the box gets from the keyframe on this frame to the next one. */
export function setBoxEase(p: Timeline, clipId: string, at: number, ease: Ease, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c) => {
    const pic = boxPicture(c, picture)
    const keys = boxKeysOf(c, pic)
    if (!keys?.some((k) => k.at === at)) return c
    return withTidyKeys(c, pic, keys.map((k) => (k.at === at ? { ...k, ease } : k)))
  })
}

/** Take a picture's box keyframes off: it stays on its own place. */
export function clearBoxKeys(p: Timeline, clipId: string, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c) => withBoxKeys(c, boxPicture(c, picture), undefined))
}

/** How "Move out of the way" moves the box: to another corner and back, or out of sight and back. */
export type OutOfTheWay = 'slide' | 'fade'

/** How long the box takes to go and to come back, in seconds. */
export const OUT_OF_THE_WAY_SECONDS = 0.25

/**
 * The corner a box slides to, in a frame `frameW` by `frameH` pixels: of the
 * three other corners at the same distance from the edges as it is now, the
 * nearest one no other small box of the clip is in, the one beside it before
 * the one below it. Null when every corner is taken.
 */
export function freeCorner(box: Place, others: readonly Place[], frameW: number, frameH: number): Place {
  const left = box.x * frameW
  const top = box.y * frameH
  const right = frameW - (box.x + box.w) * frameW
  const bottom = frameH - (box.y + box.h) * frameH
  const mx = Math.max(0, Math.min(left, right)) / frameW
  const my = Math.max(0, Math.min(top, bottom)) / frameH
  const xs = [mx, 1 - box.w - mx]
  const ys = [my, 1 - box.h - my]
  const onLeft = left <= right
  const onTop = top <= bottom
  const candidates: Place[] = [
    // Beside it first, then below or above it, then across.
    { x: onLeft ? xs[1]! : xs[0]!, y: onTop ? ys[0]! : ys[1]!, w: box.w, h: box.h },
    { x: onLeft ? xs[0]! : xs[1]!, y: onTop ? ys[1]! : ys[0]!, w: box.w, h: box.h },
    { x: onLeft ? xs[1]! : xs[0]!, y: onTop ? ys[1]! : ys[0]!, w: box.w, h: box.h }
  ]
  // A small box only: a picture filling most of the frame is under every corner.
  const small = others.filter((o) => o.w * o.h < 0.5)
  const overlaps = (a: Place, b: Place): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  return candidates.find((c) => !small.some((o) => overlaps(c, o))) ?? candidates[0]!
}

/**
 * The box moved out of the way between two frames of the recording and back
 * (plan 97): from where it is at `from`, over a quarter of a second, to a free
 * corner or out of sight, held there, and back over a quarter of a second to
 * where it is at `to`. Box keyframes between the two go; those outside stay.
 */
export function moveOutOfTheWay(p: Timeline, clipId: string, from: number, to: number, how: OutOfTheWay, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c) => {
    const pic = boxPicture(c, picture)
    const a = clamp(Math.round(Math.min(from, to)), c.sourceIn, Math.max(c.sourceIn, c.sourceOut - 1))
    const b = clamp(Math.round(Math.max(from, to)), c.sourceIn, Math.max(c.sourceIn, c.sourceOut - 1))
    if (b - a < 2) return c
    const ramp = Math.max(1, Math.min(Math.round(OUT_OF_THE_WAY_SECONDS * p.fps), Math.floor((b - a) / 3)))
    const keys = boxKeysOf(c, pic)
    const place = staticPlaceOf(c, pic)
    const start = boxAtKeys(place, keys, a)
    const end = boxAtKeys(place, keys, b)
    const others = [MAIN_PICTURE, ...c.layers.map((l) => l.id)].filter((id) => id !== pic).map((id) => staticPlaceOf(c, id))
    const away: BoxAt =
      how === 'fade'
        ? { place: start.place, opacity: 0 }
        : { place: freeCorner(start.place, others, p.output.width, p.output.height), opacity: start.opacity }
    const key = (at: number, box: BoxAt): BoxKey => ({ at, place: box.place, ...(box.opacity < 1 ? { opacity: box.opacity } : {}) })
    const kept = (keys ?? []).filter((k) => k.at < a || k.at > b)
    return withTidyKeys(c, pic, [...kept, key(a, start), key(a + ramp, away), key(b - ramp, away), key(b, end)])
  })
}

/**
 * A zoom keyframe pinned on a small box's picture pins the box there too, as
 * it is on that frame (plan 97): `Alt+K` and Add keyframe keyframe the box,
 * and a drag of it on the Output view at another frame then moves it. A
 * picture that fills the frame has no box to keyframe.
 */
export function pinBoxWith(p: Timeline, clipId: string, at: number, picture?: string): Timeline {
  const found = findVideoClip(p, clipId)
  if (!found) return p
  const pic = boxPicture(found.clip, picture)
  const place = staticPlaceOf(found.clip, pic)
  if (isFullFrame(place)) return p
  const box = boxAtKeys(place, boxKeysOf(found.clip, pic), Math.round(at))
  return setBoxKey(p, clipId, at, box.place, box.opacity < 1 ? box.opacity : undefined, pic)
}

/** Where a picture's box is on the sequence frame under the playhead, when it has box keyframes; null when it stays on its place. */
export function boxAtPlayhead(c: Clip, playhead: number, picture: string = MAIN_PICTURE): Place | null {
  const keys = boxKeysOf(c, picture)
  if (!keys || keys.length === 0) return null
  return boxAtKeys(staticPlaceOf(c, picture), keys, sourceAt(c, playhead)).place
}

/** How long "Move out of the way" keeps the box away when no range is marked, in seconds from the playhead. */
export const OUT_OF_THE_WAY_HOLD = 1.5
