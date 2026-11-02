/**
 * The clips on higher video tracks laid over a segment, a clip blended into
 * the next, and how a text or a picture comes in and goes out.
 */

import { POP_ROOM, appearExpressions, type Appear } from './appear'
import type { BoxKey, Clip, PictureStyle, Rect, ZoomKey } from './project'
import { freePlaceInPixels, placeInPixels, type Place } from './layout'
import { colourKeyOf, isKeyed, type Coloured } from './looks'

/** One picture of an overlay: a crop and a place, and a layer's own look (task 1188). */
type OverlayPicture = { crop: Rect; place: Place; style?: PictureStyle; keys?: ZoomKey[]; boxKeys?: BoxKey[] } & Coloured
import { framesToSeconds } from './time'
import { blurSigma } from './picture-style'
import { cropFilters, layerMove, type Clock, type Move } from './render-moves'
import {
  animationHead,
  blurFilters,
  boxed,
  framedBox,
  lookFilters,
  matrixFilters,
  pictureGraph,
  timedRate,
  type Timing,
  stillFilters,
  turnAndFade,
  TO_RGB,
  TO_VIDEO,
  type HeadBlur
} from './render-pictures'
import type { Wash } from './render-pieces'
import { ZOOM_OUT_FROM, blurAt, rgbSplitAt } from './transitions'
import { boxClock, movingBox } from './render-box-moves'

/** A clip on a higher video track laid over a segment: its file, from where, and its pictures. */
export interface Animation {
  pattern: string
  rate: number
  /** The frame the piece starts on, and how far into it, in seconds. */
  start: number
  into: number
  /** Played once, its last frame held (plan 88), rather than looped. */
  once?: boolean
}

export interface Overlay {
  path: string
  /** Where its own source starts for this segment, as ffmpeg is given it. */
  fromSec: string
  /** How far into the recording frame at `fromSec` the segment starts: see `seekFrom`. */
  part?: number
  /** Frames cloned onto its front, where a transition reaches back past the recording's first frame. */
  hold: number
  pictures: OverlayPicture[]
  /** The bars round its pictures filled with the picture blurred, rather than black. */
  blurFill?: boolean
  /** Its clip's colour, as `colourKey` codes it, on every one of its pictures. */
  look?: string
  /** Its clip's blur, after its colour (plan 85). */
  headBlur?: HeadBlur
  /** A colour laid over its own place across the whole segment. */
  wash?: Wash
  /** A picture, read as a looped frame, and see-through where it is. */
  still?: boolean
  /** An animation: its frames' pattern, their rate, and which the segment starts on. */
  anim?: Animation
  /** A picture's turn in degrees clockwise and its opacity, as its clip keeps them. */
  rotation?: number
  opacity?: number
  /**
   * How a text or a picture comes in and goes out: its clip's length, and how
   * far into the clip this piece starts, in frames. Not while it blends.
   */
  appear?: { lead: number; length: number; enter?: Appear; exit?: Appear }
  /** Its main picture's move, when it has one. */
  move?: Move
  /** The piece's clock, when a further picture has a move of its own on it. */
  clock?: Clock
  /** Its speed, when it plays at one of its own (plan 105). */
  timing?: Timing
  /** The clip it turns into over the whole segment, read as an input of its own. */
  into?: {
    path: string
    still?: boolean
    anim?: Animation
    fromSec: string
    part?: number
    hold: number
    pictures: { crop: Rect; place: Place; keys?: ZoomKey[]; boxKeys?: BoxKey[] }[]
    look?: string
    headBlur?: HeadBlur
    rotation?: number
    opacity?: number
    move?: Move
    clock?: Clock
    timing?: Timing
    xfade: string
    /** The kind it is, for what is laid on the `xfade` (plan 95). */
    kind: string
    /** Where this piece is in the blend. */
    partway: Partway
    /** Which input it is, filled in as the inputs are pushed. */
    input?: number
  }
}

/**
 * Where a piece is in a transition, in seconds: how far into it the piece
 * starts, and how long the whole transition is. A piece is cut wherever
 * anything on any track starts or ends, so something starting on another
 * track in the middle of a transition splits it into two pieces, and each
 * must pick it up where the one before left off, never start it again.
 */
export interface Partway {
  leadSec: number
  durSec: number
}

export function partway(pieceFrom: number, window: { from: number; to: number }, fps: number): Partway {
  return { leadSec: framesToSeconds(Math.max(0, pieceFrom - window.from), fps), durSec: framesToSeconds(window.to - window.from, fps) }
}

/** Seconds as the segment's own length is written: rounded up, to the microsecond. */
function sec6(sec: number): string {
  return (Math.ceil(sec * 1e6) / 1e6).toFixed(6)
}

/**
 * `xfade` from `a` to `b` as it is at this piece of it. From part way in, both
 * sides are given made-up frames in front, to be the part already played, and
 * those are cut off again: `xfade` itself always starts at its inputs' start.
 */
export function xfadePartway(
  a: string,
  b: string,
  out: string,
  transition: string,
  at: Partway,
  tag: string,
  laid: { into?: string; after?: string } = {}
): string {
  const lead = sec6(at.leadSec)
  const run = `xfade=transition=${transition}:duration=${sec6(at.durSec)}:offset=0${laid.after ? `,${laid.after}` : ''}`
  if (at.leadSec <= 0) {
    if (!laid.into) return `[${a}][${b}]${run}[${out}]`
    return `[${b}]${laid.into}[${tag}z];[${a}][${tag}z]${run}[${out}]`
  }
  const pad = `tpad=start_duration=${lead}:start_mode=clone`
  const padInto = laid.into ? `${pad},${laid.into}` : pad
  return `[${a}]${pad}[${tag}p];[${b}]${padInto}[${tag}q];[${tag}p][${tag}q]${run},trim=start=${lead},setpts=PTS-STARTPTS[${out}]`
}

/**
 * What a kind lays on its `xfade` (plan 95), in the export's own filters: one
 * for the picture it turns into before the two are mixed, and one for the mix
 * after. Each counts the window's frames from its first, the part a piece
 * starting part way in has padded on included, so it picks up where it was.
 * By the same numbers the preview draws with. `clear` for a track above
 * another, whose pictures are see-through round them.
 */
export function blendFilters(kind: string, at: Partway, fps: number, width: number, clear: boolean): { into?: string; after?: string } {
  const frames = Math.max(1, Math.round(at.durSec * fps))
  // `eased` from transitions, written for ffmpeg: how far through at frame `n`.
  const q = (n: string): string => `clip(${n}/${frames},0,1)`
  const eased = (n: string): string => `(${q(n)}*${q(n)}*(3-2*${q(n)}))`
  if (kind === 'zoomOut') {
    // The middle part of the next picture spread over the frame: `zoomOutAt`.
    const k = `(1+${ZOOM_OUT_FROM - 1}*(1-${eased('in')}))`
    const edge = (side: 'W' | 'H', sign: '-' | '+'): string => `'${side}/2${sign}${side}/2/${k}'`
    const corners = [
      `x0=${edge('W', '-')}:y0=${edge('H', '-')}`,
      `x1=${edge('W', '+')}:y1=${edge('H', '-')}`,
      `x2=${edge('W', '-')}:y2=${edge('H', '+')}`,
      `x3=${edge('W', '+')}:y3=${edge('H', '+')}`
    ]
    return { into: `perspective=${corners.join(':')}:sense=source:eval=frame` }
  }
  // `spinAt`: one turn clockwise about the middle, nothing where it leaves the frame.
  if (kind === 'spin') return { after: `rotate=a='2*PI*${eased('n')}':fillcolor=${clear ? 'none' : 'black'}` }
  if (kind === 'rgbSplit') {
    // `rgbSplitAt`, set frame by frame: red pulled left, blue right, in RGB by
    // the matrix the rest of the export uses. Each just before its frame is due.
    const steps = Array.from({ length: frames }, (_, i) => {
      const d = rgbSplitAt(i / frames, width)
      return `${(i === 0 ? 0 : (i - 0.5) / fps).toFixed(6)} rgbashift rh ${-d}, rgbashift bh ${d}`
    })
    return {
      after: `${TO_RGB},format=${clear ? 'gbrap' : 'gbrp'},sendcmd=c='${steps.join(';')}',rgbashift,${TO_VIDEO},format=${clear ? 'yuva420p' : 'yuv420p'}`
    }
  }
  if (kind === 'blur') {
    // `blurAt`, set frame by frame on the mix, both ways at once: a gaussian
    // told only its sigma blurs across alone (task 1092).
    const name = `gblur@tblur${clear ? 'o' : 'b'}`
    const steps = Array.from({ length: frames }, (_, i) => {
      const s = blurAt(i / frames, width)
      return `${(i === 0 ? 0 : (i - 0.5) / fps).toFixed(6)} ${name} sigma ${s}, ${name} sigmaV ${s}`
    })
    return { after: `sendcmd=c='${steps.join(';')}',${name}=sigma=0` }
  }
  return {}
}

/**
 * A dip to a colour as it is at this piece of it: its clock moved on to where
 * the piece starts. One going to the colour `late` waits that much of the way
 * before it starts (a flash, plan 95).
 */
export function fadePartway(dir: 'in' | 'out', colour: string, at: Partway, late = 0): string {
  const lead = sec6(at.leadSec)
  const wait = dir === 'out' ? late * at.durSec : 0
  const fade = `fade=t=${dir}:st=${wait > 0 ? sec6(wait) : 0}:d=${sec6(at.durSec - wait)}:color=${colour}`
  return at.leadSec <= 0 ? fade : `setpts=PTS+${lead}/TB,${fade},setpts=PTS-STARTPTS`
}

/**
 * The clips from the higher video tracks laid over the picture underneath, in
 * track order, each its own input from `firstInput` on. Each has its frame
 * rate set with its first frame at the segment's start: without that, a
 * recording whose frames do not land on the project's frame times shows
 * nothing on the first frame, because the overlay leaves what is under it
 * bare until the picture's first frame arrives, and a cutaway crossing a cut
 * would flash what is under it for a frame there. Each picture is cropped,
 * fitted in its place with black around it, never stretched, and holds its
 * last frame for as long as the segment needs. A clip with several pictures
 * is split once, after its frame rate is set, so they all have its frames.
 */
export function overlayGraph(
  fps: number,
  under: string,
  overlays: Overlay[],
  firstInput: number,
  width: number,
  height: number,
  last = 'v',
  pieceFrom = 0
): string {
  const parts: string[] = []
  // A clip being blended into another is laid over in one step, whatever its
  // pictures: the two sides are composed on their own first.
  const total = overlays.reduce((n, o) => n + (o.into ? 1 : o.pictures.length), 0)
  let below = under
  let q = 0
  let input = firstInput
  for (const o of overlays) {
    const at = input
    // A blended overlay reads its other side as the input after its own.
    input += o.into ? 2 : 1
    if (o.into) {
      const out = q === total - 1 ? last : `u${q}`
      // Each side composed onto a whole frame that is see-through outside its
      // own places, crossfaded there, and the result laid over at the corner.
      // Transparent because everything outside the two pictures belongs to the
      // track underneath, which a black frame would cover.
      parts.push(
        pictureGraph(fps, asClip(o), width, height, `xo${q}a`, {
          input: at,
          startHold: o.hold,
          ...(o.part ? { part: o.part } : {}),
          tag: `oa${q}`,
          ...(o.headBlur ? { headBlur: o.headBlur } : {}),
          transparent: true,
          overOther: true,
          still: o.still === true,
          ...(o.anim ? { animStart: o.anim } : {}),
          ...(o.move ? { move: o.move } : {}),
          ...(o.clock ? { clock: o.clock } : {}),
          ...(o.still ? { free: { ...(o.rotation ? { rotation: o.rotation } : {}), ...(o.opacity !== undefined ? { opacity: o.opacity } : {}) } } : {})
        })
      )
      parts.push(
        pictureGraph(fps, asClip(o.into), width, height, `xo${q}b`, {
          input: o.into.input ?? at + 1,
          startHold: o.into.hold,
          ...(o.into.part ? { part: o.into.part } : {}),
          tag: `ob${q}`,
          ...(o.into.headBlur ? { headBlur: o.into.headBlur } : {}),
          transparent: true,
          overOther: true,
          still: o.into.still === true,
          ...(o.into.anim ? { animStart: o.into.anim } : {}),
          ...(o.into.move ? { move: o.into.move } : {}),
          ...(o.into.clock ? { clock: o.into.clock } : {}),
          ...(o.into.still
            ? { free: { ...(o.into.rotation ? { rotation: o.into.rotation } : {}), ...(o.into.opacity !== undefined ? { opacity: o.into.opacity } : {}) } }
            : {})
        })
      )
      parts.push(
        `[xo${q}a]format=yuva420p[xo${q}a1];[xo${q}b]format=yuva420p[xo${q}b1];` +
          xfadePartway(`xo${q}a1`, `xo${q}b1`, `xo${q}`, o.into.xfade, o.into.partway, `xo${q}`, blendFilters(o.into.kind, o.into.partway, fps, width, true))
      )
      parts.push(`[${below}][xo${q}]overlay=x=0:y=0[${out}]`)
      below = out
      q += 1
      continue
    }
    // A recording with its background taken out keeps its transparency, as a picture does (plan 90).
    const clearPixels = o.still === true || isKeyed(o.look)
    const head =
      `[${at}:v]${animationHead(o.anim)}${timedRate(fps, o.timing, o.part)}${o.hold > 0 ? `,tpad=start_mode=clone:start=${o.hold}` : ''}` +
      stillFilters(o.still === true, true).map((f) => `,${f}`).join('') +
      matrixFilters(o.headBlur, o.still !== true && o.anim === undefined).map((f) => `,${f}`).join('') +
      lookFilters(o.look, clearPixels, `xo${q}`).map((f) => `,${f}`).join('') +
      blurFilters(o.headBlur, `xo${q}`, clearPixels).map((f) => `,${f}`).join('')
    const heads = o.pictures.length === 1 ? [`${head},`] : o.pictures.map((_, j) => `[i${q}_${j}]`)
    if (o.pictures.length > 1) parts.push(`${head},split=${o.pictures.length}${heads.join('')}`)
    o.pictures.forEach((p, j) => {
      // A picture's own box may reach past the frame: what is outside is not drawn.
      const free = o.still === true && j === 0
      const box = free ? freePlaceInPixels(p.place, width, height) : placeInPixels(p.place, width, height)
      const out = q === total - 1 ? last : `u${q}`
      // A dip to a colour on a clip laid over goes over its own place and no
      // further: what is under it is a different track and is not dipping.
      const wash = o.wash ? `,${fadePartway(o.wash.dir, o.wash.colour, partway(pieceFrom, o.wash, fps), o.wash.late)}` : ''
      // Clear around a picture rather than black: a meme whose box is not
      // quite its shape must not cover the footage with bars. A recording's
      // bars can be the picture blurred instead, and its box can be framed.
      const blur = o.blurFill === true && !clearPixels ? blurSigma(width, height) : null
      const fitted =
        boxed(heads[j]!, cropFilters(p.crop, j === 0 ? o.move : layerMove(p.keys, o.clock), fps, box.w).join(','), box, blur, clearPixels ? '@0' : '', `o${q}`) + wash
      // Neither an image nor a background taken out is framed: the box would cover what shows through.
      const frame = clearPixels ? null : framedBox(fitted, box, p.style, fps, { w: width, h: height }, `o${q}`)
      // A box its keyframes move (plan 97), on the piece's clock.
      const boxMove = free ? undefined : boxClock(p.boxKeys, o.clock ?? o.move)
      const moving = boxMove ? movingBox(boxMove, box, frame?.reach ?? 0, width, height, fps, { toRgb: TO_RGB, toVideo: TO_VIDEO }) : null
      const then = moving?.before ? `,${moving.before}` : ''
      if (frame) {
        parts.push(...frame.parts)
        parts.push(`[${frame.label}]${moving?.before ? `${moving.before},` : ''}tpad=stop_mode=clone:stop=-1[q${q}]`)
        const placed = moving ? `x='${moving.x}':y='${moving.y}'` : `x=${box.x - frame.reach}:y=${box.y - frame.reach}`
        parts.push(`[${below}][q${q}]overlay=${placed}[${out}]`)
        below = out
        q += 1
        return
      }
      if (moving) {
        parts.push(`${fitted},setsar=1${then},tpad=stop_mode=clone:stop=-1[q${q}]`)
        parts.push(`[${below}][q${q}]overlay=x='${moving.x}':y='${moving.y}'[${out}]`)
        below = out
        q += 1
        return
      }
      const shown = free && o.appear ? appearFilters(o.appear, fps, box, o.rotation) : ''
      parts.push(`${fitted},setsar=1` + (free ? turnAndFade(o.rotation, o.opacity) : '') + shown + `,tpad=stop_mode=clone:stop=-1[q${q}]`)
      // Turned, or with room to pop in, its frame grows, so it is placed by its centre.
      const at =
        free && (o.rotation || shown.includes('pad='))
          ? `x=${box.x + box.w / 2}-w/2:y=${box.y + box.h / 2}-h/2`
          : `x=${box.x}:y=${box.y}`
      parts.push(`[${below}][q${q}]overlay=${at}[${out}]`)
      below = out
      q += 1
    })
  }
  return parts.join(';')
}

/**
 * The filters that bring a text or a picture in and take it out, after it is
 * turned: its clock moved to the clip's own, so a piece starting part way
 * through picks the animation up there, then a pop's size, worked out on
 * every frame, in a clear frame of a fixed size with room for its overshoot,
 * and the fades on its alpha. The sums are `appearAt`'s, which the preview draws.
 */
function appearFilters(
  a: { lead: number; length: number; enter?: Appear; exit?: Appear },
  fps: number,
  box: { w: number; h: number },
  rotation: number | undefined
): string {
  const { scale, fades } = appearExpressions(a.length, fps, a.enter, a.exit)
  if (!scale && fades.length === 0) return ''
  const parts = [`setpts=PTS+${sec6(framesToSeconds(a.lead, fps))}/TB`, 'format=rgba']
  if (scale) {
    // The turned frame's size, as `rotate` makes it, and room around it for the overshoot.
    const turn = ((rotation ?? 0) * Math.PI) / 180
    const w = box.w * Math.abs(Math.cos(turn)) + box.h * Math.abs(Math.sin(turn))
    const h = box.w * Math.abs(Math.sin(turn)) + box.h * Math.abs(Math.cos(turn))
    const room = (x: number): number => Math.ceil((x * POP_ROOM) / 2) * 2 + 2
    parts.push(`scale=w='max(2,trunc(iw*${scale}/2)*2)':h='max(2,trunc(ih*${scale}/2)*2)':eval=frame`)
    parts.push(`pad=w=${room(w)}:h=${room(h)}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame`)
  }
  parts.push(...fades, 'setpts=PTS-STARTPTS')
  return parts.map((f) => `,${f}`).join('')
}

/** An overlay's pictures as `pictureGraph` wants them: a clip is only its pictures to it. */
function asClip(o: { pictures: OverlayPicture[]; look?: string; blurFill?: boolean; timing?: Timing }): Clip {
  const [main, ...layers] = o.pictures
  return {
    id: '',
    mediaId: '',
    sourceIn: 0,
    sourceOut: 0,
    timelineStart: 0,
    // Its speed, which the head of its chain is timed by (plan 105).
    ...(o.timing ? { speed: o.timing.speed, ...(o.timing.blend ? {} : { plainFrames: true as const }) } : {}),
    transform: {
      mode: 'crop',
      crop: main!.crop,
      place: main!.place,
      ...(main!.style ? { style: main!.style } : {}),
      ...(main!.boxKeys ? { boxKeys: main!.boxKeys } : {})
    },
    layers: layers.map((p, i) => ({
      id: String(i),
      crop: p.crop,
      place: p.place,
      ...(p.style ? { style: p.style } : {}),
      ...(p.keys ? { keys: p.keys } : {}),
      ...(p.boxKeys ? { boxKeys: p.boxKeys } : {}),
      // Its own look, carried as its code (task 1188).
      ...(colourKeyOf(p) ? { look: colourKeyOf(p)! } : {})
    })),
    layout: 'custom',
    ...(o.look ? { look: o.look } : {}),
    // Its frame and blurred bars go through a blend with it, as the preview draws them.
    ...(o.blurFill === true ? { blurFill: true } : {})
  }
}
