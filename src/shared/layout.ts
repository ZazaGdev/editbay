import type { Rect } from './project'
import { largestRectOfAspect, moveCrop, refitCrop, type SnapLines } from './crop-geometry'

/**
 * Pictures and where they go in the frame. All pure: the editor, the preview
 * and the export read the same answers from here.
 *
 * A picture is a crop, in source pixels, and a place: a box in the output
 * frame, as fractions of the frame's width and height. `{ x: 0, y: 0, w: 1,
 * h: 0.5 }` is the top half at any output size.
 */

export interface Place {
  x: number
  y: number
  w: number
  h: number
}

/** The whole frame. */
export const FULL_PLACE: Place = { x: 0, y: 0, w: 1, h: 1 }

/**
 * How a clip's pictures are laid out. Custom is anything arranged by hand; the
 * rest can be laid out again for a new frame, which is how a vertical Split
 * becomes side by side when its sequence is made landscape.
 */
export type LayoutKind = 'single' | 'split' | 'pip' | 'custom'
export type NamedLayout = Exclude<LayoutKind, 'custom'>

export const MAX_LAYERS = 8

/** The smallest a place may be, in output pixels, so it can still be grabbed. */
const MIN_PLACE_PX = 32

function evenNear(n: number): number {
  return Math.round(n / 2) * 2
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

export function isFullFrame(place: Place): boolean {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6
  return near(place.x, 0) && near(place.y, 0) && near(place.w, 1) && near(place.h, 1)
}

/**
 * A place in output pixels, on even numbers and inside the frame, which is
 * what both the preview and the export draw into, so they agree to the pixel.
 */
export function placeInPixels(place: Place, frameW: number, frameH: number): Rect {
  const x = clamp(evenNear(place.x * frameW), 0, frameW - 2)
  const y = clamp(evenNear(place.y * frameH), 0, frameH - 2)
  const w = clamp(evenNear(place.w * frameW), 2, frameW - x)
  const h = clamp(evenNear(place.h * frameH), 2, frameH - y)
  return { x, y, w, h }
}

/**
 * A place moved by some output pixels, kept inside the frame. The same
 * rounding as a drag, so a nudge lands where a drag would.
 */
export function nudgePlace(place: Place, dx: number, dy: number, frameW: number, frameH: number): Place {
  const px = { x: place.x * frameW, y: place.y * frameH, w: place.w * frameW, h: place.h * frameH }
  return placeFromPixels(moveCrop(px, dx, dy, { w: frameW, h: frameH }), frameW, frameH)
}

/** A box in output pixels, back as fractions of the frame. */
export function placeFromPixels(rect: Rect, frameW: number, frameH: number): Place {
  return { x: rect.x / frameW, y: rect.y / frameH, w: rect.w / frameW, h: rect.h / frameH }
}

/** Width over height of a place, in pixels of a frame this size. */
export function placeAspect(place: Place, frameW: number, frameH: number): number {
  return (place.w * frameW) / (place.h * frameH)
}

/**
 * Where a crop is drawn inside its place: as large as fits, centred, never
 * stretched. If the two have different shapes there is black around it.
 */
export function fitInPlace(cropW: number, cropH: number, place: Rect): Rect {
  if (!(cropW > 0) || !(cropH > 0)) return { ...place }
  const scale = Math.min(place.w / cropW, place.h / cropH)
  const w = cropW * scale
  const h = cropH * scale
  return { x: place.x + (place.w - w) / 2, y: place.y + (place.h - h) / 2, w, h }
}

/**
 * Whether a source holds two views side by side, as a 3840x1080
 * OBS canvas does with two 1920x1080 views.
 */
export function isSideBySide(sourceW: number, sourceH: number): boolean {
  return sourceH > 0 && sourceW >= 3 * sourceH
}

/** The views a source holds: its two halves when side by side, or the whole frame. */
export function viewsOf(sourceW: number, sourceH: number): Rect[] {
  if (!isSideBySide(sourceW, sourceH)) return [{ x: 0, y: 0, w: sourceW, h: sourceH }]
  const half = Math.floor(sourceW / 4) * 2
  return [
    { x: 0, y: 0, w: half, h: sourceH },
    { x: half, y: 0, w: sourceW - half, h: sourceH }
  ]
}

/**
 * The lines a crop snaps to: its centre to the centre of each view the
 * recording holds, and its edges to each view's edges. For a side by side
 * recording that is each camera's middle and sides, and never the seam
 * between them as a centre.
 */
export function cropSnapLines(sourceW: number, sourceH: number): SnapLines {
  const views = viewsOf(sourceW, sourceH)
  return {
    edgesX: [...new Set(views.flatMap((v) => [v.x, v.x + v.w]))],
    centresX: views.map((v) => v.x + v.w / 2),
    edgesY: [0, sourceH],
    centresY: [sourceH / 2]
  }
}

/** The view a crop shows: for a side by side source, the half its centre is in. */
export function viewOf(crop: Rect, sourceW: number, sourceH: number): Rect {
  const views = viewsOf(sourceW, sourceH)
  const cx = crop.x + crop.w / 2
  return views.find((v) => cx >= v.x && cx < v.x + v.w) ?? views[views.length - 1]!
}

/** The largest crop of a shape inside a view, centred on it. */
export function cropInView(view: Rect, aspect: number): Rect {
  const r = largestRectOfAspect(view.w, view.h, aspect)
  return { x: r.x + view.x, y: r.y + view.y, w: r.w, h: r.h }
}

/**
 * Reshape a crop around the point it frames, and keep it inside the view it
 * shows. Without the second part, a crop kept at full height in a wider box
 * spills over into the other view of a side by side recording.
 */
export function refitInView(crop: Rect, sourceW: number, sourceH: number, aspect: number): Rect {
  const view = viewOf(crop, sourceW, sourceH)
  const local = refitCrop({ ...crop, x: crop.x - view.x, y: crop.y - view.y }, view.w, view.h, aspect)
  return { x: local.x + view.x, y: local.y + view.y, w: local.w, h: local.h }
}

/**
 * Where each picture of a named layout goes in a frame, main picture first.
 * `layerAspect` is the shape of the view a Picture in picture box shows.
 */
export function layoutPlaces(kind: NamedLayout, frameW: number, frameH: number, layerAspect: number): Place[] {
  if (kind === 'single') return [FULL_PLACE]
  if (kind === 'split') {
    // Stacked on a frame at least as tall as it is wide, side by side otherwise.
    return frameH >= frameW
      ? [
          { x: 0, y: 0, w: 1, h: 0.5 },
          { x: 0, y: 0.5, w: 1, h: 0.5 }
        ]
      : [
          { x: 0, y: 0, w: 0.5, h: 1 },
          { x: 0.5, y: 0, w: 0.5, h: 1 }
        ]
  }
  // A third of the frame wide, the shape of its view, touching the top right corner.
  const w = 1 / 3
  const h = Math.min(1, (frameW * w) / (layerAspect > 0 ? layerAspect : 16 / 9) / frameH)
  return [FULL_PLACE, { x: 1 - w, y: 0, w, h }]
}

export interface Picture {
  crop: Rect
  place: Place
}

/**
 * A named layout's pictures for a source, main first. For a side by side
 * source the main picture comes from the left view and the layer from the
 * right; otherwise both from the middle of the whole frame. Each crop takes
 * its place's shape, as large as fits in its view, so the view fills its box
 * and its sides are trimmed.
 */
export function layoutPictures(
  kind: Exclude<NamedLayout, 'single'>,
  sourceW: number,
  sourceH: number,
  frameW: number,
  frameH: number
): [Picture, Picture] {
  const views = viewsOf(sourceW, sourceH)
  const mainView = views[0]!
  const layerView = views[1] ?? mainView
  const [mainPlace, layerPlace] = layoutPlaces(kind, frameW, frameH, layerView.w / layerView.h) as [Place, Place]
  return [
    { crop: cropInView(mainView, placeAspect(mainPlace, frameW, frameH)), place: mainPlace },
    { crop: cropInView(layerView, placeAspect(layerPlace, frameW, frameH)), place: layerPlace }
  ]
}

/**
 * A place laid out by hand, in a frame of a new size. One that fills the frame
 * keeps filling it. Any other keeps its own shape, stays centred on the same
 * fraction of the frame, and is scaled by the smaller of the frame's changes in
 * width and in height, so it still fits.
 */
export function placeInNewFrame(place: Place, oldW: number, oldH: number, newW: number, newH: number): Place {
  if (isFullFrame(place)) return FULL_PLACE
  const s = Math.min(newW / oldW, newH / oldH)
  const w = Math.min(1, (place.w * oldW * s) / newW)
  const h = Math.min(1, (place.h * oldH * s) / newH)
  const cx = place.x + place.w / 2
  const cy = place.y + place.h / 2
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h }
}

/** Keep a place inside the frame and no smaller than can be grabbed. */
export function tidyPlace(place: Place, frameW: number, frameH: number): Place {
  const minW = Math.min(1, MIN_PLACE_PX / frameW)
  const minH = Math.min(1, MIN_PLACE_PX / frameH)
  const w = clamp(place.w, minW, 1)
  const h = clamp(place.h, minH, 1)
  return { x: clamp(place.x, 0, 1 - w), y: clamp(place.y, 0, 1 - h), w, h }
}

export type Edge = 'n' | 's' | 'e' | 'w'

/**
 * Drag one edge of a place, in output pixels, changing its shape. The
 * opposite edge stays put, and the place stays inside the frame.
 */
export function stretchPlace(rect: Rect, edge: Edge, delta: number, bounds: { w: number; h: number }): Rect {
  const r = { ...rect }
  if (edge === 'e') r.w = clamp(evenNear(rect.w + delta), MIN_PLACE_PX, bounds.w - rect.x)
  if (edge === 's') r.h = clamp(evenNear(rect.h + delta), MIN_PLACE_PX, bounds.h - rect.y)
  if (edge === 'w') {
    const right = rect.x + rect.w
    r.x = clamp(evenNear(rect.x + delta), 0, right - MIN_PLACE_PX)
    r.w = right - r.x
  }
  if (edge === 'n') {
    const bottom = rect.y + rect.h
    r.y = clamp(evenNear(rect.y + delta), 0, bottom - MIN_PLACE_PX)
    r.h = bottom - r.y
  }
  return r
}

/**
 * How much of a freely placed box stays on the frame at least, in output
 * pixels: enough to see it is there and grab it back.
 */
export const FREE_MARGIN_PX = 24

/** The largest a freely placed box may be, as a multiple of the frame on each side. */
const FREE_MAX = 4

/**
 * A place laid out by hand for an overlay, which may reach past the frame's
 * edges, as a sticker peeking in from a corner does, as long as some of it
 * stays on the frame. No smaller than can be grabbed.
 */
export function tidyFreePlace(place: Place, frameW: number, frameH: number): Place {
  const w = clamp(place.w, Math.min(1, MIN_PLACE_PX / frameW), FREE_MAX)
  const h = clamp(place.h, Math.min(1, MIN_PLACE_PX / frameH), FREE_MAX)
  const mx = FREE_MARGIN_PX / frameW
  const my = FREE_MARGIN_PX / frameH
  return { x: clamp(place.x, mx - w, 1 - mx), y: clamp(place.y, my - h, 1 - my), w, h }
}

/** A side of the frame, or its middle, that a box can be lined up with. */
export type FrameSide = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'

/** How far in from the frame's edges a box lined up with one sits: a twentieth of its shorter side. */
export const IN_FRAME_MARGIN = 0.05

/**
 * A box lined up with a side of the frame, or centred on it, across or down:
 * Left, Centre and Right move it across and leave it where it is down, and
 * Top, Middle and Bottom the other way. An edge sits the frame's margin in,
 * so a title never touches the edge.
 */
export function placeInFrame(place: Place, side: FrameSide, frameW: number, frameH: number): Place {
  const m = IN_FRAME_MARGIN * Math.min(frameW, frameH)
  switch (side) {
    case 'left':
      return { ...place, x: m / frameW }
    case 'centre':
      return { ...place, x: 0.5 - place.w / 2 }
    case 'right':
      return { ...place, x: 1 - place.w - m / frameW }
    case 'top':
      return { ...place, y: m / frameH }
    case 'middle':
      return { ...place, y: 0.5 - place.h / 2 }
    case 'bottom':
      return { ...place, y: 1 - place.h - m / frameH }
  }
}

/**
 * A freely placed box in output pixels, on even numbers like every place,
 * but not held inside the frame: what is outside is simply not drawn.
 */
export function freePlaceInPixels(place: Place, frameW: number, frameH: number): Rect {
  return {
    x: evenNear(place.x * frameW),
    y: evenNear(place.y * frameH),
    w: Math.max(2, evenNear(place.w * frameW)),
    h: Math.max(2, evenNear(place.h * frameH))
  }
}

/**
 * A freely placed box moved by some output pixels, kept with a margin of it
 * on the frame. The free counterpart of moving a place.
 */
export function moveFreeBox(rect: Rect, dx: number, dy: number, frameW: number, frameH: number): Rect {
  const x = clamp(Math.round(rect.x + dx), FREE_MARGIN_PX - rect.w, frameW - FREE_MARGIN_PX)
  const y = clamp(Math.round(rect.y + dy), FREE_MARGIN_PX - rect.h, frameH - FREE_MARGIN_PX)
  return { ...rect, x, y }
}

/**
 * One edge of a freely placed box dragged, in output pixels: the opposite
 * edge stays put, as it does for a place on the frame, but the box may reach
 * past the frame, as long as some of it stays on it. No smaller than can be
 * grabbed.
 */
export function stretchFreeBox(rect: Rect, edge: Edge, delta: number, frameW: number, frameH: number): Rect {
  const r = { ...rect }
  if (edge === 'e') r.w = Math.max(MIN_PLACE_PX, evenNear(rect.w + delta))
  if (edge === 's') r.h = Math.max(MIN_PLACE_PX, evenNear(rect.h + delta))
  if (edge === 'w') {
    const right = rect.x + rect.w
    r.x = Math.min(right - MIN_PLACE_PX, evenNear(rect.x + delta))
    r.w = right - r.x
  }
  if (edge === 'n') {
    const bottom = rect.y + rect.h
    r.y = Math.min(bottom - MIN_PLACE_PX, evenNear(rect.y + delta))
    r.h = bottom - r.y
  }
  return moveFreeBox(r, 0, 0, frameW, frameH)
}

/**
 * A freely placed box scaled about its centre by `k`, its shape kept, no
 * smaller than can be grabbed and no larger than a free box may be.
 */
export function scaleFreeBox(rect: Rect, k: number, frameW: number, frameH: number): Rect {
  const smallest = Math.max(MIN_PLACE_PX / rect.w, MIN_PLACE_PX / rect.h)
  const largest = Math.min((FREE_MAX * frameW) / rect.w, (FREE_MAX * frameH) / rect.h)
  const s = clamp(k, smallest, Math.max(smallest, largest))
  const w = rect.w * s
  const h = rect.h * s
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h }
}

/**
 * An angle as it is kept: degrees clockwise, in (-180, 180], and snapped to
 * the nearest quarter turn when within `snap` degrees of it.
 */
export function tidyAngle(deg: number, snap = 0): number {
  if (!Number.isFinite(deg)) return 0
  let a = ((deg % 360) + 360) % 360
  if (a > 180) a -= 360
  if (snap > 0) {
    const quarter = Math.round(a / 90) * 90
    if (Math.abs(a - quarter) <= snap) a = quarter === -180 ? 180 : quarter
  }
  return Math.abs(a) < 1e-9 ? 0 : a
}
