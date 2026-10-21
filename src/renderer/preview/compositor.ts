import { targetAspect, type PictureStyle, type Rect, type Timeline } from '../../shared/project'
import { DEFAULT_BORDER_COLOUR, blurSigma, shadowOf } from '../../shared/picture-style'
import { FULL_PLACE, fitInPlace, freePlaceInPixels, placeInPixels, type Place } from '../../shared/layout'
import { fitInBox } from '../../shared/crop-geometry'
import { outputSizeFor, presetById } from '../../shared/presets'
import { alphaOfKey, colourCanvas, colourFilterId, colourKey, distanceOfKey, distanceTable, feColorMatrixValues, isKeyed, matrixOfKey, type Coloured } from '../../shared/looks'
import type { BlurRegion } from '../../shared/blur'
import { blurAt, rgbSplitAt, spinAt, zoomOutAt } from '../../shared/transitions'
import { pixelate, splitColours } from './stylised'
import { drawCaption } from './drawCaption'

export { drawCaption }

/**
 * Drawing the Output view: the finished frame, fitted in the monitor with
 * black around it, and the pictures of the clip under the playhead on every
 * video track, V1's first and each track's over the ones below.
 *
 * Every picture of one clip is drawn from the same decoded video frame, so the
 * views of one recording are in step by construction, and a wide recording is
 * decoded once however many pictures it has.
 */

export interface DrawStep {
  /** Which part of the video to take, in the video's own pixels. */
  from: Rect
  /** Where it goes on the monitor, in layout pixels. */
  to: Rect
  /** Which clip's video it is taken from: 0 is the lowest track's, then each track above in order. */
  source: number
  /**
   * A colour over this picture and no further, and how much of it: a dip to
   * black or white, part way through. Over its own place rather than over the
   * whole monitor, because a cutaway dipping to black dips the cutaway; what
   * is on the track under it is not dipping and the export does not dip it.
   */
  wash?: { colour: 'black' | 'white'; alpha: number }
  /**
   * Where the wash goes, when not over the picture's box: the whole frame for
   * the lowest clip, whose bars the export dips with it, or the picture's own
   * pixels for one with see-through parts, which the export dips and leaves
   * see-through (audit 2026-10-01).
   */
  washOver?: { frame: Rect } | 'pixels'
  /** How this picture is mixed with the other clip of its track, over a blend. */
  mix?: Mix
  /** The canvas filter its clip's look is drawn with. Absent for the recording's own colour. */
  filter?: string
  /** What of the video is blurred, in its own pixels, as `from` is (plan 85). */
  blurs?: BlurRegion[]
  /** An overlay's turn, in radians clockwise about the middle of `to`. */
  turn?: number
  /** An overlay's opacity, 0 to 1. */
  alpha?: number
  /** An overlay's size as it pops in or out, about the middle of `to`: 1 for its own. */
  grow?: number
  /** The picture's whole box, in layout pixels, which `to` is fitted inside. */
  box?: Rect
  /** Its bars filled with itself, enlarged and blurred this far, in layout pixels. */
  blur?: number
  /** Its box framed as a picture in picture, in layout pixels: as the export frames it. */
  frame?: { radius: number; border: number; colour: string; shadow: { sigma: number; dy: number; alpha: number } | null }
  /**
   * Its box moved by its keyframes (plan 97): drawn whole where its own place
   * is, frame and shadow and all, then moved so that place's corner `from`
   * lands on `to` and scaled `sx` across and `sy` down, as the export moves
   * and scales the finished box. In layout pixels.
   */
  slide?: { from: { x: number; y: number }; to: { x: number; y: number }; sx: number; sy: number }
}

/**
 * How one side of a blend is drawn, which is all the difference between the
 * three kinds: a dissolve is see-through, a wipe is cut to a shrinking
 * rectangle, and a push is the same picture moved sideways.
 *
 * Worked out to match `xfade`, which is what the export uses, so what is on the
 * monitor is what lands in the file.
 */
export interface Mix {
  /** 0 to 1, for a dissolve. Absent means fully drawn. */
  alpha?: number
  /** Only this part of the monitor, in layout pixels, for a wipe. */
  clip?: Rect
  /** Moved this far sideways, in layout pixels, for a push. */
  dx?: number
  /** Moved this far down, in layout pixels, for a push up or down. */
  dy?: number
  /** Only inside this circle, in layout pixels, for the iris. */
  circle?: { x: number; y: number; r: number }
  /** Enlarged `k` times about this point, for a zoom through the cut. */
  zoom?: { x: number; y: number; k: number }
  /**
   * Drawn more or less by how far each point is from this one: fully where
   * `alpha(d)` is 1, not at all where it is 0, for a soft circle.
   */
  radial?: { x: number; y: number; reach: number; alpha: (d: number) => number }
  /** Blurred both ways by a gaussian of this deviation, in layout pixels, for a blur. */
  gauss?: { sigma: number }
  /** Not drawn at all. */
  hidden?: boolean
  /** Turned this far clockwise, in radians, about this point, for a spin (plan 95). */
  turn?: { x: number; y: number; a: number }
  /** Cut into squares this many layout pixels across, counted from the frame's corner, for a pixelate. */
  pixel?: { size: number; frame: Rect }
  /** Its red pulled this many layout pixels left and its blue as far right, for an RGB split. */
  split?: { d: number; frame: Rect }
}

export interface DrawPlan {
  /** The output frame on the monitor, in layout pixels. Black where no picture covers it. */
  frame: Rect
  steps: DrawStep[]
}

/** A clip to draw: its pictures, the main one first, each a crop of its recording and a place in the frame. */
export interface DrawnClip {
  /** Each picture's crop and place, and where its keyframes put its box at this frame (plan 97). */
  pictures: ({ crop: Rect; place: Place; style?: PictureStyle; box?: { place: Place; opacity: number } } & Coloured)[]
  /** The bars round its pictures filled with the picture blurred. Never on an overlay placed freely. */
  blurFill?: boolean
  /** On a track over the lowest one shown, so its main picture is framed as a picture in picture. */
  over?: boolean
  /** A colour over its pictures, where a transition is dipping through one. */
  wash?: { colour: 'black' | 'white'; alpha: number }
  /** How its pictures are mixed with the other clip of its track, over a blend. */
  mix?: Mix
  /** Its colour, as `colourKey` codes it, on every one of its pictures. */
  look?: string
  /** What of its video it blurs, in the video's own pixels (plan 85). */
  blurs?: BlurRegion[]
  /**
   * An overlay: its main box may reach past the frame, turned by `rotation`
   * degrees and drawn at `opacity`, as the export lays it over.
   */
  free?: { rotation?: number; opacity?: number; scale?: number }
}

/**
 * What to draw for the clips under the playhead, lowest track first, in a
 * monitor of this size. The export's own arithmetic: places rounded to even
 * output pixels, and each crop fitted in its place, never stretched.
 */
export function drawPlan(timeline: Timeline, clips: DrawnClip[], box: { width: number; height: number }): DrawPlan {
  // Handoff has no fixed frame: the output is the lowest clip's main crop at
  // source scale, and it has nowhere to place anything else.
  const framed = targetAspect(timeline) !== null
  const bottom = clips[0]?.pictures[0]
  if (!framed && !bottom) return { frame: { x: 0, y: 0, w: 0, h: 0 }, steps: [] }
  const size = framed
    ? { width: timeline.output.width, height: timeline.output.height }
    : outputSizeFor(presetById(timeline.presetId), bottom!.crop)
  const fit = fitInBox(size.width, size.height, box.width, box.height)
  const frame = { x: fit.offsetX, y: fit.offsetY, w: fit.width, h: fit.height }
  if (!(fit.scale > 0)) return { frame, steps: [] }

  // Without a frame to place anything in, as under Handoff, the lowest clip's
  // main picture is the output on its own. A blend is not mixed there: the
  // export cannot make one in that mode either, and the two have to agree.
  const drawn: DrawnClip[] = framed
    ? clips
    : clips
        .slice(0, 1)
        .map((c) => ({
          pictures: [{ crop: c.pictures[0]!.crop, place: FULL_PLACE }],
          ...(c.wash ? { wash: c.wash } : {}),
          ...(c.look ? { look: c.look } : {}),
          ...(c.blurs ? { blurs: c.blurs } : {})
        }))
  const steps = drawn.flatMap((c, source) => {
    const filter = colourFilter(c.look)
    // A background taken out (plan 90) is see-through, as an image is: no
    // frame, no blurred bars and no black box behind it, in the export either.
    const keyed = isKeyed(c.look)
    return c.pictures.map((p, j) => {
      const free = framed && c.free !== undefined && j === 0 ? c.free : null
      const place = free ? freePlaceInPixels(p.place, size.width, size.height) : placeInPixels(p.place, size.width, size.height)
      const inPlace = fitInPlace(p.crop.w, p.crop.h, place)
      const box = { x: fit.offsetX + place.x * fit.scale, y: fit.offsetY + place.y * fit.scale, w: place.w * fit.scale, h: place.h * fit.scale }
      // Framed as the export frames it: a layer always, the main picture only
      // when the clip lies over another track, and never an overlay placed freely.
      const style = framed && !free && !keyed && (j > 0 || (c.over ?? source > 0)) ? p.style : undefined
      // A layer's own look (task 1188), after its clip's, as the export lays it on its crop.
      const own = j > 0 ? colourFilter(colourKey(p)) : undefined
      const filtered = own ? (filter ? `${filter} ${own}` : own) : filter
      const radius = Math.min(style?.radius ?? 0, Math.floor(Math.min(place.w, place.h) / 2))
      const border = style?.border ?? 0
      const shadow = style?.shadow === true ? shadowOf(size.width, size.height) : null
      const blur = framed && !free && !keyed && c.blurFill === true ? blurSigma(size.width, size.height) * fit.scale : null
      // A box its keyframes move (plan 97), from its own place to theirs at this
      // frame, in output pixels unrounded, as the export works it out.
      const moved = framed && !free && p.box ? p.box : null
      const slide = moved
        ? {
            from: { x: fit.offsetX + place.x * fit.scale, y: fit.offsetY + place.y * fit.scale },
            to: { x: fit.offsetX + moved.place.x * size.width * fit.scale, y: fit.offsetY + moved.place.y * size.height * fit.scale },
            sx: (moved.place.w * size.width) / Math.max(1, place.w),
            sy: (moved.place.h * size.height) / Math.max(1, place.h)
          }
        : null
      return {
        ...(slide ? { slide } : {}),
        ...(moved && moved.opacity < 1 ? { alpha: Math.max(0, moved.opacity) } : {}),
        source,
        from: p.crop,
        to: {
          x: fit.offsetX + inPlace.x * fit.scale,
          y: fit.offsetY + inPlace.y * fit.scale,
          w: inPlace.w * fit.scale,
          h: inPlace.h * fit.scale
        },
        ...(c.wash ? { wash: c.wash } : {}),
        ...(c.wash && framed && !free && !(c.over ?? source > 0) ? { washOver: { frame } } : {}),
        ...(c.wash && free ? { washOver: 'pixels' as const } : {}),
        ...(c.mix ? { mix: c.mix } : {}),
        ...(filtered ? { filter: filtered } : {}),
        ...(c.blurs ? { blurs: c.blurs } : {}),
        ...(free?.rotation ? { turn: (free.rotation * Math.PI) / 180 } : {}),
        ...(free?.opacity !== undefined && free.opacity < 1 ? { alpha: free.opacity } : {}),
        ...(free?.scale !== undefined && free.scale !== 1 ? { grow: Math.max(0, free.scale) } : {}),
        ...(blur !== null || radius > 0 || border > 0 || shadow ? { box } : {}),
        ...(blur !== null ? { blur } : {}),
        ...(radius > 0 || border > 0 || shadow
          ? {
              frame: {
                radius: radius * fit.scale,
                border: border * fit.scale,
                colour: style?.borderColour ?? DEFAULT_BORDER_COLOUR,
                shadow: shadow ? { sigma: shadow.sigma * fit.scale, dy: shadow.dy * fit.scale, alpha: shadow.alpha } : null
              }
            }
          : {})
      }
    })
  })
  return { frame, steps }
}

/**
 * How the two sides of a blend are drawn at `p`, from 0 on the window's first
 * frame to nearly 1 on its last, over a frame `w` layout pixels wide.
 *
 * Each one is `xfade`'s own behaviour written for a canvas. A dissolve mixes
 * the two. A wipe left uncovers the incoming picture from the right edge
 * leftwards, and a wipe right from the left edge rightwards. A push moves both
 * pictures together, the outgoing one out and the incoming one in behind it.
 */
export function mixFor(kind: string, p: number, frame: Rect, outputWidth = 1080): { out: Mix; into: Mix } {
  const at = Math.min(1, Math.max(0, p))
  // `xfade`'s own progress runs the other way, from 1 on the first frame to 0.
  const P = 1 - at
  const { x, y, w, h } = frame
  const cx = x + w / 2
  const cy = y + h / 2
  const reach = Math.hypot(w / 2, h / 2)
  switch (kind) {
    case 'wipeLeft':
      return { out: {}, into: { clip: { x: x + w * (1 - at), y, w: w * at, h } } }
    case 'wipeRight':
      return { out: {}, into: { clip: { x, y, w: w * at, h } } }
    case 'wipeUp':
      return { out: {}, into: { clip: { x, y: y + h * (1 - at), w, h: h * at } } }
    case 'wipeDown':
      return { out: {}, into: { clip: { x, y, w, h: h * at } } }
    case 'pushLeft':
      return { out: { dx: -w * at }, into: { dx: w * (1 - at) } }
    case 'pushRight':
      return { out: { dx: w * at }, into: { dx: -w * (1 - at) } }
    case 'pushUp':
      return { out: { dy: -h * at }, into: { dy: h * (1 - at) } }
    case 'pushDown':
      return { out: { dy: h * at }, into: { dy: -h * (1 - at) } }
    // The next picture slides in over the one going, which stays still.
    case 'coverLeft':
      return { out: {}, into: { dx: w * (1 - at) } }
    case 'coverRight':
      return { out: {}, into: { dx: -w * (1 - at) } }
    case 'coverUp':
      return { out: {}, into: { dy: h * (1 - at) } }
    case 'coverDown':
      return { out: {}, into: { dy: -h * (1 - at) } }
    // The one going slides off the next, which stays still behind it.
    case 'revealLeft':
      return { out: { dx: -w * at }, into: { clip: { x: x + w * (1 - at), y, w: w * at, h } } }
    case 'revealRight':
      return { out: { dx: w * at }, into: { clip: { x, y, w: w * at, h } } }
    case 'revealUp':
      return { out: { dy: -h * at }, into: { clip: { x, y: y + h * (1 - at), w, h: h * at } } }
    case 'revealDown':
      return { out: { dy: h * at }, into: { clip: { x, y, w, h: h * at } } }
    // A soft circle, as wide as the frame's half diagonal, opening from the middle or closing on it.
    case 'circleOpen':
      return { out: {}, into: { radial: { x: cx, y: cy, reach, alpha: (d) => 1 - smoothstep(0, 1, d / reach + (P - 0.5) * 3) } } }
    case 'circleClose':
      return { out: {}, into: { radial: { x: cx, y: cy, reach, alpha: (d) => smoothstep(0, 1, d / reach + (0.5 - P) * 3) } } }
    // Black outside a circle, or a box, closing on the picture going and opening on the next.
    case 'iris': {
      const circle = { x: cx, y: cy, r: Math.pow(2 * Math.abs(P - 0.5), 3) * reach }
      return P < 0.5 ? { out: { hidden: true }, into: { circle } } : { out: { circle }, into: { hidden: true } }
    }
    case 'box': {
      const hw = Math.abs(P - 0.5) * w
      const hh = Math.abs(P - 0.5) * h
      const clip = { x: cx - hw, y: cy - hh, w: 2 * hw, h: 2 * hh }
      return P < 0.5 ? { out: { hidden: true }, into: { clip } } : { out: { clip }, into: { hidden: true } }
    }
    // Into the middle of the picture going over the first half, then out of it into the next.
    case 'zoomIn': {
      const zf = smoothstep(0.5, 1, P)
      return { out: { zoom: { x: cx, y: cy, k: 1 / Math.max(zf, 0.002) } }, into: { alpha: 1 - smoothstep(0, 0.5, P) } }
    }
    // Both blurred, most at the middle, while one dissolves into the other.
    case 'blur': {
      const gauss = { sigma: (blurAt(at, outputWidth) * w) / Math.max(1, outputWidth) }
      return { out: { gauss }, into: { gauss, alpha: at } }
    }
    // Plan 95. The next picture enlarged, pulling back to its own size as it dissolves in.
    case 'zoomOut':
      return { out: {}, into: { zoom: { x: cx, y: cy, k: zoomOutAt(at) }, alpha: at } }
    // `pixelize`: both cut into squares, largest at the middle, while one dissolves into the other.
    case 'pixelate': {
      const outputHeight = (outputWidth * h) / Math.max(1, w)
      const dist = Math.ceil(Math.min(P, 1 - P) * 50) / 50
      const size = ((2 * dist * Math.min(outputWidth, outputHeight)) / 20) * (w / Math.max(1, outputWidth))
      const pixel = size > 0 ? { pixel: { size, frame } } : {}
      return { out: { ...pixel }, into: { ...pixel, alpha: at } }
    }
    // A dissolve with red and blue pulled apart, most at the middle.
    case 'rgbSplit': {
      const d = (rgbSplitAt(at, outputWidth) * w) / Math.max(1, outputWidth)
      const split = d > 0 ? { split: { d, frame } } : {}
      return { out: { ...split }, into: { ...split, alpha: at } }
    }
    // A dissolve turned one whole turn about the middle of the frame.
    case 'spin': {
      const turn = { x: cx, y: cy, a: spinAt(at) }
      return { out: { turn }, into: { turn, alpha: at } }
    }
    default:
      return { out: {}, into: { alpha: at } }
  }
}

/** `xfade`'s smoothstep: 0 below `edge0`, 1 above `edge1`, and an S between. */
function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}


/**
 * Carry a plan out onto a canvas whose backing store is `scale` device pixels
 * per layout pixel, so it stays sharp on a scaled display. False when it
 * drew nothing but black, the picture underneath not being ready.
 */
export function drawOnto(
  ctx: CanvasRenderingContext2D,
  sources: (CanvasImageSource | null)[],
  plan: DrawPlan | null,
  scale: number
): boolean {
  const canvas = ctx.canvas
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // Nothing at all while the lowest picture is not ready: the tracks above are
  // drawn over it, never on their own, or they would flash up over black
  // whenever the picture underneath loads.
  if (!plan || (plan.steps.some((s) => s.source === 0) && !sources[0])) return false
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.imageSmoothingQuality = 'high'
  // Nothing outside the frame: an overlay reaching past it is cut off there, as in the export.
  ctx.save()
  ctx.beginPath()
  ctx.rect(plan.frame.x, plan.frame.y, plan.frame.w, plan.frame.h)
  ctx.clip()
  for (const s of plan.steps) {
    const video = sources[s.source]
    const mix = s.mix
    if (mix?.hidden) continue
    // A soft mask or a blur is drawn apart, then laid on: neither is a canvas
    // setting that reaches a single draw.
    const apart = mix !== undefined && (mix.radial !== undefined || (mix.gauss?.sigma ?? 0) > 0 || mix.pixel !== undefined || mix.split !== undefined)
    const c = apart ? kept(ctx.canvas.width, ctx.canvas.height) : ctx
    if (apart) {
      c.setTransform(1, 0, 0, 1, 0, 0)
      c.clearRect(0, 0, c.canvas.width, c.canvas.height)
      c.setTransform(scale, 0, 0, scale, 0, 0)
      c.imageSmoothingQuality = 'high'
    }
    if (mix) {
      c.save()
      if (mix.clip) {
        c.beginPath()
        c.rect(mix.clip.x, mix.clip.y, mix.clip.w, mix.clip.h)
        c.clip()
      }
      if (mix.circle) {
        c.beginPath()
        c.arc(mix.circle.x, mix.circle.y, Math.max(0, mix.circle.r), 0, Math.PI * 2)
        c.clip()
      }
      if (mix.dx || mix.dy) c.translate(mix.dx ?? 0, mix.dy ?? 0)
      if (mix.zoom) {
        c.translate(mix.zoom.x, mix.zoom.y)
        c.scale(mix.zoom.k, mix.zoom.k)
        c.translate(-mix.zoom.x, -mix.zoom.y)
      }
      if (mix.turn) {
        c.translate(mix.turn.x, mix.turn.y)
        c.rotate(mix.turn.a)
        c.translate(-mix.turn.x, -mix.turn.y)
      }
      if (mix.alpha !== undefined && !apart) c.globalAlpha = Math.min(1, Math.max(0, mix.alpha))
    }
    paintStep(c, s, video, scale)
    if (mix) c.restore()
    if (apart && mix) layApart(ctx, c, mix, scale)
  }
  ctx.restore()
  return true
}

/**
 * The blurred parts of a picture, over it as it was drawn (plan 85): each
 * read with a margin round it, so its edge is blurred with what is beside
 * it as the export's is, blurred by the same gaussian scaled to the monitor,
 * and kept to its own box. The look goes with it, so the blur is of the
 * coloured picture, as in the export.
 */
function paintBlurs(ctx: CanvasRenderingContext2D, s: DrawStep, video: CanvasImageSource, scale: number): void {
  const kx = s.to.w / s.from.w
  const ky = s.to.h / s.from.h
  for (const b of s.blurs ?? []) {
    const x0 = Math.max(b.rect.x, s.from.x)
    const y0 = Math.max(b.rect.y, s.from.y)
    const x1 = Math.min(b.rect.x + b.rect.w, s.from.x + s.from.w)
    const y1 = Math.min(b.rect.y + b.rect.h, s.from.y + s.from.h)
    if (x1 <= x0 || y1 <= y0) continue
    const m = 3 * b.sigma
    const read = { x: b.rect.x - m, y: b.rect.y - m, w: b.rect.w + 2 * m, h: b.rect.h + 2 * m }
    ctx.save()
    ctx.beginPath()
    ctx.rect(s.to.x + (x0 - s.from.x) * kx, s.to.y + (y0 - s.from.y) * ky, (x1 - x0) * kx, (y1 - y0) * ky)
    ctx.clip()
    // In device pixels: a filter's blur is not scaled by the transform.
    ctx.filter = `${s.filter ? `${s.filter} ` : ''}blur(${b.sigma * kx * scale}px)`
    ctx.drawImage(video, read.x, read.y, read.w, read.h, s.to.x + (read.x - s.from.x) * kx, s.to.y + (read.y - s.from.y) * ky, read.w * kx, read.h * ky)
    ctx.restore()
  }
}

/** The SVG filters made for colour codes so far, by code: one each, kept for the life of the window. */
const colourFilters = new Set<string>()

/**
 * The canvas filter a clip's colour is drawn with, making its SVG
 * `feColorMatrix` the first time a code is seen (plan 85). In sRGB, so it
 * mixes the same levels the export's `colorchannelmixer` does.
 */
function colourFilter(key: string | undefined): string | undefined {
  const filter = colourCanvas(key)
  const m = key ? matrixOfKey(key) : null
  if (!key || !m || colourFilters.has(key) || typeof document === 'undefined') return filter
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.position = 'absolute'
  const f = document.createElementNS(ns, 'filter')
  f.id = colourFilterId(key)
  f.setAttribute('color-interpolation-filters', 'sRGB')
  const distance = distanceOfKey(key)
  if (distance) {
    // A plain background (plan 98), by the export's steps: each channel's
    // distance from the colour, their average as alpha, the ramp on it, and
    // the coloured picture kept where that alpha is.
    const step = (name: string, attrs: Record<string, string>, kids: Element[] = []): Element => {
      const e = document.createElementNS(ns, name)
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
      for (const kid of kids) e.appendChild(kid)
      return e
    }
    const [cr, cg, cb] = distance.rgb
    const table = (fn: string, c: number): Element => step(fn, { type: 'table', tableValues: distanceTable(c) })
    f.appendChild(step('feComponentTransfer', { in: 'SourceGraphic', result: 'apart' }, [table('feFuncR', cr), table('feFuncG', cg), table('feFuncB', cb)]))
    f.appendChild(step('feColorMatrix', { in: 'apart', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.333333 0.333333 0.333333 0 0', result: 'far' }))
    f.appendChild(
      step('feComponentTransfer', { in: 'far', result: 'kept' }, [
        step('feFuncA', { type: 'linear', slope: String(1 / distance.width), intercept: String(-distance.from / distance.width) })
      ])
    )
    f.appendChild(step('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: feColorMatrixValues(m), result: 'coloured' }))
    f.appendChild(step('feComposite', { in: 'coloured', in2: 'kept', operator: 'in' }))
    svg.appendChild(f)
    document.body.appendChild(svg)
    colourFilters.add(key)
    return filter
  }
  const matrix = document.createElementNS(ns, 'feColorMatrix')
  matrix.setAttribute('type', 'matrix')
  // A background taken out (plan 90) sets alpha from the colours, doubled by
  // a second step where the export doubles it, so both clamp alike.
  const alpha = alphaOfKey(key)
  matrix.setAttribute('values', feColorMatrixValues(m, alpha?.row))
  f.appendChild(matrix)
  if (alpha?.times === 2) {
    const twice = document.createElementNS(ns, 'feColorMatrix')
    twice.setAttribute('type', 'matrix')
    twice.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 2 0')
    f.appendChild(twice)
  }
  svg.appendChild(f)
  document.body.appendChild(svg)
  colourFilters.add(key)
  return filter
}

/** One step's picture, its frame, blurred bars and dip, drawn onto `ctx` as it stands. */
function paintStep(ctx: CanvasRenderingContext2D, s: DrawStep, video: CanvasImageSource | null | undefined, scale: number): void {
  if (s.slide) {
    // Moved and scaled whole, as the export lays the finished box (plan 97).
    const { slide, ...still } = s
    ctx.save()
    ctx.translate(slide.to.x, slide.to.y)
    ctx.scale(slide.sx, slide.sy)
    ctx.translate(-slide.from.x, -slide.from.y)
    paintStep(ctx, still, video, scale)
    ctx.restore()
    return
  }
  // The look on this picture only: the filter is set for the one draw and
  // put back, so it never reaches the pictures drawn after it.
  const turned = s.turn !== undefined || s.alpha !== undefined || s.grow !== undefined
  if (turned) {
    // About the middle of its box, which is the middle of its place, as the export turns it.
    ctx.save()
    if (s.alpha !== undefined) ctx.globalAlpha *= Math.min(1, Math.max(0, s.alpha))
    ctx.translate(s.to.x + s.to.w / 2, s.to.y + s.to.h / 2)
    if (s.turn) ctx.rotate(s.turn)
    if (s.grow !== undefined) ctx.scale(s.grow, s.grow)
    ctx.translate(-(s.to.x + s.to.w / 2), -(s.to.y + s.to.h / 2))
  }
  // A framed or blurred picture fills its whole box, as the export's does:
  // shadow and border under it, then the box, black or blurred, then the picture.
  const boxed = s.box !== undefined
  if (boxed) {
    const b = s.box!
    const f = s.frame
    if (f) {
      const outer = { x: b.x - f.border, y: b.y - f.border, w: b.w + 2 * f.border, h: b.h + 2 * f.border }
      const round = f.radius > 0 ? f.radius + f.border : 0
      if (f.shadow || f.border > 0) {
        ctx.save()
        if (f.shadow) {
          ctx.shadowColor = `rgba(0,0,0,${f.shadow.alpha})`
          // A canvas shadow's blur is twice the deviation `gblur` is given.
          // In device pixels: a canvas shadow is not scaled by the transform.
          ctx.shadowBlur = 2 * f.shadow.sigma * scale
          ctx.shadowOffsetY = f.shadow.dy * scale
        }
        ctx.fillStyle = f.border > 0 ? f.colour : '#000'
        ctx.beginPath()
        ctx.roundRect(outer.x, outer.y, outer.w, outer.h, round)
        ctx.fill()
        ctx.restore()
      }
    }
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(b.x, b.y, b.w, b.h, f?.radius ?? 0)
    ctx.clip()
    ctx.fillStyle = '#000'
    ctx.fillRect(b.x, b.y, b.w, b.h)
    if (video && s.blur !== undefined) {
      // Enlarged to cover the box, centred, and blurred.
      const k = Math.max(b.w / s.from.w, b.h / s.from.h)
      const w = s.from.w * k
      const h = s.from.h * k
      // In device pixels too: a filter's blur is not scaled by the transform.
      ctx.filter = `${s.filter ? `${s.filter} ` : ''}blur(${s.blur * scale}px)`
      ctx.drawImage(video, s.from.x, s.from.y, s.from.w, s.from.h, b.x + (b.w - w) / 2, b.y + (b.h - h) / 2, w, h)
      ctx.filter = 'none'
    }
  }
  if (video && s.filter) {
    ctx.filter = s.filter
    ctx.drawImage(video, s.from.x, s.from.y, s.from.w, s.from.h, s.to.x, s.to.y, s.to.w, s.to.h)
    ctx.filter = 'none'
  } else if (video) ctx.drawImage(video, s.from.x, s.from.y, s.from.w, s.from.h, s.to.x, s.to.y, s.to.w, s.to.h)
  if (video && s.blurs) paintBlurs(ctx, s, video, scale)
  if (boxed) ctx.restore()
  if (turned) ctx.restore()
  if (s.wash && s.wash.alpha > 0 && s.washOver === 'pixels') {
    // Only its own pixels, drawn again as a black or white shape of itself.
    if (video) {
      ctx.save()
      if (turned) {
        ctx.translate(s.to.x + s.to.w / 2, s.to.y + s.to.h / 2)
        if (s.turn) ctx.rotate(s.turn)
        if (s.grow !== undefined) ctx.scale(s.grow, s.grow)
        ctx.translate(-(s.to.x + s.to.w / 2), -(s.to.y + s.to.h / 2))
      }
      ctx.globalAlpha = Math.min(1, s.wash.alpha) * Math.min(1, Math.max(0, s.alpha ?? 1))
      ctx.filter = s.wash.colour === 'white' ? 'brightness(0) invert(1)' : 'brightness(0)'
      ctx.drawImage(video, s.from.x, s.from.y, s.from.w, s.from.h, s.to.x, s.to.y, s.to.w, s.to.h)
      ctx.restore()
    }
  } else if (s.wash && s.wash.alpha > 0) {
    ctx.save()
    ctx.globalAlpha = Math.min(1, s.wash.alpha)
    ctx.fillStyle = s.wash.colour === 'white' ? '#fff' : '#000'
    // Over its whole box, blurred bars and all, as the export fades it; the lowest clip's over the whole frame.
    const over = s.washOver && s.washOver !== 'pixels' ? s.washOver.frame : (s.box ?? s.to)
    if (s.frame && s.frame.radius > 0 && !s.washOver) {
      ctx.beginPath()
      ctx.roundRect(over.x, over.y, over.w, over.h, s.frame.radius)
      ctx.fill()
    } else ctx.fillRect(over.x, over.y, over.w, over.h)
    ctx.restore()
  }
}

/**
 * A canvas of this size, kept for drawing a step apart: one per size, so the
 * monitor and the small previews in a menu do not take turns resizing one.
 */
const spares = new Map<string, CanvasRenderingContext2D>()
function kept(width: number, height: number, use = ''): CanvasRenderingContext2D {
  const key = `${width}x${height}${use}`
  let c = spares.get(key)
  if (!c) {
    // Only a few sizes are ever in use at once; an old one is let go.
    if (spares.size >= 8) spares.delete(spares.keys().next().value!)
    c = document.createElement('canvas').getContext('2d')!
    c.canvas.width = width
    c.canvas.height = height
    spares.set(key, c)
  }
  return c
}

/**
 * A step drawn apart laid onto the monitor: its soft circle cut out of it,
 * or it blurred, then drawn at its alpha. Both in device pixels, as
 * the canvases are.
 */
function layApart(ctx: CanvasRenderingContext2D, c: CanvasRenderingContext2D, mix: Mix, scale: number): void {
  let from: CanvasImageSource = c.canvas
  if (mix.pixel) pixelate(c, mix.pixel, scale, kept)
  if (mix.split) {
    const split = kept(c.canvas.width, c.canvas.height, 'split')
    splitColours(c, mix.split, scale, split)
    from = split.canvas
  }
  if (mix.radial) {
    const r = mix.radial
    c.save()
    c.setTransform(scale, 0, 0, scale, 0, 0)
    c.globalCompositeOperation = 'destination-in'
    const g = c.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.reach)
    // Enough stops that the gradient follows `xfade`'s smoothstep closely.
    for (let i = 0; i <= 32; i++) g.addColorStop(i / 32, `rgba(0,0,0,${Math.min(1, Math.max(0, r.alpha((i / 32) * r.reach)))})`)
    c.fillStyle = g
    c.fillRect(0, 0, c.canvas.width / scale, c.canvas.height / scale)
    c.restore()
  }
  const blur = (mix.gauss?.sigma ?? 0) * scale
  if (blur > 0) {
    // Over itself sharp, so its edges, which a canvas blurs into nothing
    // where `gblur` holds the edge, stay the picture and never fade to black.
    const soft = kept(c.canvas.width, c.canvas.height, 'gauss')
    soft.setTransform(1, 0, 0, 1, 0, 0)
    soft.clearRect(0, 0, soft.canvas.width, soft.canvas.height)
    soft.filter = 'none'
    soft.drawImage(from, 0, 0)
    soft.filter = `blur(${blur}px)`
    soft.drawImage(from, 0, 0)
    soft.filter = 'none'
    from = soft.canvas
  }
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = mix.alpha !== undefined ? Math.min(1, Math.max(0, mix.alpha)) : 1
  ctx.drawImage(from, 0, 0)
  ctx.restore()
}

/**
 * The Output view's frame at `frame`: the pictures, and the caption over them
 * as the export burns it in, but never over black while the pictures load.
 */
export function drawOutput(
  ctx: CanvasRenderingContext2D,
  timeline: Timeline,
  frame: number,
  sources: (CanvasImageSource | null)[],
  plan: DrawPlan | null,
  scale: number
): void {
  if (drawOnto(ctx, sources, plan, scale)) drawCaption(ctx, timeline, frame, plan, scale)
}
