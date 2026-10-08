import type { Ease, Rect, ZoomKey } from './project'

/**
 * Every conversion the crop rectangle needs, between source pixels and what is
 * on screen. All pure, because this is the fiddliest arithmetic in the app and
 * none of it belongs inside a component.
 *
 * A crop is always expressed in the pixels of the file being played, never in
 * screen pixels, so that a 4K clip is cropped at 4K and scaled afterwards.
 */

export const MIN_CROP = 16

export type Handle = 'nw' | 'ne' | 'sw' | 'se'
/** A side of a crop, dragged to change its width or its height alone. */
export type Side = 'n' | 'e' | 's' | 'w'

export interface Fit {
  scale: number
  width: number
  height: number
  offsetX: number
  offsetY: number
}

function evenNear(n: number): number {
  return Math.round(n / 2) * 2
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

/** Letterbox a source frame inside a box, centred. */
export function fitInBox(sourceW: number, sourceH: number, boxW: number, boxH: number): Fit {
  if (!(sourceW > 0) || !(sourceH > 0) || !(boxW > 0) || !(boxH > 0)) {
    return { scale: 0, width: 0, height: 0, offsetX: 0, offsetY: 0 }
  }
  const scale = Math.min(boxW / sourceW, boxH / sourceH)
  const width = sourceW * scale
  const height = sourceH * scale
  return { scale, width, height, offsetX: (boxW - width) / 2, offsetY: (boxH - height) / 2 }
}

/** A rectangle in source pixels, placed on screen. */
export function sourceToDisplay(rect: Rect, fit: Fit): Rect {
  return {
    x: fit.offsetX + rect.x * fit.scale,
    y: fit.offsetY + rect.y * fit.scale,
    w: rect.w * fit.scale,
    h: rect.h * fit.scale
  }
}

/** A rectangle on screen, back in source pixels. */
export function displayToSource(rect: Rect, fit: Fit): Rect {
  if (!(fit.scale > 0)) return { x: 0, y: 0, w: 0, h: 0 }
  return {
    x: (rect.x - fit.offsetX) / fit.scale,
    y: (rect.y - fit.offsetY) / fit.scale,
    w: rect.w / fit.scale,
    h: rect.h / fit.scale
  }
}

export interface ProgramLayout {
  /** The cropped picture, fitted into the box and centred. */
  cropWidth: number
  cropHeight: number
  offsetX: number
  offsetY: number
  /** Where the whole video sits behind that window, so only the crop shows. */
  videoLeft: number
  videoTop: number
  videoWidth: number
  videoHeight: number
}

/**
 * Show only the crop, scaled to fill a box.
 *
 * The video element is rendered at full size and shifted behind a window the
 * size of the crop, which is cheaper and sharper than drawing to a canvas.
 */
export function programLayout(
  crop: Rect,
  sourceW: number,
  sourceH: number,
  boxW: number,
  boxH: number
): ProgramLayout {
  const empty: ProgramLayout = {
    cropWidth: 0,
    cropHeight: 0,
    offsetX: 0,
    offsetY: 0,
    videoLeft: 0,
    videoTop: 0,
    videoWidth: 0,
    videoHeight: 0
  }
  if (!(crop.w > 0) || !(crop.h > 0) || !(sourceW > 0) || !(sourceH > 0) || !(boxW > 0) || !(boxH > 0)) {
    return empty
  }

  const scale = Math.min(boxW / crop.w, boxH / crop.h)
  const cropWidth = crop.w * scale
  const cropHeight = crop.h * scale
  const offsetX = (boxW - cropWidth) / 2
  const offsetY = (boxH - cropHeight) / 2

  return {
    cropWidth,
    cropHeight,
    offsetX,
    offsetY,
    videoLeft: -crop.x * scale,
    videoTop: -crop.y * scale,
    videoWidth: sourceW * scale,
    videoHeight: sourceH * scale
  }
}

/** The largest rectangle of `aspect` (width over height) that fits, centred. */
export function largestRectOfAspect(sourceW: number, sourceH: number, aspect: number): Rect {
  if (!(sourceW > 0) || !(sourceH > 0) || !(aspect > 0)) return { x: 0, y: 0, w: 2, h: 2 }

  let w = sourceW
  let h = w / aspect
  if (h > sourceH) {
    h = sourceH
    w = h * aspect
  }
  const ew = Math.max(2, Math.min(evenNear(w), Math.floor(sourceW / 2) * 2))
  const eh = Math.max(2, Math.min(evenNear(h), Math.floor(sourceH / 2) * 2))
  return {
    x: Math.max(0, evenNear((sourceW - ew) / 2)),
    y: Math.max(0, evenNear((sourceH - eh) / 2)),
    w: ew,
    h: eh
  }
}

/** Slide a crop without resizing it, stopping at the edges of the frame. */
export function moveCrop(rect: Rect, dx: number, dy: number, bounds: { w: number; h: number }): Rect {
  return {
    x: clamp(evenNear(rect.x + dx), 0, Math.max(0, bounds.w - rect.w)),
    y: clamp(evenNear(rect.y + dy), 0, Math.max(0, bounds.h - rect.h)),
    w: rect.w,
    h: rect.h
  }
}

/**
 * A crop given a left or top edge typed as a number. The edge goes where it
 * was typed, and the crop gives up width, or height, to stay inside the
 * recording, rather than the number being quietly pulled back to the most
 * the crop's size allows. With `aspect`, the lock to shape, the other side
 * shrinks with it so the shape holds.
 */
export function cropAtEdge(rect: Rect, edge: 'x' | 'y', at: number, bounds: { w: number; h: number }, aspect: number | null): Rect {
  const maxW = Math.max(2, Math.floor(bounds.w / 2) * 2)
  const maxH = Math.max(2, Math.floor(bounds.h / 2) * 2)
  const locked = aspect !== null && aspect > 0
  if (edge === 'x') {
    const x = clamp(evenNear(at), 0, maxW - 2)
    const w = Math.max(2, Math.min(rect.w, maxW - x))
    if (w === rect.w || !locked) return { ...rect, x, w }
    return { ...rect, x, w, h: Math.max(2, evenNear(w / aspect)) }
  }
  const y = clamp(evenNear(at), 0, maxH - 2)
  const h = Math.max(2, Math.min(rect.h, maxH - y))
  if (h === rect.h || !locked) return { ...rect, y, h }
  return { ...rect, y, h, w: Math.max(2, evenNear(h * aspect)) }
}

/**
 * Reshape a crop to a new aspect, around the point it was framing.
 *
 * Keeps the height, and so the zoom, wherever the new shape allows it, because
 * someone who framed a face tightly for vertical expects the same face at the
 * same size in square, not a zoomed out wide shot. Only when the new shape will
 * not fit at that height does it shrink. With no target shape it leaves the
 * crop exactly as drawn.
 */
export function refitCrop(crop: Rect, sourceW: number, sourceH: number, aspect: number | null): Rect {
  if (aspect === null || !(aspect > 0) || !(sourceW > 0) || !(sourceH > 0)) return crop

  const centreX = crop.x + crop.w / 2
  const centreY = crop.y + crop.h / 2

  let h = Math.min(crop.h, sourceH)
  let w = h * aspect
  if (w > sourceW) {
    w = sourceW
    h = w / aspect
  }
  if (h > sourceH) {
    h = sourceH
    w = h * aspect
  }

  const ew = Math.max(2, Math.min(evenNear(w), Math.floor(sourceW / 2) * 2))
  const eh = Math.max(2, Math.min(evenNear(h), Math.floor(sourceH / 2) * 2))
  return {
    x: clamp(evenNear(centreX - ew / 2), 0, Math.max(0, sourceW - ew)),
    y: clamp(evenNear(centreY - eh / 2), 0, Math.max(0, sourceH - eh)),
    w: ew,
    h: eh
  }
}

/** Of two candidate sizes with the target aspect, the bigger one. */
function applyAspect(w: number, h: number, aspect: number): { w: number; h: number } {
  const fromWidth = { w, h: w / aspect }
  const fromHeight = { w: h * aspect, h }
  return fromWidth.w * fromWidth.h >= fromHeight.w * fromHeight.h ? fromWidth : fromHeight
}

/**
 * Change a crop's width or height alone by dragging one side. The opposite
 * side stays where it is, and the crop stays inside the frame, on even pixels
 * and no smaller than the least a crop may be. Only for a crop whose shape is
 * not locked: a side cannot move and keep a shape.
 */
export function stretchCrop(rect: Rect, side: Side, delta: number, bounds: { w: number; h: number }): Rect {
  const r = { ...rect }
  if (side === 'e') r.w = clamp(evenNear(rect.w + delta), MIN_CROP, Math.floor((bounds.w - rect.x) / 2) * 2)
  if (side === 's') r.h = clamp(evenNear(rect.h + delta), MIN_CROP, Math.floor((bounds.h - rect.y) / 2) * 2)
  if (side === 'w') {
    const right = rect.x + rect.w
    r.x = clamp(evenNear(rect.x + delta), 0, right - MIN_CROP)
    r.w = right - r.x
  }
  if (side === 'n') {
    const bottom = rect.y + rect.h
    r.y = clamp(evenNear(rect.y + delta), 0, bottom - MIN_CROP)
    r.h = bottom - r.y
  }
  return r
}

/**
 * Resize a crop by dragging one corner.
 *
 * The opposite corner stays where it is. With an aspect locked, the result keeps
 * that ratio and shrinks to fit rather than escaping the frame.
 */
export function resizeCrop(
  rect: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  aspect: number | null,
  bounds: { w: number; h: number }
): Rect {
  const growsLeft = handle === 'nw' || handle === 'sw'
  const growsUp = handle === 'nw' || handle === 'ne'

  // The corner that stays put.
  const anchorX = growsLeft ? rect.x + rect.w : rect.x
  const anchorY = growsUp ? rect.y + rect.h : rect.y

  const maxW = Math.max(MIN_CROP, growsLeft ? anchorX : bounds.w - anchorX)
  const maxH = Math.max(MIN_CROP, growsUp ? anchorY : bounds.h - anchorY)

  let w = clamp(rect.w + (growsLeft ? -dx : dx), MIN_CROP, maxW)
  let h = clamp(rect.h + (growsUp ? -dy : dy), MIN_CROP, maxH)

  if (aspect && aspect > 0) {
    const wanted = applyAspect(w, h, aspect)
    // Shrink, never grow, to stay inside the frame while holding the ratio.
    const shrink = Math.min(1, maxW / wanted.w, maxH / wanted.h)
    w = wanted.w * shrink
    h = wanted.h * shrink
    // If that took it under the minimum, grow back along the ratio as far as it fits.
    const grow = Math.max(1, MIN_CROP / w, MIN_CROP / h)
    w = Math.min(w * grow, maxW)
    h = Math.min(h * grow, maxH)
  }

  const ew = Math.max(2, Math.min(evenNear(w), Math.floor(maxW / 2) * 2))
  const eh = Math.max(2, Math.min(evenNear(h), Math.floor(maxH / 2) * 2))

  return {
    x: growsLeft ? anchorX - ew : anchorX,
    y: growsUp ? anchorY - eh : anchorY,
    w: ew,
    h: eh
  }
}

/**
 * Lines a box can snap to while it is dragged. A box's edges line up only
 * with edge lines and its centre only with centre lines, so a box's centre
 * never catches on the seam between two views, nor its edge on a view's middle.
 */
export interface SnapLines {
  edgesX: number[]
  centresX: number[]
  edgesY: number[]
  centresY: number[]
}

/**
 * Move a box so it lines up with the nearest line within `within`: its left
 * or right edge with an edge line, or its centre with a centre line, and the
 * same down. Each axis on its own, so a box can line up across without lining
 * up down. A box nowhere near any line stays where it was.
 */
export function snapBox(rect: Rect, lines: SnapLines, within: number): Rect {
  const shift = (start: number, size: number, edges: number[], centres: number[]): number => {
    let best = 0
    let bestDistance = within
    const consider = (at: number, targets: number[]): void => {
      for (const t of targets) {
        const d = Math.abs(t - at)
        if (d <= bestDistance) {
          bestDistance = d
          best = t - at
        }
      }
    }
    consider(start, edges)
    consider(start + size, edges)
    consider(start + size / 2, centres)
    return best
  }
  return {
    x: rect.x + shift(rect.x, rect.w, lines.edgesX, lines.centresX),
    y: rect.y + shift(rect.y, rect.h, lines.edgesY, lines.centresY),
    w: rect.w,
    h: rect.h
  }
}

/**
 * The lines a box sits on: an edge line its left or right edge is on, a
 * centre line its middle is on, and the same down. What a drag shows while it
 * snaps, so the snap reads as lining up rather than the box being sticky.
 */
export function linesUnder(rect: Rect, lines: SnapLines, within = 0.5): { x: number[]; y: number[] } {
  const on = (at: number, targets: number[]): number[] => targets.filter((t) => Math.abs(t - at) <= within)
  const unique = (xs: number[]): number[] => [...new Set(xs.map((n) => Math.round(n * 100) / 100))]
  return {
    x: unique([...on(rect.x, lines.edgesX), ...on(rect.x + rect.w, lines.edgesX), ...on(rect.x + rect.w / 2, lines.centresX)]),
    y: unique([...on(rect.y, lines.edgesY), ...on(rect.y + rect.h, lines.edgesY), ...on(rect.y + rect.h / 2, lines.centresY)])
  }
}

/**
 * Snap lines from other boxes on screen, in output pixels, and the frame's
 * thirds: their edges and middles, so one thing lines up with another.
 */
export function boxLines(boxes: readonly Rect[], w: number, h: number): SnapLines {
  const thirdsX = [w / 3, (2 * w) / 3]
  const thirdsY = [h / 3, (2 * h) / 3]
  return {
    edgesX: [...thirdsX, ...boxes.flatMap((b) => [b.x, b.x + b.w])],
    centresX: [...thirdsX, ...boxes.map((b) => b.x + b.w / 2)],
    edgesY: [...thirdsY, ...boxes.flatMap((b) => [b.y, b.y + b.h])],
    centresY: [...thirdsY, ...boxes.map((b) => b.y + b.h / 2)]
  }
}

/** Two sets of snap lines as one. */
export function joinLines(a: SnapLines, b: SnapLines): SnapLines {
  return {
    edgesX: [...a.edgesX, ...b.edgesX],
    centresX: [...a.centresX, ...b.centresX],
    edgesY: [...a.edgesY, ...b.edgesY],
    centresY: [...a.centresY, ...b.centresY]
  }
}

/**
 * Snap lines along the sides of a safe area, in output pixels: a box's edges
 * line up with them, so a title can be kept just inside it.
 */
export function safeLines(safe: Rect): SnapLines {
  return { edgesX: [safe.x, safe.x + safe.w], centresX: [], edgesY: [safe.y, safe.y + safe.h], centresY: [] }
}

/** The line nearest `at` within `within`, or null when none is that near. */
export function nearestLine(at: number, targets: readonly number[], within: number): number | null {
  let best: number | null = null
  let bestDistance = within
  for (const t of targets) {
    const d = Math.abs(t - at)
    if (d <= bestDistance) {
      bestDistance = d
      best = t
    }
  }
  return best
}

/**
 * The edge lines the moved sides of a resized box sit on. Only those: a side
 * held still is not what the drag is lining up. Within a pixel, since a side
 * lands on even pixels.
 */
export function sidesUnder(xs: readonly number[], ys: readonly number[], lines: SnapLines, within = 1): { x: number[]; y: number[] } {
  const on = (sides: readonly number[], targets: number[]): number[] => [
    ...new Set(sides.flatMap((at) => targets.filter((t) => Math.abs(t - at) <= within)).map((n) => Math.round(n * 100) / 100))
  ]
  return { x: on(xs, lines.edgesX), y: on(ys, lines.edgesY) }
}

/**
 * The lines a place in a frame snaps to: its centre to the frame's centre,
 * and its edges to the frame's edges and to the middle, where the halves of a
 * split meet.
 */
export function frameLines(w: number, h: number): SnapLines {
  return { edgesX: [0, w / 2, w], centresX: [w / 2], edgesY: [0, h / 2, h], centresY: [h / 2] }
}

/**
 * How far through a move a frame is, eased so it does not start and stop
 * abruptly. Smoothstep: flat at both ends, quickest in the middle, which is
 * what a hand on a zoom ring does and what a straight line does not.
 */
export function easeThrough(fraction: number): number {
  const t = Math.min(1, Math.max(0, fraction))
  return t * t * (3 - 2 * t)
}

/**
 * How far from one keyframe to the next a picture has got, `t` of the way
 * there in time, by the keyframe's ease. Smooth is `easeThrough`, which every
 * move had before keyframes; Steady is a straight line; Starts slowly and
 * Ends slowly are the two halves of a curve; Jump stays put until the next
 * keyframe and arrives on its frame, which is how a cut is made.
 */
export function easeOf(ease: Ease | undefined, t: number): number {
  const x = Math.min(1, Math.max(0, t))
  switch (ease) {
    case 'linear':
      return x
    case 'in':
      return x * x
    case 'out':
      return 1 - (1 - x) * (1 - x)
    case 'hold':
      return x >= 1 ? 1 : 0
    default:
      return easeThrough(x)
  }
}

/**
 * The crop a clip's main picture shows on `frame`, a frame of its recording
 * (the unit `sourceIn` counts in), not of the clip, so a split or a trim
 * leaves every zoom where it was on the picture.
 *
 * With no keyframes it is `crop`, the clip's own. Before the first keyframe
 * it is the first one's crop and after the last the last one's; in between,
 * each of x, y, w and h is moved from the keyframe before to the one after by
 * the eased fraction of the time between them.
 *
 * Nothing is rounded to whole pixels here. The preview draws in fractions of
 * a pixel and the export scales up before it moves, both because a slow zoom
 * moves less than a pixel a frame and rounding it is exactly what makes one
 * judder.
 */
export function cropAtKeys(crop: Rect, keys: readonly ZoomKey[] | undefined, frame: number): Rect {
  if (!keys || keys.length === 0) return crop
  const first = keys[0]!
  if (frame < first.at) return first.crop
  const last = keys[keys.length - 1]!
  if (frame >= last.at) return last.crop
  let i = 0
  while (keys[i + 1]!.at <= frame) i++
  const a = keys[i]!
  const b = keys[i + 1]!
  const t = easeOf(a.ease, (frame - a.at) / (b.at - a.at))
  return {
    x: a.crop.x + (b.crop.x - a.crop.x) * t,
    y: a.crop.y + (b.crop.y - a.crop.y) * t,
    w: a.crop.w + (b.crop.w - a.crop.w) * t,
    h: a.crop.h + (b.crop.h - a.crop.h) * t
  }
}

/**
 * Whether a clip's picture moves at all: two keyframes whose crops differ by
 * a pixel or more. Keyframes that all frame the same thing are no zoom.
 */
export function moves(keys: readonly ZoomKey[] | undefined): boolean {
  if (!keys || keys.length < 2) return false
  const a = keys[0]!.crop
  return keys.some(
    (k) => Math.max(Math.abs(k.crop.x - a.x), Math.abs(k.crop.y - a.y), Math.abs(k.crop.w - a.w), Math.abs(k.crop.h - a.h)) >= 1
  )
}
