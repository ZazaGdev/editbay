import type { Fit } from './crop-geometry'

/**
 * Zooming the Source view: how far in, and about which part of the
 * recording. A zoom is a scale over the fitted picture, 1 being fitted as with
 * no zoom, and the source pixel in the middle of the view. Pure, so where the
 * picture goes, and so where the crop box is drawn over it, is tested without
 * a window.
 */

export interface SourceZoom {
  /** Over the fitted picture: above 1, up to `MAX_SOURCE_ZOOM`. */
  scale: number
  /** The source pixel in the middle of the view. */
  cx: number
  cy: number
}

/** The most the Source view zooms in, over the fitted picture. */
export const MAX_SOURCE_ZOOM = 8

/**
 * The most the Output view zooms in (task 53): its whole frame is drawn again
 * at the zoomed size, so it stops sooner than the Source view's recording.
 */
export const MAX_OUTPUT_ZOOM = 4

/** How much one notch of the wheel zooms in, or out as its inverse. */
export const WHEEL_ZOOM = 1.25

interface View {
  width: number
  height: number
}

interface Size {
  w: number
  h: number
}

/**
 * Where a picture `size` long starts in a view `length` long, with the point
 * `at` along the picture in the middle of the view: never leaving empty space
 * inside the view where the picture is longer than it, and centred where it
 * is shorter.
 */
function start(length: number, size: number, at: number): number {
  if (size <= length) return (length - size) / 2
  return Math.min(0, Math.max(length - size, length / 2 - at))
}

/**
 * The zoomed picture's placement in the view, in the same terms as the fitted
 * one: scaled about the pixel asked for, which comes to the middle of the view
 * where the picture's edges allow. No zoom, or a zoom of 1, is the fitted
 * placement itself.
 */
export function zoomedFit(fit: Fit, view: View, source: Size, zoom: SourceZoom | null, max = MAX_SOURCE_ZOOM): Fit {
  if (!zoom || !(zoom.scale > 1) || !(fit.scale > 0)) return fit
  const scale = fit.scale * Math.min(zoom.scale, max)
  const width = source.w * scale
  const height = source.h * scale
  return {
    scale,
    width,
    height,
    offsetX: start(view.width, width, zoom.cx * scale),
    offsetY: start(view.height, height, zoom.cy * scale)
  }
}

/**
 * The zoom with its middle moved to where the view really is, once the
 * picture's edges have been allowed for, so a pan pushed past an edge moves
 * back at once rather than having to be undone first.
 */
function settle(fit: Fit, view: View, source: Size, zoom: SourceZoom, max: number): SourceZoom {
  const f = zoomedFit(fit, view, source, zoom, max)
  return { scale: zoom.scale, cx: (view.width / 2 - f.offsetX) / f.scale, cy: (view.height / 2 - f.offsetY) / f.scale }
}

/**
 * Zoom by `factor`, keeping the source pixel under `pointer`, a point of the
 * view, where it is. Null, no zoom, once back at 1 or below.
 */
export function zoomAt(
  fit: Fit,
  view: View,
  source: Size,
  zoom: SourceZoom | null,
  pointer: { x: number; y: number },
  factor: number,
  max = MAX_SOURCE_ZOOM
): SourceZoom | null {
  if (!(fit.scale > 0)) return null
  const now = zoomedFit(fit, view, source, zoom, max)
  const sx = (pointer.x - now.offsetX) / now.scale
  const sy = (pointer.y - now.offsetY) / now.scale
  const next = Math.min(max, (zoom?.scale ?? 1) * factor)
  if (!(next > 1 + 1e-9)) return null
  const scale = fit.scale * next
  // The middle that puts (sx, sy) under the pointer.
  return settle(fit, view, source, {
    scale: next,
    cx: sx + (view.width / 2 - pointer.x) / scale,
    cy: sy + (view.height / 2 - pointer.y) / scale
  }, max)
}

/** Move the zoomed picture by `dx`, `dy` screen pixels, as far as its edges allow. Null with no zoom. */
export function panBy(
  fit: Fit,
  view: View,
  source: Size,
  zoom: SourceZoom | null,
  dx: number,
  dy: number,
  max = MAX_SOURCE_ZOOM
): SourceZoom | null {
  if (!zoom || !(fit.scale > 0)) return null
  const scale = fit.scale * Math.min(zoom.scale, max)
  return settle(fit, view, source, { ...zoom, cx: zoom.cx - dx / scale, cy: zoom.cy - dy / scale }, max)
}
