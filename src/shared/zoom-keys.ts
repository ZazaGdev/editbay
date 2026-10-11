/**
 * A clip's crop and zoom: framing, zoom keyframes, the Simple zoom from a Start
 * picture to an End one, and the zoom presets.
 */

import { cropAtKeys } from './crop-geometry'
import { type Place, type LayoutKind, refitInView, viewOf, cropInView } from './layout'
import { evenDown, clamp, evenNear, MAIN_PICTURE, EASES } from './project-core'
import type { Rect, ProjectMedia, Timeline, Layer, Clip, ZoomKey, SimpleEase, Ease } from './project'
import { cleanOverlay } from './drawn-media'
import { updateVideoClip, findVideoClip } from './timeline-query'
import { settleBoxKeys } from './box-keys'

/** A crop snapped to even pixels and clamped inside the source frame. */
export function tidyCrop(rect: Rect, m: ProjectMedia): Rect {
  const maxW = evenDown(m.width)
  const maxH = evenDown(m.height)
  const w = clamp(evenNear(rect.w), 2, maxW)
  const h = clamp(evenNear(rect.h), 2, maxH)
  const x = clamp(evenNear(rect.x), 0, maxW - w)
  const y = clamp(evenNear(rect.y), 0, maxH - h)
  return { x, y, w, h }
}

/**
 * Set the crop of one of a clip's pictures, the main one unless a layer is
 * named. Moving or resizing a crop leaves the layout as it was: the layout is
 * about where the boxes are.
 */
export function setCrop(p: Timeline, clipId: string, rect: Rect, picture: string = MAIN_PICTURE, from?: Rect): Timeline {
  return updateVideoClip(p, clipId, (c, m) => {
    const crop = tidyCrop(rect, m)
    // A crop changed from the one shown on a frame of a zoom: every keyframe
    // follows it as that one did, and no keyframe is added (task 122).
    if (from && (zoomOf(c, picture).keys?.length ?? 0) > 0) return mapCrops(c, following(from, crop, m), undefined, picture)
    if (picture === MAIN_PICTURE) {
      // With a zoom, the crop is the whole clip's framing: where it starts,
      // with every keyframe following it, moved and scaled as the start was
      // and in its shape, so the zoom keeps what it does. A keyframe at the
      // playhead is changed with `setZoomKey` instead.
      const keys = c.transform.keys
      if (!keys || keys.length === 0) return { ...c, transform: { ...c.transform, crop } }
      return recrop(c, crop, m)
    }
    // A further picture's zoom follows its crop the same way.
    const layer = c.layers.find((l) => l.id === picture)
    if (!layer) return c
    return (layer.keys?.length ?? 0) > 0 ? recrop(c, crop, m, picture) : withZoom(c, picture, { ...zoomOf(c, picture), crop })
  })
}

/**
 * How a clip is framed: its main picture's crop and place, its layers and
 * their layout, the size of the recording the crops were drawn on, and the
 * frame the places were set in, so they can be carried over to a recording
 * or a sequence of another size or shape.
 */
export interface Framing {
  crop: Rect
  place: Place
  layers: Layer[]
  layout: LayoutKind
  width: number
  height: number
  frameW: number
  frameH: number
  /** An overlay's turn and opacity, carried onto another overlay and left behind by a recording. */
  rotation?: number
  opacity?: number
}

/** A picture clip's framing, to copy onto another. Null for a clip that is not a picture. */
export function framingOf(p: Timeline, clipId: string): Framing | null {
  const found = findVideoClip(p, clipId)
  const m = found ? p.media.find((x) => x.id === found.clip.mediaId) : undefined
  if (!found || !m) return null
  const c = found.clip
  return {
    crop: c.transform.crop,
    place: c.transform.place,
    // A framing leaves the zoom out, a further picture's as much as the main one's.
    layers: c.layers.map(({ keys: _keys, simple: _simple, ...l }) => l),
    layout: c.layout,
    width: m.width,
    height: m.height,
    frameW: p.output.width,
    frameH: p.output.height,
    ...cleanOverlay(c.transform)
  }
}

/** Width over height of a crop. */
function aspectOf(r: Rect): number {
  return r.h > 0 ? r.w / r.h : 1
}

/**
 * A crop in the shape `aspect`, around the point it frames, unless it is
 * already that shape allowing for the even pixels every crop is snapped to.
 */
function inShape(crop: Rect, aspect: number, m: ProjectMedia): Rect {
  const r = refitInView(crop, m.width, m.height, aspect)
  return Math.abs(r.w - crop.w) <= 2 && Math.abs(r.h - crop.h) <= 2 ? crop : r
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

/**
 * A clip's zoom keyframes kept to what can show, and its crop kept equal to
 * the crop on its first frame.
 *
 * Keyframes are on the recording, so a split or a trim needs nothing done to
 * them for the picture to stay right. What it leaves is keyframes the clip
 * can never reach: of those before its first frame only the last matters, and
 * of those at or after its end only the first, since those are all the
 * frames in between are worked out from. The rest go. An empty list goes too.
 */
export function settleKeys(c: Clip): Clip {
  // Every picture's own zoom, the main one's and each further picture's, and their boxes' keyframes (plan 97).
  let next = settleBoxKeys(c)
  const main = settledZoom(c.transform, c.sourceIn, c.sourceOut)
  if (main) next = withZoom(next, MAIN_PICTURE, main)
  for (const l of c.layers) {
    const z = settledZoom(l, c.sourceIn, c.sourceOut)
    if (z) next = withZoom(next, l.id, z)
  }
  return next
}

/** One picture's zoom settled as `settleKeys` says, or null when it needs nothing done. */
function settledZoom(z: PictureZoom, sourceIn: number, sourceOut: number): PictureZoom | null {
  const keys = z.keys
  if (z.simple !== undefined) return settledSimple(z, sourceIn, sourceOut)
  if (keys === undefined) return null
  if (keys.length === 0) return { crop: z.crop }
  const before = keys.filter((k) => k.at < sourceIn)
  const after = keys.filter((k) => k.at >= sourceOut)
  const kept =
    before.length <= 1 && after.length <= 1
      ? keys
      : [...before.slice(-1), ...keys.filter((k) => k.at >= sourceIn && k.at < sourceOut), ...after.slice(0, 1)]
  const crop = cropAtKeys(z.crop, kept, sourceIn)
  if (kept === keys && sameRect(crop, z.crop)) return null
  return { crop, keys: kept }
}

/**
 * A Simple zoom's keyframes made again from its Start and End, on the clip's
 * first frame and its last as they are now, with its crop kept on Start. With
 * no keyframes it is no zoom, and the mark goes.
 */
function settledSimple(z: PictureZoom, sourceIn: number, sourceOut: number): PictureZoom | null {
  const { keys, simple } = z
  if (!keys || keys.length === 0 || simple === undefined) return { crop: z.crop }
  const start = keys[0]!.crop
  const end = keys[keys.length - 1]!.crop
  const made = simpleKeys(start, end, simple, sourceIn, sourceOut)
  const same =
    made.length === keys.length && made.every((k, i) => k.at === keys[i]!.at && k.ease === keys[i]!.ease && sameRect(k.crop, keys[i]!.crop))
  if (same && sameRect(start, z.crop)) return null
  return { crop: start, simple, keys: made }
}

/**
 * A picture's zoom as a clip keeps it: its crop, and its keyframes and Simple
 * ease when it moves. The main picture keeps it in `transform`, a further
 * picture on itself.
 */
export interface PictureZoom {
  crop: Rect
  keys?: ZoomKey[]
  simple?: SimpleEase
}

export function zoomFields(x: PictureZoom): PictureZoom {
  return { crop: x.crop, ...(x.keys !== undefined ? { keys: x.keys } : {}), ...(x.simple !== undefined ? { simple: x.simple } : {}) }
}

/**
 * The zoom of one of a clip's pictures, the main one unless a further picture
 * is named. A picture the clip does not have, or the End of a Simple zoom,
 * reads as the main picture's.
 */
export function zoomOf(c: Clip, picture: string = MAIN_PICTURE): PictureZoom {
  const l = picture === MAIN_PICTURE ? undefined : c.layers.find((x) => x.id === picture)
  return zoomFields(l ?? c.transform)
}

/** Which picture a zoom edit is for: a further picture of the clip, or the main one. */
function zoomPicture(c: Clip, picture: string | undefined): string {
  return picture !== undefined && c.layers.some((l) => l.id === picture) ? picture : MAIN_PICTURE
}

/** A clip with one picture's zoom replaced: its crop, keyframes and Simple ease, each one absent taken off. */
export function withZoom(c: Clip, picture: string, z: PictureZoom): Clip {
  const put = <T extends PictureZoom>(x: T): T => {
    const { keys: _keys, simple: _simple, ...rest } = x
    return { ...rest, crop: z.crop, ...(z.keys !== undefined ? { keys: z.keys } : {}), ...(z.simple !== undefined ? { simple: z.simple } : {}) } as T
  }
  if (picture === MAIN_PICTURE) return { ...c, transform: put(c.transform) }
  return { ...c, layers: c.layers.map((l) => (l.id === picture ? put(l) : l)) }
}

/**
 * The keyframes of a Simple zoom: Start on the clip's first frame and End on
 * its last, or for a cut, Start held until the middle frame and End from
 * there. A clip one frame long has its End just past it, so Start still shows.
 */
export function simpleKeys(start: Rect, end: Rect, ease: SimpleEase, sourceIn: number, sourceOut: number): ZoomKey[] {
  if (ease === 'cut') {
    const middle = sourceIn + Math.max(1, Math.floor((sourceOut - sourceIn) / 2))
    return [
      { at: sourceIn, crop: start, ease: 'hold' },
      { at: middle, crop: end }
    ]
  }
  return [
    { at: sourceIn, crop: start, ...(ease === 'linear' ? { ease: 'linear' as const } : {}) },
    { at: Math.max(sourceIn + 1, sourceOut - 1), crop: end }
  ]
}

/**
 * A picture's Start and End: for a Simple zoom its first and last keyframes'
 * crops, and for anything else its crop, twice. The main picture's unless a
 * further one is named.
 */
export function startEndOf(c: Clip, picture: string = MAIN_PICTURE): { start: Rect; end: Rect } {
  const z = zoomOf(c, picture)
  const keys = z.keys
  if (z.simple === undefined || !keys || keys.length === 0) return { start: z.crop, end: z.crop }
  return { start: keys[0]!.crop, end: keys[keys.length - 1]!.crop }
}

/**
 * Every video clip of a timeline with its keyframes settled. Run after every
 * edit, since a split, a trim, a slip or a join can each leave a clip with
 * keyframes it cannot reach or a first frame whose crop has changed. A clip
 * that needs nothing done is the same object, so nothing else sees a change.
 * Given the timeline before the edit, only the clips the edit changed are
 * looked at: one it left alone stays exactly as it was, so a clip on a locked
 * track is never changed by an edit somewhere else.
 */
export function settleZoomKeys(p: Timeline, before?: Timeline): Timeline {
  const untouched = new Set<Clip>(before ? before.videoTracks.flatMap((r) => r.clips) : [])
  let changed = false
  const videoTracks = p.videoTracks.map((r) => {
    let rowChanged = false
    const clips = r.clips.map((c) => {
      const next = untouched.has(c) ? c : settleKeys(c)
      if (next !== c) rowChanged = true
      return next
    })
    if (!rowChanged) return r
    changed = true
    return { ...r, clips }
  })
  return changed ? { ...p, videoTracks } : p
}

/**
 * A change of crop, applied to a clip's crop and to every one of its zoom
 * keyframes, so a place reshaped, a layout applied, pictures swapped or a
 * framing pasted reshapes the whole zoom and not only where it starts.
 * `crop` is the clip's new crop when the change already worked it out.
 */
export function mapCrops(c: Clip, f: (r: Rect) => Rect, crop?: Rect, picture: string = MAIN_PICTURE): Clip {
  const z = zoomOf(c, picture)
  const to = crop ?? f(z.crop)
  const keys = z.keys
  if (!keys || keys.length === 0) return withZoom(c, picture, { ...z, crop: to })
  return settleKeys(withZoom(c, picture, { ...z, crop: to, keys: keys.map((k) => ({ ...k, crop: f(k.crop) })) }))
}

/**
 * The change that takes crop `from` to crop `to`, for any other crop of the
 * same picture: moved as its centre was, scaled as its height was, and given
 * the new shape. So a zoom keeps what it does relative to where it starts,
 * and a keyframe on `from` lands exactly on `to`.
 */
function following(from: Rect, to: Rect, m: ProjectMedia): (r: Rect) => Rect {
  const scale = from.h > 0 ? to.h / from.h : 1
  const aspect = aspectOf(to)
  const fx = from.x + from.w / 2
  const fy = from.y + from.h / 2
  const tx = to.x + to.w / 2
  const ty = to.y + to.h / 2
  return (r) => {
    const h = r.h * scale
    const w = h * aspect
    const cx = tx + (r.x + r.w / 2 - fx) * scale
    const cy = ty + (r.y + r.h / 2 - fy) * scale
    return refitInView({ x: cx - w / 2, y: cy - h / 2, w, h }, m.width, m.height, aspect)
  }
}

/** A picture's crop replaced, the main one's unless a further one is named, its zoom keyframes following it. */
export function recrop(c: Clip, crop: Rect, m: ProjectMedia, picture: string = MAIN_PICTURE): Clip {
  return mapCrops(c, following(zoomOf(c, picture).crop, crop, m), crop, picture)
}

/**
 * A clip with these keyframes: sorted, whole frames inside the clip, one to a
 * frame (the later in the list wins), each crop tidied and in the clip's
 * shape, and a Smooth ease left unsaid. None takes the zoom off.
 */
function withKeys(c: Clip, m: ProjectMedia, keys: readonly ZoomKey[], picture: string = MAIN_PICTURE): Clip {
  const z = zoomOf(c, picture)
  const aspect = aspectOf(z.crop)
  const byFrame = new Map<number, ZoomKey>()
  for (const k of keys) {
    const at = clamp(Math.round(k.at), c.sourceIn, Math.max(c.sourceIn, c.sourceOut - 1))
    const ease = k.ease !== undefined && k.ease !== 'smooth' && EASES.includes(k.ease) ? { ease: k.ease } : {}
    byFrame.delete(at)
    byFrame.set(at, { at, crop: inShape(tidyCrop(k.crop, m), aspect, m), ...ease })
  }
  const sorted = [...byFrame.values()].sort((a, b) => a.at - b.at)
  // Keyframes put by hand: whatever they started as, they are not a Simple zoom now.
  return settleKeys(withZoom(c, picture, sorted.length > 0 ? { crop: z.crop, keys: sorted } : { crop: z.crop }))
}

/**
 * Pin a picture's crop on a frame of the recording, the main picture's unless
 * a further one is named: add a keyframe there, or change the one already
 * there, keeping its ease. The crop is held inside the recording and given the
 * picture's shape, and the frame inside the clip.
 */
export function setZoomKey(p: Timeline, clipId: string, at: number, crop: Rect, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c, m) => {
    const pic = zoomPicture(c, picture)
    const keys = zoomOf(c, pic).keys ?? []
    const frame = Math.round(at)
    const had = keys.find((k) => k.at === frame)
    return withKeys(c, m, [...keys, { at: frame, crop, ...(had?.ease ? { ease: had.ease } : {}) }], pic)
  })
}

/** Take off the keyframe on a frame of the recording. The last one gone, the picture stays on the crop its first frame had. */
export function removeZoomKey(p: Timeline, clipId: string, at: number, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c, m) => {
    const pic = zoomPicture(c, picture)
    const keys = zoomOf(c, pic).keys
    return keys?.some((k) => k.at === at) ? withKeys(c, m, keys.filter((k) => k.at !== at), pic) : c
  })
}

/** Move a keyframe to another frame of the clip, taking the place of any already there. */
export function moveZoomKey(p: Timeline, clipId: string, from: number, to: number, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c, m) => {
    const pic = zoomPicture(c, picture)
    const keys = zoomOf(c, pic).keys ?? []
    const moving = keys.find((k) => k.at === from)
    if (!moving) return c
    const frame = clamp(Math.round(to), c.sourceIn, Math.max(c.sourceIn, c.sourceOut - 1))
    return withKeys(c, m, [...keys.filter((k) => k.at !== from && k.at !== frame), { ...moving, at: frame }], pic)
  })
}

/** How the picture gets from the keyframe on this frame to the next one. */
export function setZoomEase(p: Timeline, clipId: string, at: number, ease: Ease, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c, m) => {
    const pic = zoomPicture(c, picture)
    const keys = zoomOf(c, pic).keys
    return keys?.some((k) => k.at === at) ? withKeys(c, m, keys.map((k) => (k.at === at ? { at: k.at, crop: k.crop, ease } : k)), pic) : c
  })
}

/**
 * Every keyframe of a picture at once, tidied as `setZoomKey` tidies one. An
 * empty list takes the zoom off.
 */
export function setZoomKeys(p: Timeline, clipId: string, keys: readonly ZoomKey[], picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c, m) => withKeys(c, m, keys, zoomPicture(c, picture)))
}

/** Take a picture's zoom off: it stays on the crop its first frame had. */
export function clearZoomKeys(p: Timeline, clipId: string, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c) => {
    const pic = zoomPicture(c, picture)
    const z = zoomOf(c, pic)
    if (z.keys === undefined && z.simple === undefined) return c
    return withZoom(c, pic, { crop: z.crop })
  })
}

/** What a Simple zoom's Start, End or ease is changed to; each left out stays as it is. */
export interface SimpleChange {
  start?: Rect
  end?: Rect
  ease?: SimpleEase
}

/**
 * Change a clip's Simple zoom: its Start, its End, or how it gets from one to
 * the other. Each crop is held inside the recording and given the clip's
 * shape. A clip that stays still has its End move with its Start, so framing
 * Start reframes the whole clip, and only a different End makes it move.
 * Start and End the same is no zoom: the mark and the keyframes go.
 */
export function setSimpleZoom(p: Timeline, clipId: string, change: SimpleChange, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c, m) => {
    const pic = zoomPicture(c, picture)
    const z = zoomOf(c, pic)
    const was = startEndOf(c, pic)
    const still = z.simple === undefined
    const aspect = aspectOf(z.crop)
    const fit = (r: Rect): Rect => inShape(tidyCrop(r, m), aspect, m)
    const start = change.start ? fit(change.start) : was.start
    const end = change.end ? fit(change.end) : still ? start : was.end
    return simpleClip(c, start, end, change.ease ?? z.simple ?? 'smooth', pic)
  })
}

/** A clip whose picture has this Simple zoom, or none when Start and End are the same. */
export function simpleClip(c: Clip, start: Rect, end: Rect, ease: SimpleEase, picture: string = MAIN_PICTURE): Clip {
  if (sameRect(start, end)) return withZoom(c, picture, { crop: start })
  return withZoom(c, picture, { crop: start, simple: ease, keys: simpleKeys(start, end, ease, c.sourceIn, c.sourceOut) })
}

/** A Simple zoom made keyframes put by hand, on the frames they are on now, so nothing on screen changes. */
export function useKeyframes(p: Timeline, clipId: string, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c) => {
    const pic = zoomPicture(c, picture)
    const z = zoomOf(c, pic)
    if (z.simple === undefined) return c
    return withZoom(c, pic, { crop: z.crop, ...(z.keys ? { keys: z.keys } : {}) })
  })
}

/**
 * Keyframes made a Simple zoom: Start is the picture on the clip's first
 * frame and End the one on its last, and whatever the keyframes in between
 * did goes. The first keyframe's ease says how it gets there: steady stays
 * steady, a jump becomes a cut, and anything else is smooth.
 */
export function useSimpleZoom(p: Timeline, clipId: string, picture?: string): Timeline {
  return updateVideoClip(p, clipId, (c, m) => {
    const pic = zoomPicture(c, picture)
    const z = zoomOf(c, pic)
    const keys = z.keys
    if (z.simple !== undefined || !keys || keys.length === 0) return c
    const aspect = aspectOf(z.crop)
    const fit = (r: Rect): Rect => inShape(tidyCrop(r, m), aspect, m)
    const start = fit(cropAtKeys(z.crop, keys, c.sourceIn))
    const end = fit(cropAtKeys(z.crop, keys, Math.max(c.sourceIn, c.sourceOut - 1)))
    const first = keys.find((k) => k.at >= c.sourceIn) ?? keys[0]!
    const ease: SimpleEase = first.ease === 'linear' ? 'linear' : first.ease === 'hold' ? 'cut' : 'smooth'
    return simpleClip(c, start, end, ease, pic)
  })
}

/**
 * Whether going to a Simple zoom would lose anything: keyframes other than
 * one on the clip's first frame and one on its last. The main picture's zoom
 * unless a further picture is named.
 */
export function simpleLoses(c: Clip, picture: string = MAIN_PICTURE): boolean {
  const z = zoomOf(c, picture)
  const keys = z.keys
  if (z.simple !== undefined || !keys || keys.length === 0) return false
  const first = keys.find((k) => k.at >= c.sourceIn) ?? keys[0]!
  const ease: SimpleEase = first.ease === 'linear' ? 'linear' : first.ease === 'hold' ? 'cut' : 'smooth'
  const start = cropAtKeys(z.crop, keys, c.sourceIn)
  const end = cropAtKeys(z.crop, keys, Math.max(c.sourceIn, c.sourceOut - 1))
  const made = simpleKeys(start, end, ease, c.sourceIn, c.sourceOut)
  // Every frame of the clip as Simple would show it, against what it shows now, to a pixel or two.
  for (let f = c.sourceIn; f < c.sourceOut; f++) {
    const now = cropAtKeys(z.crop, keys, f)
    const then = cropAtKeys(start, made, f)
    if (Math.max(Math.abs(now.x - then.x), Math.abs(now.y - then.y), Math.abs(now.w - then.w), Math.abs(now.h - then.h)) > 2) return true
  }
  return false
}

/** The three zooms made in one click, each of ordinary keyframes that can be edited afterwards. */
export type ZoomPreset = 'punch' | 'in' | 'inOut'

/**
 * How much closer a preset goes unless told otherwise: 150%, where the
 * largest crop of the clip's shape its view holds is 100%. It was 120%, which
 * was too little to see on a phone.
 */
export const PRESET_SCALE = 1.5

/** How a one click zoom is made: how far in, on what point of the recording, and how many frames the ease takes. */
export interface PresetOptions {
  /** A factor of the 100% crop: 1.5 for 150%. */
  scale?: number
  /** The point of the recording, in its pixels, to close in on. The middle of the picture when left out. */
  point?: { x: number; y: number }
  /** How many frames Zoom in and Zoom in and out take to get there. Half a second when left out. */
  ramp?: number
}

/**
 * A zoom made in one click, from frame `from` of the recording: **punch**
 * jumps in on that frame, **in** eases in, and **inOut** eases in from
 * `from`, holds, and eases back out by `to`. Each starts from the crop the
 * picture already has on `from`, and closes in on `options.point`, or that
 * crop's centre, kept inside the view it shows.
 */
export function zoomPreset(
  p: Timeline,
  clipId: string,
  kind: ZoomPreset,
  from: number,
  to: number,
  picture?: string,
  options: PresetOptions = {}
): Timeline {
  return updateVideoClip(p, clipId, (c, m) => {
    const pic = zoomPicture(c, picture)
    const z = zoomOf(c, pic)
    const last = Math.max(c.sourceIn, c.sourceOut - 1)
    const start = clamp(Math.round(from), c.sourceIn, last)
    const base = cropAtKeys(z.crop, z.keys, start)
    const view = viewOf(base, m.width, m.height)
    const full = cropInView(view, aspectOf(base))
    const scale = clamp(options.scale ?? PRESET_SCALE, 1, 4)
    const w = full.w / scale
    const h = full.h / scale
    const cx = options.point?.x ?? base.x + base.w / 2
    const cy = options.point?.y ?? base.y + base.h / 2
    const closer = {
      x: clamp(cx - w / 2, view.x, view.x + view.w - w),
      y: clamp(cy - h / 2, view.y, view.y + view.h - h),
      w,
      h
    }
    const half = Math.max(1, Math.round(options.ramp ?? p.fps / 2))
    const had = z.keys ?? []
    if (kind === 'punch') {
      // The frame before holds what was there, so the jump is on this frame and nowhere else.
      const hold: ZoomKey[] = start > c.sourceIn ? [{ at: start - 1, crop: base, ease: 'hold' }] : []
      return withKeys(c, m, [...had, ...hold, { at: start, crop: closer }], pic)
    }
    if (kind === 'in') return withKeys(c, m, [...had, { at: start, crop: base }, { at: Math.min(last, start + half), crop: closer }], pic)
    const end = clamp(Math.round(to), start, last)
    const ramp = Math.min(half, Math.floor((end - start) / 2))
    if (ramp < 1) return c
    return withKeys(
      c,
      m,
      [...had, { at: start, crop: base }, { at: start + ramp, crop: closer }, { at: end - ramp, crop: closer }, { at: end, crop: base }],
      pic
    )

  })
}
