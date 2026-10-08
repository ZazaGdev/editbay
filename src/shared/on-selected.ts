import { mapCrop } from './groups'
import { findVideoClip, MAIN_PICTURE, withZoom, zoomOf, type Clip, type Rect, type Timeline } from './project'
import type { Place } from './layout'

/**
 * Bugs and notes 2, note 32: a picture moved or cropped on one of several
 * selected clips is moved or cropped on all of them, as one edit.
 *
 * The same place and the same crop, as a share of the frame and of each
 * recording, rather than the same change from where each was: the point is
 * nearly always to make them match. Only what the edit changed follows, the
 * place or the crop, so one drag never rewrites anything else. A selected
 * clip without that picture is left as it is.
 */

/**
 * The picture of `to` that is picture `picture` of `from`: the main picture,
 * a further picture with the same id, as the pieces of a split have, or the
 * one in the same position among the further pictures. Null when it has none.
 */
export function matchingPicture(from: Clip, picture: string, to: Clip): string | null {
  if (picture === MAIN_PICTURE) return MAIN_PICTURE
  if (to.layers.some((l) => l.id === picture)) return picture
  const at = from.layers.findIndex((l) => l.id === picture)
  return at >= 0 ? (to.layers[at]?.id ?? null) : null
}

function placeOf(c: Clip, picture: string): Place | undefined {
  return picture === MAIN_PICTURE ? c.transform.place : c.layers.find((l) => l.id === picture)?.place
}

function sameRect(a: Rect | undefined, b: Rect | undefined): boolean {
  return a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

/**
 * After an edit to one picture of `clipId`, its place and crop, whichever the
 * edit changed, put on the matching picture of every clip in `also`.
 */
export function mirrorPicture(before: Timeline, after: Timeline, clipId: string, picture: string, also: readonly string[]): Timeline {
  const was = findVideoClip(before, clipId)?.clip
  const now = findVideoClip(after, clipId)?.clip
  if (!was || !now) return after
  const place = placeOf(now, picture)
  const crop = zoomOf(now, picture).crop
  const moved = place !== undefined && !sameRect(placeOf(was, picture), place)
  const cropped = !sameRect(zoomOf(was, picture).crop, crop)
  if (!moved && !cropped) return after
  const size = (mediaId: string): { width: number; height: number } => {
    const m = after.media.find((x) => x.id === mediaId)
    return { width: m?.width ?? 1, height: m?.height ?? 1 }
  }
  const others = new Set(also.filter((id) => id !== clipId))
  const follow = (c: Clip): Clip => {
    if (!others.has(c.id)) return c
    const target = matchingPicture(now, picture, c)
    if (target === null) return c
    let next = c
    if (moved) {
      next =
        target === MAIN_PICTURE
          ? { ...next, transform: { ...next.transform, place: place! }, layout: 'custom' }
          : { ...next, layers: next.layers.map((l) => (l.id === target ? { ...l, place: place! } : l)), layout: 'custom' }
    }
    if (cropped) next = withZoom(next, target, { ...zoomOf(next, target), crop: mapCrop(crop, size(now.mediaId), size(c.mediaId)) })
    return next
  }
  return { ...after, videoTracks: after.videoTracks.map((r) => (r.clips.some((c) => others.has(c.id)) ? { ...r, clips: r.clips.map(follow) } : r)) }
}

/**
 * How many of the clips named have no picture matching `picture` of `clipId`,
 * which a change made on all of them leaves as they are.
 */
export function withoutPicture(p: Timeline, clipId: string, picture: string, also: readonly string[]): number {
  const from = findVideoClip(p, clipId)?.clip
  if (!from) return 0
  return also.filter((id) => {
    if (id === clipId) return false
    const c = findVideoClip(p, id)?.clip
    return c !== undefined && matchingPicture(from, picture, c) === null
  }).length
}

/**
 * The crop of the matching picture of each clip named, in `clipId`'s
 * recording's pixels, and whether they all agree with `clipId`'s own: a
 * number the Inspector shows as Mixed when they do not.
 */
export function cropsAgree(p: Timeline, clipId: string, picture: string, also: readonly string[]): { x: boolean; y: boolean; w: boolean; h: boolean } {
  const from = findVideoClip(p, clipId)?.clip
  const agree = { x: true, y: true, w: true, h: true }
  if (!from) return agree
  const size = (mediaId: string): { width: number; height: number } => {
    const m = p.media.find((x) => x.id === mediaId)
    return { width: m?.width ?? 1, height: m?.height ?? 1 }
  }
  const mine = zoomOf(from, picture).crop
  for (const id of also) {
    if (id === from.id) continue
    const c = findVideoClip(p, id)?.clip
    const target = c ? matchingPicture(from, picture, c) : null
    if (!c || target === null) continue
    const theirs = mapCrop(zoomOf(c, target).crop, size(c.mediaId), size(from.mediaId))
    // Within a pixel or two: mapping between recordings rounds.
    if (Math.abs(theirs.x - mine.x) > 2) agree.x = false
    if (Math.abs(theirs.y - mine.y) > 2) agree.y = false
    if (Math.abs(theirs.w - mine.w) > 2) agree.w = false
    if (Math.abs(theirs.h - mine.h) > 2) agree.h = false
  }
  return agree
}
