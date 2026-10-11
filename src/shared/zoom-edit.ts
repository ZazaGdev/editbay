import { cropAtKeys } from './crop-geometry'
import { cropInView, viewOf, type Place } from './layout'
import { MAIN_PICTURE, clipLength, startEndOf, zoomOf, type Clip, type Ease, type Rect, type SimpleEase, type ZoomKey } from './project'
import type { ClipEdit } from './types'
import { boxKeysOf } from './box-keys'

/**
 * Plan 60, stages 2 and 3: what the Zoom group, the crop box, the nudge keys
 * and the keyframe keys say about a clip's zoom at the playhead, and the edit
 * each of them sends. In one place so all of them say the same thing.
 *
 * A keyframe is on a frame of the recording. The playhead is on a frame of
 * the sequence. The frame of the recording under the playhead is
 * `sourceIn + playhead - timelineStart`.
 *
 * Plan 73: every picture of a clip has a zoom of its own. Each helper is for
 * the main picture unless a further picture is named, and a Simple zoom's End
 * is a choice made beside the picture (`end`), not a picture of its own.
 */

/** How far in Scale goes: past this the picture is too soft to be worth having. */
export const MAX_SCALE = 400

/** The frame of the recording under the playhead, held inside the clip when the playhead is outside it. */
export function sourceFrameAt(c: Clip, playhead: number): number {
  const last = Math.max(c.sourceIn, c.sourceOut - 1)
  return Math.min(last, Math.max(c.sourceIn, c.sourceIn + playhead - c.timelineStart))
}

/** Whether the playhead is on one of the clip's frames. */
export function playheadInside(c: Clip, playhead: number): boolean {
  return playhead >= c.timelineStart && playhead < c.timelineStart + clipLength(c)
}

/** The frame of the sequence a keyframe's frame of the recording is shown on in this clip. */
export function timelineFrameOf(c: Clip, at: number): number {
  return c.timelineStart + at - c.sourceIn
}

/** The picture a helper is for: a further picture the clip has, or its main one. */
function pictureOf(c: Clip, picture: string): string {
  return c.layers.some((l) => l.id === picture) ? picture : MAIN_PICTURE
}

/** The edit's picture field: left out for the main picture, as edits before plan 73 were. */
function forPicture(c: Clip, picture: string): { picture?: string } {
  const pic = pictureOf(c, picture)
  return pic === MAIN_PICTURE ? {} : { picture: pic }
}

/** Whether a picture of the clip has keyframes at all. */
export function hasKeys(c: Clip, picture: string = MAIN_PICTURE): boolean {
  return (zoomOf(c, picture).keys?.length ?? 0) > 0
}

/**
 * Whether a picture's zoom is a Simple one, or none yet, which Simple is where
 * a picture starts: anything but keyframes put by hand.
 */
export function isSimple(c: Clip, picture: string = MAIN_PICTURE): boolean {
  return zoomOf(c, picture).simple !== undefined || !hasKeys(c, picture)
}

/** Whether a picture's End is the one chosen: only when its zoom is Simple. */
export function onEnd(c: Clip, picture: string, end: boolean): boolean {
  return end && isSimple(c, picture)
}

/**
 * A picture's crop the crop box, the Crop numbers and the nudge keys show: for
 * a Simple zoom its Start or its End, whichever is chosen, and for keyframes
 * the crop at the playhead.
 */
export function shownCrop(c: Clip, playhead: number, picture: string = MAIN_PICTURE, end = false): Rect {
  if (!isSimple(c, picture)) return cropAtPlayhead(c, playhead, picture)
  const ends = startEndOf(c, picture)
  return onEnd(c, picture, end) ? ends.end : ends.start
}

/** A picture's keyframes on the clip's own frames: those before or after it only steer the frames at its edges. */
export function keysInClip(c: Clip, picture: string = MAIN_PICTURE): ZoomKey[] {
  const z = zoomOf(c, picture)
  const inside = (k: { at: number }): boolean => k.at >= c.sourceIn && k.at < c.sourceOut
  const zoomKeys = (z.keys ?? []).filter(inside)
  // Plan 97: a box keyframe is a diamond too, on a frame with no zoom keyframe
  // standing for it the crop there, so it is gone to, moved, eased and taken
  // off as one. A Simple zoom shows its Start and End alone.
  if (z.simple !== undefined) return zoomKeys
  const boxOnly = (boxKeysOf(c, picture) ?? []).filter((b) => inside(b) && !zoomKeys.some((k) => k.at === b.at))
  if (boxOnly.length === 0) return zoomKeys
  const standIns = boxOnly.map((b) => ({ at: b.at, crop: cropAtKeys(z.crop, z.keys, b.at), ...(b.ease ? { ease: b.ease } : {}) }))
  return [...zoomKeys, ...standIns].sort((a, b) => a.at - b.at)
}

/** A picture's crop on the frame under the playhead. */
export function cropAtPlayhead(c: Clip, playhead: number, picture: string = MAIN_PICTURE): Rect {
  const z = zoomOf(c, picture)
  return cropAtKeys(z.crop, z.keys, sourceFrameAt(c, playhead))
}

/** A picture's keyframe on the frame under the playhead, if there is one. */
export function keyAtPlayhead(c: Clip, playhead: number, picture: string = MAIN_PICTURE): ZoomKey | undefined {
  if (!playheadInside(c, playhead)) return undefined
  const at = sourceFrameAt(c, playhead)
  return keysInClip(c, picture).find((k) => k.at === at)
}

/**
 * The edit that puts `rect` on a picture at the playhead: its whole crop
 * while it has no keyframes, and otherwise the keyframe on the frame under the
 * playhead, made there if there is none. So the crop box, the Crop numbers,
 * Scale and Position and the nudge keys are one thing.
 *
 * That is while the zoom is being worked on, its Start or End or a keyframe
 * picked in the Zoom panel. Otherwise a crop is only a crop: a picture that
 * zooms has its whole zoom moved and scaled with it, keeping its motion, and
 * gets no keyframe (task 122).
 */
export function cropEdit(c: Clip, playhead: number, rect: Rect, picture: string = MAIN_PICTURE, end = false, zooming = true): ClipEdit {
  const pic = forPicture(c, picture)
  if (!zooming) {
    const from = hasKeys(c, picture) ? { from: shownCrop(c, playhead, picture) } : {}
    return { kind: 'setCrop', clipId: c.id, rect, picture: pictureOf(c, picture), ...from }
  }
  if (!isSimple(c, picture)) return { kind: 'setZoomKey', clipId: c.id, at: sourceFrameAt(c, playhead), crop: rect, ...pic }
  // Simple: the End chosen, or the Start of a picture that moves. A still picture's Start is its crop.
  if (onEnd(c, picture, end)) return { kind: 'setSimpleZoom', clipId: c.id, change: { end: rect }, ...pic }
  if (zoomOf(c, picture).simple !== undefined) return { kind: 'setSimpleZoom', clipId: c.id, change: { start: rect }, ...pic }
  return { kind: 'setCrop', clipId: c.id, rect, picture: pictureOf(c, picture) }
}

/**
 * The diamond: a keyframe at the playhead taken off, or the framing there
 * pinned with a new one. Null while the playhead is not on the clip.
 */
export function toggleKeyEdit(c: Clip, playhead: number, picture: string = MAIN_PICTURE): ClipEdit | null {
  if (!playheadInside(c, playhead)) return null
  const at = sourceFrameAt(c, playhead)
  const pic = forPicture(c, picture)
  return keyAtPlayhead(c, playhead, picture)
    ? { kind: 'removeZoomKey', clipId: c.id, at, ...pic }
    : { kind: 'setZoomKey', clipId: c.id, at, crop: cropAtPlayhead(c, playhead, picture), ...pic }
}

/**
 * The frame of the sequence of a picture's nearest keyframe before the
 * playhead, or after it, or null when there is none that way.
 */
export function neighbourKey(c: Clip, playhead: number, way: 'previous' | 'next', picture: string = MAIN_PICTURE): number | null {
  const frames = keysInClip(c, picture).map((k) => timelineFrameOf(c, k.at))
  const found = way === 'previous' ? frames.filter((f) => f < playhead).pop() : frames.find((f) => f > playhead)
  return found ?? null
}

/** The shape of a picture's crop, which every keyframe of it has: width over height. */
export function shapeOf(c: Clip, picture: string = MAIN_PICTURE): number {
  const r = zoomOf(c, picture).crop
  return r.h > 0 ? r.w / r.h : 1
}


/**
 * The largest crop of the clip's shape inside the view this crop is in: what
 * 100% is. The shape is the clip's, given as `aspect`, rather than read off
 * a small crop, whose even pixels bend it a little.
 */
export function fullCropOf(crop: Rect, width: number, height: number, aspect = crop.h > 0 ? crop.w / crop.h : 1): Rect {
  return cropInView(viewOf(crop, width, height), aspect)
}

/**
 * How close in a crop is, in per cent: 100 for the largest of its shape, 200
 * for half as wide. Read off its longer side, which the even pixels every
 * crop is snapped to throw out the least: on a small recording a 9:16 crop
 * is only 200 or so pixels wide, and two pixels there is a whole per cent.
 */
export function scaleOf(crop: Rect, width: number, height: number, aspect?: number): number {
  const full = fullCropOf(crop, width, height, aspect)
  if (crop.h > crop.w) return crop.h > 0 ? (full.h / crop.h) * 100 : 100
  return crop.w > 0 ? (full.w / crop.w) * 100 : 100
}

/** A crop of `w` by `h` around a centre, held inside the view `around` is in. */
function centred(around: Rect, cx: number, cy: number, w: number, h: number, width: number, height: number): Rect {
  const view = viewOf(around, width, height)
  return {
    x: Math.min(view.x + view.w - w, Math.max(view.x, cx - w / 2)),
    y: Math.min(view.y + view.h - h, Math.max(view.y, cy - h / 2)),
    w,
    h
  }
}

/** The crop at `percent` around the same centre, kept inside the recording. Scale stops at 100 and at 400. */
export function withScale(crop: Rect, percent: number, width: number, height: number, aspect?: number): Rect {
  const full = fullCropOf(crop, width, height, aspect)
  const s = Math.min(MAX_SCALE, Math.max(100, percent)) / 100
  return centred(crop, crop.x + crop.w / 2, crop.y + crop.h / 2, full.w / s, full.h / s, width, height)
}

/** The same crop around another centre, in the recording's pixels, kept inside the recording. */
export function withCentre(crop: Rect, cx: number, cy: number, width: number, height: number): Rect {
  return centred(crop, cx, cy, crop.w, crop.h, width, height)
}

/**
 * Whether a crop fills more of the frame than it has pixels for, so the
 * picture is drawn larger than it was recorded: its place, in output pixels,
 * is wider than the crop.
 */
export function pastOwnPixels(crop: Rect, place: Place, frameWidth: number): boolean {
  return crop.w < place.w * frameWidth - 0.5
}

/** The three ways a Simple zoom gets from Start to End, in plain words, with what Premiere calls each. */
export const SIMPLE_EASE_NAMES: { ease: SimpleEase; label: string; title: string }[] = [
  { ease: 'smooth', label: 'Smooth', title: 'Starts and ends gently. Premiere calls this Ease In and Out' },
  { ease: 'linear', label: 'Steady', title: 'The same speed the whole way. Premiere calls this Linear' },
  { ease: 'cut', label: 'Cut', title: 'Stays on Start, then jumps to End halfway, which hides a jump cut' }
]

/** The five ways from one keyframe to the next, in plain words, with what Premiere calls each. */
export const EASE_NAMES: { ease: Ease; label: string; title: string }[] = [
  { ease: 'smooth', label: 'Smooth', title: 'Starts and ends gently. Premiere calls this Ease In and Out' },
  { ease: 'linear', label: 'Steady', title: 'The same speed all the way. Premiere calls this Linear' },
  { ease: 'in', label: 'Starts slowly', title: 'Gathers speed as it goes. Premiere calls this Ease Out' },
  { ease: 'out', label: 'Ends slowly', title: 'Slows down as it arrives. Premiere calls this Ease In' },
  { ease: 'hold', label: 'Jump', title: 'Stays put, then jumps on the next keyframe. Premiere calls this Hold' }
]

/**
 * Bugs and notes 2, note 15: the zoom the timeline marks on a clip. The
 * chosen picture's, when that is given and moves; otherwise the main
 * picture's, or the first further picture's that moves. Its keyframes on the
 * clip's own frames, or for a Simple zoom its Start and End on the clip's
 * first and last. Null for a clip that stays still.
 */
export function timelineZoom(c: Clip, picture?: string): { picture: string; frames: number[]; simple: boolean } | null {
  const moving = (id: string): boolean => keysInClip(c, id).length > 0
  const chosen = picture !== undefined && moving(pictureOf(c, picture)) ? pictureOf(c, picture) : undefined
  const id = chosen ?? (moving(MAIN_PICTURE) ? MAIN_PICTURE : c.layers.find((l) => moving(l.id))?.id)
  if (id === undefined) return null
  const simple = zoomOf(c, id).simple !== undefined
  const last = Math.max(c.sourceIn, c.sourceOut - 1)
  return { picture: id, frames: simple ? [c.sourceIn, last] : keysInClip(c, id).map((k) => k.at), simple }
}

/**
 * Keyframe marks as a clip on the timeline can show them: one for each
 * keyframe, and one for a run of them closer together on screen than `reach`
 * pixels, placed on the first and counting them all. Frames in order.
 */
export function keyMarks(frames: readonly number[], pxPerFrame: number, reach: number): { at: number; count: number }[] {
  const out: { at: number; count: number; last: number }[] = []
  for (const f of frames) {
    const run = out[out.length - 1]
    if (run && (f - run.last) * pxPerFrame < reach) {
      run.count += 1
      run.last = f
    } else out.push({ at: f, count: 1, last: f })
  }
  return out.map(({ at, count }) => ({ at, count }))
}

/**
 * Where a keyframe dragged along a clip on the timeline lands: the frame it
 * started on moved by the pixels dragged, kept on the clip's own frames.
 */
export function keyDraggedTo(c: Pick<Clip, 'sourceIn' | 'sourceOut'>, from: number, dxPx: number, pxPerFrame: number): number {
  const moved = pxPerFrame > 0 ? Math.round(dxPx / pxPerFrame) : 0
  return Math.min(Math.max(c.sourceIn, c.sourceOut - 1), Math.max(c.sourceIn, from + moved))
}
