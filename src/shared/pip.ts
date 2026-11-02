import type { Place } from './layout'
import type { PictureStyle } from './project'

/**
 * Picture in picture as the owner sees it: a small picture in a corner, of a
 * size, a margin in from the edges, a shape, a border and a shadow. None of
 * it is stored on its own. It is read from the small picture's place and
 * style, which the export and the preview already draw, so a project made
 * before this opens as it was, and an edit here writes a place and a style
 * like any other. See plan 62.
 */

export type PipCorner = 'tl' | 'tr' | 'bl' | 'br'
export type PipShape = 'square' | 'rounded' | 'portrait' | 'circle'

export const PIP_CORNERS: readonly PipCorner[] = ['tl', 'tr', 'bl', 'br']

/** The size a small picture may take, as a share of the frame's width. */
export const PIP_MIN_SIZE = 0.15
export const PIP_MAX_SIZE = 0.6
/** How far in from the edges a corner sits, in output pixels. */
export const PIP_MAX_MARGIN = 80
export const PIP_DEFAULT_MARGIN = 24
/** Rounded, in output pixels: the one radius the section offers. */
export const PIP_ROUNDED_PX = 24

/**
 * Portrait (task 2159): a tall card like a phone's screen, 9 by 16, its
 * corners rounded by a share of its width so they grow with it, and a thin
 * light edge round it.
 */
export const PIP_PORTRAIT_ASPECT = 9 / 16
export const PIP_PORTRAIT_EDGE_COLOUR = '#d9d9d9'
const PORTRAIT_RADIUS_SHARE = 0.12
/** How far from its share a card's radius may be, as a drag or a keyframe leaves it, and still read as one. */
const PORTRAIT_RADIUS_SLACK = 0.03

/** A portrait card's radius at this width in output pixels, never the plain rounded one. */
export function portraitRadius(boxW: number): number {
  return Math.max(PIP_ROUNDED_PX + 2, Math.round(boxW * PORTRAIT_RADIUS_SHARE))
}

/** A portrait card's edge in output pixels: thin, a 360th of the frame's shorter side. */
export function portraitEdge(frameW: number, frameH: number): number {
  return Math.max(2, Math.round(Math.min(frameW, frameH) / 360))
}

/** How far off, in output pixels, a box still reads as sitting in a corner. */
const CORNER_SLACK_PX = 1

/** A box's edges in output pixels. */
function pixels(place: Place, frameW: number, frameH: number): { left: number; top: number; right: number; bottom: number; w: number; h: number } {
  const left = place.x * frameW
  const top = place.y * frameH
  const w = place.w * frameW
  const h = place.h * frameH
  return { left, top, w, h, right: frameW - left - w, bottom: frameH - top - h }
}

/**
 * The corner a box sits in, and its margin: it touches that corner's two
 * edges at the same distance, to within a pixel. Custom otherwise, as a box
 * dragged somewhere of its own is.
 */
export function pipCorner(place: Place, frameW: number, frameH: number): { corner: PipCorner | 'custom'; margin: number } {
  const p = pixels(place, frameW, frameH)
  for (const corner of PIP_CORNERS) {
    const across = corner[1] === 'l' ? p.left : p.right
    const down = corner[0] === 't' ? p.top : p.bottom
    if (Math.abs(across - down) <= CORNER_SLACK_PX && across >= -CORNER_SLACK_PX && across <= PIP_MAX_MARGIN + CORNER_SLACK_PX) {
      return { corner, margin: Math.max(0, Math.round((across + down) / 2)) }
    }
  }
  return { corner: 'custom', margin: PIP_DEFAULT_MARGIN }
}

/**
 * The shape a box and its style draw: a circle when the box is square in
 * output pixels and rounded by at least half its side, a portrait card when
 * it is 9 by 16 and rounded by about a card's share of its width, rounded
 * when it has any other radius, square otherwise.
 */
export function pipShape(style: PictureStyle | undefined, place: Place, frameW: number, frameH: number): PipShape {
  const radius = style?.radius ?? 0
  if (radius <= 0) return 'square'
  const w = place.w * frameW
  const h = place.h * frameH
  if (Math.abs(w - h) <= CORNER_SLACK_PX * 2 && radius >= Math.min(w, h) / 2 - CORNER_SLACK_PX) return 'circle'
  const tall = Math.abs(w / Math.max(1, h) - PIP_PORTRAIT_ASPECT) / PIP_PORTRAIT_ASPECT < 0.02
  const share = radius / Math.max(1, w)
  const card = radius !== PIP_ROUNDED_PX && (Math.abs(share - PORTRAIT_RADIUS_SHARE) <= PORTRAIT_RADIUS_SLACK || radius === portraitRadius(w))
  return tall && card ? 'portrait' : 'rounded'
}

/**
 * A box of a size and shape in a corner, `margin` output pixels in from its
 * two edges. `aspect` is the picture's own width over height, which a
 * rectangle keeps; a circle is square. Never larger than the frame allows.
 */
export function placeAtCorner(corner: PipCorner, size: number, margin: number, aspect: number, circle: boolean, frameW: number, frameH: number): Place {
  const share = Math.min(PIP_MAX_SIZE, Math.max(PIP_MIN_SIZE, size))
  const m = Math.min(PIP_MAX_MARGIN, Math.max(0, margin))
  let w = share * frameW
  let h = circle ? w : w / (aspect > 0 ? aspect : 16 / 9)
  // Too tall for the frame at this size: the height gives way, and the width with it.
  const most = frameH - 2 * m
  if (h > most) {
    w *= most / h
    h = most
  }
  const left = corner[1] === 'l' ? m : frameW - w - m
  const top = corner[0] === 't' ? m : frameH - h - m
  return { x: left / frameW, y: top / frameH, w: w / frameW, h: h / frameH }
}

/**
 * A box given a new size where it is not in a corner: it grows and shrinks
 * about the corner nearest the frame's middle's opposite, so the side it
 * was dragged to stays put, and is kept inside the frame.
 */
export function resizedInPlace(place: Place, size: number, aspect: number, circle: boolean, frameW: number, frameH: number): Place {
  const share = Math.min(PIP_MAX_SIZE, Math.max(PIP_MIN_SIZE, size))
  const w = share * frameW
  const h = Math.min(frameH, circle ? w : w / (aspect > 0 ? aspect : 16 / 9))
  const p = pixels(place, frameW, frameH)
  const onLeft = p.left + p.w / 2 < frameW / 2
  const onTop = p.top + p.h / 2 < frameH / 2
  const left = Math.min(frameW - w, Math.max(0, onLeft ? p.left : p.left + p.w - w))
  const top = Math.min(frameH - h, Math.max(0, onTop ? p.top : p.top + p.h - h))
  return { x: left / frameW, y: top / frameH, w: w / frameW, h: h / frameH }
}

/**
 * Where a dragged box lands: the corner whose place at this margin is
 * within `withinPx` output pixels of it, the nearest if several, or null to
 * stay where it was left.
 */
export function snapToCorner(place: Place, margin: number, frameW: number, frameH: number, withinPx: number): PipCorner | null {
  const p = pixels(place, frameW, frameH)
  let best: PipCorner | null = null
  let bestAway = Infinity
  for (const corner of PIP_CORNERS) {
    const left = corner[1] === 'l' ? margin : frameW - p.w - margin
    const top = corner[0] === 't' ? margin : frameH - p.h - margin
    const away = Math.hypot(left - p.left, top - p.top)
    if (away <= withinPx && away < bestAway) {
      best = corner
      bestAway = away
    }
  }
  return best
}

/**
 * The style for a shape on a box this size in output pixels, keeping its
 * border and shadow. A portrait card with no border is given its thin edge,
 * `edge` output pixels wide.
 */
export function styleForShape(style: PictureStyle | undefined, shape: PipShape, boxW: number, boxH: number, edge = 0): PictureStyle | null {
  const { radius: _was, ...rest } = style ?? {}
  const radius =
    shape === 'square' ? 0 : shape === 'rounded' ? PIP_ROUNDED_PX : shape === 'portrait' ? portraitRadius(boxW) : Math.ceil(Math.min(boxW, boxH) / 2)
  const edged = shape === 'portrait' && edge > 0 && (rest.border ?? 0) <= 0 ? { border: edge, borderColour: PIP_PORTRAIT_EDGE_COLOUR } : {}
  const next: PictureStyle = { ...rest, ...(radius > 0 ? { radius } : {}), ...edged }
  return Object.keys(next).length > 0 ? next : null
}

/** A style without the edge a portrait card was given, left as it was if its border is one of its own. */
export function withoutPortraitEdge(style: PictureStyle | undefined, edge: number): PictureStyle | undefined {
  if (!style || style.border !== edge || style.borderColour !== PIP_PORTRAIT_EDGE_COLOUR) return style
  const { border: _b, borderColour: _c, ...rest } = style
  return rest
}
