/**
 * Framing a clip in the output and laying its pictures out: copied crops, a
 * picture's place, layers, picture in picture, the named layouts, and laying
 * clips out again for a new frame.
 */

import { newId } from './ids'
import { cropAtKeys } from './crop-geometry'
import {
  refitInView, tidyPlace, isSideBySide, type Place, tidyFreePlace, placeAspect, MAX_LAYERS, viewsOf,
  layoutPlaces, cropInView, type NamedLayout, FULL_PLACE, layoutPictures, isFullFrame, viewOf, placeInNewFrame
} from './layout'
import { type PipCorner, type PipShape, pipCorner, pipShape, resizedInPlace, placeAtCorner, styleForShape } from './pip'
import { MAIN_PICTURE } from './project-core'
import type { Timeline, Rect, Clip, Layer, ProjectMedia, PictureStyle } from './project'
import { setPictureStyle } from './clip-looks'
import { targetAspect } from './sequences'
import { isOverlay, cleanOverlay, isDrawn } from './drawn-media'
import { updateVideoClip, findVideoClip, mediaOf } from './timeline-query'
import { type Framing, tidyCrop, recrop, zoomFields, zoomOf, settleKeys } from './zoom-keys'

/**
 * Give a clip another clip's framing: its pictures and their layout, in one
 * go, leaving its timing and sound alone. Onto a recording of the same size
 * the crops are taken exactly. Each crop is scaled by the same fraction of
 * the recording, so it frames the same part of it; and where the recording
 * or the frame is another shape, each crop then takes its place's shape
 * around the point it frames, and Split and Picture in picture are laid out
 * again, as a change of shape does. Nothing is left with bars at its sides.
 * Under a shape with no frame, which has no places or layers, only the main
 * crop is taken, keeping its own shape.
 */
export function setFraming(p: Timeline, clipId: string, framing: Framing): Timeline {
  return updateVideoClip(p, clipId, (c, m) => {
    const sx = framing.width > 0 ? m.width / framing.width : 1
    const sy = framing.height > 0 ? m.height / framing.height : 1
    const fit = (r: Rect): Rect => tidyCrop({ x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy }, m)
    const sameRecordingShape = Math.abs(sx - sy) < 1e-6
    if (!hasFrame(p)) {
      const crop = fit(framing.crop)
      const own = framing.crop.h > 0 ? framing.crop.w / framing.crop.h : crop.w / crop.h
      return recrop(c, sameRecordingShape ? crop : refitInView(crop, m.width, m.height, own), m)
    }
    // The zoom follows the crop pasted, so it does what it did relative to where it starts.
    const { rotation: _r, opacity: _o, ...own } = recrop(c, fit(framing.crop), m).transform
    const { width: FW, height: FH } = p.output
    // A box off the frame is an overlay's alone: a recording takes one kept on it.
    const place = isOverlay(m) ? framing.place : tidyPlace(framing.place, FW, FH)
    // Ids of their own: a layer's id is unique within its clip, and these came
    // from another. A picture this clip had in that slot keeps its own zoom,
    // following the crop pasted, as the main picture's does.
    const ids = framing.layers.map((_, i) => c.layers[i]?.id ?? newId())
    const withOwnZoom: Clip = {
      ...c,
      transform: { ...own, place, ...(isOverlay(m) ? cleanOverlay(framing) : {}) },
      layers: framing.layers.map((l, i) => {
        const had = c.layers[i]
        return had && (had.keys?.length ?? 0) > 0 ? { id: ids[i]!, ...zoomFields(had), place: l.place } : { id: ids[i]!, crop: fit(l.crop), place: l.place }
      }),
      layout: framing.layout
    }
    const pasted = framing.layers.reduce(
      (x, l, i) => ((c.layers[i]?.keys?.length ?? 0) > 0 ? recrop(x, fit(l.crop), m, ids[i]!) : x),
      withOwnZoom
    )
    const { width: W, height: H } = p.output
    const sameFrame = framing.frameW === W && framing.frameH === H
    return sameRecordingShape && sameFrame ? pasted : relaidOut(pasted, m, framing.frameW, framing.frameH, W, H)
  })
}

/**
 * The same framing pasted onto several clips at once, as one edit: Paste
 * framing with more than one selected. One edit rather than a run of them,
 * since a continuing run is replayed from the document before it began and
 * each paste would throw away the one before it.
 */
/**
 * Why a framing will not go onto a clip, in words, or null when it will.
 * A picture laid out from both views of a side by side recording has only
 * one view to take them from on a recording that holds one, and would come
 * out as the same picture twice: refused rather than applied wrong.
 */
export function framingRefusal(p: Timeline, clipId: string, framing: Framing): string | null {
  const found = findVideoClip(p, clipId)
  const m = found ? p.media.find((x) => x.id === found.clip.mediaId) : undefined
  if (!found || !m) return 'Only a picture clip has a framing to give it.'
  if (framing.layers.length > 0 && isSideBySide(framing.width, framing.height) && !isSideBySide(m.width, m.height)) {
    return "This framing takes its pictures from both views of a side by side recording, and this clip's recording holds only one."
  }
  return null
}

export function setFramingOn(p: Timeline, clipIds: readonly string[], framing: Framing): Timeline {
  return clipIds.reduce((t, id) => setFraming(t, id, framing), p)
}

/**
 * A crop copied on its own, without the rest of the framing: the rectangle,
 * and the size of the recording it was drawn on, so it can be pasted onto a
 * recording of another size as the same share of the picture.
 */
export interface CopiedCrop {
  crop: Rect
  width: number
  height: number
}

/**
 * The crop the Crop section shows for a picture of a clip, to paste onto
 * others. For a main picture that zooms, the crop on `frame` of the
 * recording when one is given, as the Crop section shows the playhead's.
 * Null for a clip with no crop.
 */
export function cropOf(p: Timeline, clipId: string, picture: string = MAIN_PICTURE, frame?: number): CopiedCrop | null {
  const found = findVideoClip(p, clipId)
  const m = found ? p.media.find((x) => x.id === found.clip.mediaId) : undefined
  if (!found || !m || isDrawn(m)) return null
  const c = found.clip
  // Any picture's crop on that frame, by its own zoom.
  const z = zoomOf(c, picture)
  const crop = frame === undefined ? z.crop : cropAtKeys(z.crop, z.keys, frame)
  return { crop, width: m.width, height: m.height }
}

/**
 * A copied crop pasted onto one picture of each clip named, as one edit: the
 * same share of each recording, snapped to even pixels and kept inside it.
 * The picture is the one in position `slot`, the main one for 0, Picture 2
 * for 1; a clip with no picture there is left alone, rather than having its
 * main picture cropped instead. Its place, layers and layout stay as they
 * are. A text, which has nothing to crop, and a sound clip are left alone.
 */
export function setCropOn(p: Timeline, clipIds: readonly string[], copied: CopiedCrop, slot = 0): Timeline {
  return clipIds.reduce(
    (t, id) =>
      updateVideoClip(t, id, (c, m) => {
        if (isDrawn(m)) return c
        const picture = slot > 0 ? c.layers[slot - 1]?.id : MAIN_PICTURE
        if (picture === undefined) return c
        const sx = copied.width > 0 ? m.width / copied.width : 1
        const sy = copied.height > 0 ? m.height / copied.height : 1
        const r = copied.crop
        const crop = tidyCrop({ x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy }, m)
        return recrop(c, crop, m, picture)
      }),
    p
  )
}

/**
 * A crop of its own for the same picture of each clip named, by position as
 * `setCropOn` takes it, in the recording's own pixels. A clip without that
 * picture, or a drawn one, is left as it is.
 */
export function setCropsOn(p: Timeline, crops: readonly { clipId: string; crop: Rect }[], slot = 0): Timeline {
  return crops.reduce(
    (t, { clipId, crop }) =>
      updateVideoClip(t, clipId, (c, m) => {
        if (isDrawn(m)) return c
        const picture = slot > 0 ? c.layers[slot - 1]?.id : MAIN_PICTURE
        if (picture === undefined) return c
        return recrop(c, tidyCrop(crop, m), m, picture)
      }),
    p
  )
}

/** Whether the timeline's shape has a size, which places need. Handoff has none. */
export function hasFrame(p: Timeline): boolean {
  return targetAspect(p) !== null
}

/**
 * Move or reshape one picture's place. With `reshapeCrop`, which is the
 * window's aspect lock, the crop takes the place's new shape around the point
 * it frames. It reshapes `fromCrop`, the crop a drag began with, when given:
 * reshaping the latest crop on every movement would zoom it in a little each
 * time, and a drag back to where it started would not give back its crop.
 * Any hand placing makes the layout Custom.
 */
export function setPlace(
  p: Timeline,
  clipId: string,
  picture: string,
  place: Place,
  reshapeCrop: boolean,
  fromCrop?: Rect
): Timeline {
  if (!hasFrame(p)) return p
  const { width: W, height: H } = p.output
  return updateVideoClip(p, clipId, (c, m) => {
    // An overlay's main box may reach past the frame; everything else stays on it.
    const tidy = picture === MAIN_PICTURE && isOverlay(m) ? tidyFreePlace(place, W, H) : tidyPlace(place, W, H)
    // Put where it already is, it is left alone: a layout stays named rather
    // than turning Custom, so a change of shape still lays it out again.
    const now = picture === MAIN_PICTURE ? c.transform.place : c.layers.find((l) => l.id === picture)?.place
    if (!reshapeCrop && now && unmoved(now, tidy)) return c
    const fit = (crop: Rect): Rect =>
      reshapeCrop ? refitInView(fromCrop ?? crop, m.width, m.height, placeAspect(tidy, W, H)) : crop
    if (picture === MAIN_PICTURE) {
      const moved = reshapeCrop ? recrop(c, fit(c.transform.crop), m) : c
      return { ...moved, transform: { ...moved.transform, place: tidy }, layout: 'custom' }
    }
    const layer = c.layers.find((l) => l.id === picture)
    if (!layer) return c
    const reshaped = reshapeCrop ? recrop(c, fit(layer.crop), m, picture) : c
    return {
      ...reshaped,
      layers: reshaped.layers.map((l) => (l.id === picture ? { ...l, place: tidy } : l)),
      layout: 'custom'
    }
  })
}

/** Whether a place is where it was, allowing only for the arithmetic that got it there. */
function unmoved(a: Place, b: Place): boolean {
  const near = (x: number, y: number): boolean => Math.abs(x - y) < 1e-6
  return near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h)
}

/**
 * Add a layer where Picture in picture would put it, cropped from the middle
 * of the source, or from the right half of a side by side one.
 */
export function addLayer(p: Timeline, clipId: string, layerId: string): Timeline {
  if (!hasFrame(p)) return p
  const { width: W, height: H } = p.output
  return updateVideoClip(p, clipId, (c, m) => {
    if (c.layers.length >= MAX_LAYERS || c.layers.some((l) => l.id === layerId) || layerId === MAIN_PICTURE) return c
    const views = viewsOf(m.width, m.height)
    const view = views[1] ?? views[0]!
    const place = layoutPlaces('pip', W, H, view.w / view.h)[1]!
    const layer: Layer = { id: layerId, place, crop: cropInView(view, placeAspect(place, W, H)) }
    return { ...c, layers: [...c.layers, layer], layout: 'custom' }
  })
}

export function removeLayer(p: Timeline, clipId: string, layerId: string): Timeline {
  return updateVideoClip(p, clipId, (c) =>
    c.layers.some((l) => l.id === layerId)
      ? { ...c, layers: c.layers.filter((l) => l.id !== layerId), layout: 'custom' }
      : c
  )
}

/** A clip's pictures laid out as a named layout in the timeline's frame. */
function laidOut(c: Clip, m: ProjectMedia, kind: NamedLayout, W: number, H: number, newLayerId: () => string): Clip {
  if (kind === 'single') {
    const single = recrop(c, refitInView(c.transform.crop, m.width, m.height, W / H), m)
    return {
      ...single,
      transform: { ...single.transform, place: FULL_PLACE },
      layers: [],
      layout: 'single'
    }
  }
  const [main, layer] = layoutPictures(kind, m.width, m.height, W, H)
  const had = c.layers[0]
  const laid = recrop(c, main.crop, m)
  // The first further picture keeps its zoom, following its new crop as the main one's does.
  const second: Layer = had ? { id: had.id, ...zoomFields(had), place: layer.place } : { id: newLayerId(), crop: layer.crop, place: layer.place }
  const next: Clip = {
    ...laid,
    transform: { ...laid.transform, place: main.place },
    layers: [second],
    layout: kind
  }
  return had ? recrop(next, layer.crop, m, had.id) : next
}

/**
 * Lay a clip out as Single, Split or Picture in picture. Split and Picture in
 * picture show two pictures, so any further layers go.
 */
/**
 * A clip's picture in picture, when it has one: the small picture over a
 * large one. That is the one other picture of a clip laid out as Picture in
 * picture, or moved by hand from there with its main picture still over the
 * whole frame; or the main picture of a clip on a track above V1 that does
 * not cover the whole frame, as a recording put in a corner is. Null for
 * anything else, and for a shape with no frame.
 */
export function pipOf(p: Timeline, clipId: string): { picture: string; place: Place; crop: Rect; style: PictureStyle | undefined; twoViews: boolean } | null {
  if (!hasFrame(p)) return null
  const found = findVideoClip(p, clipId)
  const m = found ? p.media.find((x) => x.id === found.clip.mediaId) : undefined
  if (!found || !m) return null
  const c = found.clip
  const full = (place: Place): boolean => isFullFrame(place)
  const layer = c.layers[0]
  if (layer && c.layers.length === 1 && full(c.transform.place) && !full(layer.place) && (c.layout === 'pip' || c.layout === 'custom')) {
    return { picture: layer.id, place: layer.place, crop: layer.crop, style: layer.style, twoViews: isSideBySide(m.width, m.height) }
  }
  if (found.index > 0 && c.layers.length === 0 && !full(c.transform.place) && !isDrawn(m)) {
    return { picture: MAIN_PICTURE, place: c.transform.place, crop: c.transform.crop, style: c.transform.style, twoViews: false }
  }
  return null
}

/** What `setPip` changes: any of these, the rest kept as they are. */
export interface PipChange {
  corner?: PipCorner
  /** A share of the frame's width. */
  size?: number
  /** In output pixels, from the frame's edges. */
  margin?: number
  shape?: PipShape
  /**
   * The box's own shape, width over height in output pixels, or `own` for its
   * view's: a square, tall or wide camera box (bugs and notes 2, note 34).
   * The picture fills it, cropped to fit rather than stretched.
   */
  aspect?: number | 'own'
}

/**
 * Change a clip's picture in picture: its corner, size, margin or shape, as
 * one edit. A corner puts the box that far in from its two edges; a new size
 * keeps its corner, or the side of a box placed by hand nearest the frame's
 * edge. A circle makes the box square and rounds it all the way, and leaving
 * the circle gives the box its view's own shape back. The crop follows the
 * box's shape around the point it frames, as the aspect lock does.
 */
export function setPip(p: Timeline, clipId: string, change: PipChange): Timeline {
  const pip = pipOf(p, clipId)
  const m = pip ? mediaOf(p, findVideoClip(p, clipId)!.clip.mediaId) : undefined
  if (!pip || !m) return p
  const { width: W, height: H } = p.output
  const now = pipCorner(pip.place, W, H)
  const shapeNow = pipShape(pip.style, pip.place, W, H)
  const corner = change.corner ?? now.corner
  const margin = change.margin ?? now.margin
  const size = change.size ?? pip.place.w
  const view = viewOf(pip.crop, m.width, m.height)
  const asked = change.aspect === 'own' ? view.w / view.h : change.aspect
  // A circle is square: another shape asked for makes it a rounded box instead.
  const shape = change.shape ?? (asked !== undefined && Math.abs(asked - 1) > 0.01 && shapeNow === 'circle' ? 'rounded' : shapeNow)
  const circle = shape === 'circle'
  // A rectangle keeps its own shape, or takes the one asked for; one coming out of a circle takes its view's.
  const aspect = asked ?? (shapeNow === 'circle' ? view.w / view.h : (pip.place.w * W) / (pip.place.h * H))
  const place = corner === 'custom' ? resizedInPlace(pip.place, size, aspect, circle, W, H) : placeAtCorner(corner, size, margin, aspect, circle, W, H)
  let next = setPlace(p, clipId, pip.picture, place, true)
  if (change.shape !== undefined || circle || shape !== shapeNow) next = setPictureStyle(next, clipId, pip.picture, styleForShape(pip.style, shape, place.w * W, place.h * H))
  return next
}

export function applyLayout(p: Timeline, clipId: string, kind: NamedLayout): Timeline {
  if (!hasFrame(p)) return p
  const { width: W, height: H } = p.output
  return updateVideoClip(p, clipId, (c, m) => laidOut(c, m, kind, W, H, newId))
}

/**
 * Exchange the two views: the main picture takes the first layer's crop and
 * the layer the main's, each reshaped to its own place. The places and the
 * drawing order stay, so Picture in picture keeps its box on top.
 */
export function swapPictures(p: Timeline, clipId: string): Timeline {
  if (!hasFrame(p)) return p
  const { width: W, height: H } = p.output
  return updateVideoClip(p, clipId, (c, m) => {
    const layer = c.layers[0]
    if (!layer) return c
    const mainCrop = refitInView(layer.crop, m.width, m.height, placeAspect(c.transform.place, W, H))
    const layerCrop = refitInView(c.transform.crop, m.width, m.height, placeAspect(layer.place, W, H))
    // Each picture's zoom follows its own new crop, as the main one's always has.
    return recrop(recrop(c, mainCrop, m), layerCrop, m, layer.id)
  })
}

/**
 * Give every other clip of the same recording on the same track this clip's
 * pictures: its main crop and place, its layers and its layout. A recording's
 * views usually stay put for a whole session, so one layout suits every clip
 * cut from it.
 */
export function applyLayoutToSource(p: Timeline, clipId: string): Timeline {
  const found = findVideoClip(p, clipId)
  if (!found) return p
  const from = found.clip
  let next = p
  for (const c of found.track.clips) {
    if (c.id === from.id || c.mediaId !== from.mediaId) continue
    // Its zoom too, which is on the same recording's frames, so it lands on
    // the same moments of it; only the keyframes this clip can reach stay.
    next = updateVideoClip(next, c.id, (x) =>
      settleKeys({
        ...x,
        transform: { ...from.transform },
        layers: from.layers.map((l) => ({ ...l })),
        layout: from.layout
      })
    )
  }
  return next
}

/**
 * The corner box Picture in picture uses, in a frame this size, for a picture
 * showing this crop: a third of the frame wide, the shape of the view it shows.
 */
export function cornerPlace(m: ProjectMedia, crop: Rect, frameW: number, frameH: number): Place {
  const view = viewOf(crop, m.width, m.height)
  return layoutPlaces('pip', frameW, frameH, view.w / view.h)[1] ?? FULL_PLACE
}

function samePlace(a: Place, b: Place): boolean {
  const near = (x: number, y: number): boolean => Math.abs(x - y) < 1e-3
  return near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h)
}

/** Whether a picture is in the corner box of a frame this size, as Corner puts it. */
export function isCornerPlace(m: ProjectMedia, crop: Rect, place: Place, frameW: number, frameH: number): boolean {
  return samePlace(place, cornerPlace(m, crop, frameW, frameH))
}

/**
 * Lay a clip out again for a new frame. A named layout is laid out afresh, so
 * a stacked Split becomes side by side. A clip in the Corner place is put in
 * the new frame's corner box. Other Custom places keep their own shapes and
 * are scaled to fit. Then every crop takes its place's new shape around the
 * point it frames, kept inside the view it shows.
 */
export function relaidOut(c: Clip, m: ProjectMedia, oldW: number, oldH: number, W: number, H: number): Clip {
  let mainPlace = c.transform.place
  let layers = c.layers
  if (c.layout === 'split' || c.layout === 'pip') {
    const first = layers[0]
    const view = first ? viewOf(first.crop, m.width, m.height) : viewsOf(m.width, m.height)[0]!
    const places = layoutPlaces(c.layout, W, H, view.w / view.h)
    mainPlace = places[0] ?? FULL_PLACE
    layers = layers.map((l, i) => (i === 0 && places[1] ? { ...l, place: places[1] } : l))
  } else if (c.layout === 'single') {
    mainPlace = FULL_PLACE
  } else if (layers.length === 0 && isCornerPlace(m, c.transform.crop, mainPlace, oldW, oldH)) {
    mainPlace = cornerPlace(m, c.transform.crop, W, H)
  } else {
    mainPlace = placeInNewFrame(mainPlace, oldW, oldH, W, H)
    layers = layers.map((l) => ({ ...l, place: placeInNewFrame(l.place, oldW, oldH, W, H) }))
  }
  const fit = (crop: Rect, place: Place): Rect => refitInView(crop, m.width, m.height, placeAspect(place, W, H))
  const refit = recrop(c, fit(c.transform.crop, mainPlace), m)
  const placed: Clip = { ...refit, transform: { ...refit.transform, place: mainPlace }, layers }
  return layers.reduce((x, l) => recrop(x, fit(l.crop, l.place), m, l.id), placed)
}

/** Whether a clip draws anything beyond one picture filling the frame. */
export function hasLayout(c: Clip): boolean {
  return c.layers.length > 0 || !isFullFrame(c.transform.place)
}
