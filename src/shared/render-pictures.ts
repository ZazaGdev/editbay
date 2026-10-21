/**
 * The picture of one clip in an export: how its source is read, its colour,
 * blur and crop at the head of its chain, and the graph that fits each of its
 * pictures in its place, framed, turned and faded.
 */

import {
  framesPattern,
  isAnimated,
  isStill,
  type Clip,
  type PictureStyle,
  type ProjectMedia,
  type Rect,
  type Timeline,
  type ZoomKey,
  type BoxKey
} from './project'
import { freePlaceInPixels, placeInPixels, type Place } from './layout'
import { colourFfmpeg, colourKey, colourKeyOf, isKeyed } from './looks'
import { blurFfmpeg, type BlurBox } from './blur'
import { BT601_TO_709 } from './colour-space'
import { framesToSeconds } from './time'
import { DEFAULT_BORDER_COLOUR, blurSigma, shadowOf } from './picture-style'
import { cropFilters, layerMove, type Clock, type Move } from './render-moves'
import { level } from './render-sound'
import { boxClock, movingBox } from './render-box-moves'

export function mediaOf(timeline: Timeline, clip: { id: string; mediaId: string }): ProjectMedia {
  const media = timeline.media.find((m) => m.id === clip.mediaId)
  if (!media) throw new Error(`clip ${clip.id} points at media that is not in the project`)
  return media
}

/**
 * Each picture's frame rate, with its first frame put at the segment's start.
 * A recording whose frames do not land on the project's frame times, such as
 * 25 fps phone footage in a 30 fps project, otherwise loses a segment's first
 * frame, or starts it a frame late and puts all that follows a frame late
 * too. Every segment starts somewhere a cut or a picture's edge put it, so
 * every one sets it.
 */
export function rate(fps: number): string {
  return `fps=${fps}:start_time=0`
}

/** How a clip's picture is timed, when it plays at a speed of its own (plan 105). */
export interface Timing {
  speed: number
  /** Slowed down, its frames blended into each other rather than repeated. */
  blend: boolean
}

/** A clip's timing, or nothing at 1x, which is almost every clip. */
export function timingOf(c: Pick<Clip, 'speed' | 'plainFrames'>): Timing | undefined {
  const speed = c.speed ?? 1
  return speed === 1 ? undefined : { speed, blend: speed < 1 && c.plainFrames !== true }
}

/**
 * The frame rate at the head of a picture's chain, at its speed: its time
 * divided by the speed first, then the project's frames taken from it, made
 * between two of the recording's by blending them where slow motion asks for
 * that, and by repeating one where it does not. At 1x, `rate` alone.
 */
export function timedRate(fps: number, timing?: Timing, part = 0): string {
  if (!timing) return rate(fps)
  // Read from the whole frame before a head that sits part way into one, as
  // `seekFrom` reads it, and that part taken off its clock, so its first frame
  // is the one the preview shows there (audit 2026-10-19).
  const off = part > 0 ? `-${String(Number((part / fps).toFixed(6)))}/TB` : ''
  const pts = `setpts=(PTS-STARTPTS${off})/${timing.speed}`
  return timing.blend ? `${pts},framerate=fps=${fps}` : `${pts},${rate(fps)}`
}

/**
 * Where a recording is read from for a piece whose first frame is at
 * recording frame `at`: the whole frame at or before it, in seconds, and how
 * far into that frame the piece starts. Read from the exact second of a part
 * frame, ffmpeg's accurate seek threw the frame the head sits in away, and the
 * piece opened a frame on from the preview and from its own sound.
 */
export function seekFrom(at: number, fps: number): { fromSec: string; part: number } {
  const from = Math.max(0, at)
  const whole = Math.floor(from + 1e-6)
  const part = from - whole > 1e-6 ? from - whole : 0
  return { fromSec: framesToSeconds(whole, fps).toFixed(6), part }
}

/** A clip's blur, with its recording's size, which its boxes are placed on (plan 85), and whether its colours are BT.601. */
export interface HeadBlur {
  bt601?: true
  blur?: number
  blurBoxes?: BlurBox[]
  width: number
  height: number
}

/** A clip's blur as its chain needs it, or nothing for a sharp picture. */
export function blurField(timeline: Timeline, c: Clip): { headBlur: HeadBlur } | Record<string, never> {
  const m = mediaOf(timeline, c)
  if (c.blur === undefined && c.blurBoxes === undefined && !m.bt601) return {}
  return { headBlur: { ...(m.bt601 ? { bt601: true as const } : {}), ...(c.blur !== undefined ? { blur: c.blur } : {}), ...(c.blurBoxes ? { blurBoxes: c.blurBoxes } : {}), width: m.width, height: m.height } }
}

/**
 * A recording made by BT.601 turned into BT.709 first, before its look:
 * everything after, and the file written, reads it as BT.709 (audit 2026-10-01).
 * Any other recording is said to be BT.709 on its frames. The input option
 * `AS_BT709` is enough for a file that says nothing of its colours, but one
 * whose header names the primaries and leaves the matrix unspecified is read
 * by the header, its frames come out unknown, and ffmpeg 9 converted them as
 * BT.601: #E02020 came out 205,9,31 (audit 2026-10-19). Only the matrix is
 * said, not the range, which a full-range phone recording says rightly.
 */
export function matrixFilters(b: HeadBlur | undefined, recording: boolean): string[] {
  return b?.bt601 ? [BT601_TO_709] : recording ? [RECORDING_BT709] : []
}

/** A recording's frames said to be BT.709, as the export reads every recording that is not BT.601. */
export const RECORDING_BT709 = 'setparams=colorspace=bt709'

/** The filters that blur a picture at the head of its chain, after its colour; `tag` keeps their labels its own. */
export function blurFilters(b: HeadBlur | undefined, tag: string, keepAlpha = false): string[] {
  return b ? blurFfmpeg(b, b.width, b.height, tag, keepAlpha) : []
}

/** A clip's colour code as an overlay carries it, or nothing for as recorded. */
export function colourField(c: Clip): { look: string } | Record<string, never> {
  const key = colourKey(c)
  return key ? { look: key } : {}
}

/**
 * A clip's colour, as the filters at the head of its chain: before any crop or
 * split, so every picture of the clip has it and it is written once.
 */
export function lookFilters(key: string | undefined, keepAlpha = false, tag = ''): string[] {
  // Made video again here and by BT.709, as a picture's format is: left to
  // ffmpeg, RGB is turned back wherever the graph first needs it, by the older
  // BT.601, and saturated colours came out up to 20 levels off the preview.
  // A background taken out where nothing is under it: flattened over black,
  // as the preview draws it, or dropping alpha would bring the green back.
  const flatten = !keepAlpha && isKeyed(key) ? 'premultiply=inplace=1,' : ''
  return colourFfmpeg(key, TO_RGB, `${flatten}${TO_VIDEO},format=${keepAlpha ? 'yuva420p' : 'yuv420p'}`, tag)
}

/**
 * What a picture needs at the head of its chain, after its look. Laid over
 * another track, its own transparency is kept, so what is under it shows
 * through. Underneath everything, it is flattened over black: dropping the
 * transparency would instead show whatever colour its clear pixels happen to
 * hold, which is often not black at all.
 *
 * Then it is made video, here and by the BT.709 matrix, which is how a player
 * reads HD video back. Left to ffmpeg, the conversion happens wherever the
 * graph first needs it and by the older BT.601 matrix, and a picture's red
 * came out orange next to the same picture in the preview.
 */
export function stillFilters(still: boolean, over: boolean): string[] {
  if (!still) return []
  return over ? ['format=rgba', `${TO_VIDEO},format=yuva420p`] : ['format=rgba', 'premultiply=inplace=1', `${TO_VIDEO},format=yuv420p`]
}

/** RGB to video colours as a player turns them back: BT.709, at video range. */
export const TO_VIDEO = 'scale=out_color_matrix=bt709:out_range=tv'
/** Video colours to RGB by the same matrix, for a step that can only work in RGB. */
export const TO_RGB = 'scale=in_color_matrix=bt709:in_range=tv'

/**
 * How a source is read for a segment: a recording from where the segment
 * needs it, a picture as its one frame looped at the project's rate, which
 * has no time to seek to.
 */
export function inputArgs(m: ProjectMedia, fromSec: string, fps: number): string[] {
  if (isAnimated(m)) return [...(m.once === true ? [] : ['-stream_loop', '-1']), '-framerate', String(m.frameRate), '-i', framesPattern(m)]
  return isStill(m) ? ['-loop', '1', '-framerate', String(fps), '-i', m.playablePath] : ['-ss', fromSec, ...AS_BT709, ...editListArgs(m.playablePath), '-i', m.playablePath]
}

/**
 * An MP4 or MOV read by its edit list the simple way. ffmpeg 9 otherwise
 * throws away the first block of AAC sound after every seek, up to 23 ms, and
 * a cut there came out late with a click (plan 89). Only for those files: any
 * other kind refuses the option and will not open.
 */
export function editListArgs(path: string): string[] {
  return /\.(mp4|m4a|m4v|mov|3gp|3g2)$/i.test(path) ? ['-advanced_editlist', '0'] : []
}

/**
 * A recording read as BT.709, which is what the export takes every picture to
 * be: one made by BT.601 is turned into it by its own filter first. ffmpeg 9
 * converts a picture whose frames say nothing into the matrix the file is
 * written in, as if it were BT.601, which moved an untagged red by 18 levels
 * (plan 89). Said of the input, it is what the frames say from the start.
 */
export const AS_BT709 = ['-colorspace', 'bt709']

/** The same said of a picture the graph makes itself, a black background. */
export const LABELLED_BT709 = 'setparams=colorspace=bt709:range=tv'

/**
 * An animation's frames are read looping from the first, so the frames before
 * the one a segment starts on are dropped: seeking into a looping sequence
 * of pictures is what ffmpeg cannot do, and a trim after it can. Nothing for
 * anything else.
 */
export function animationHead(anim: { start: number; into: number; once?: boolean } | undefined): string {
  // One that plays once is read once, and its last frame held for as long as the piece needs.
  const hold = anim?.once === true ? 'tpad=stop_mode=clone:stop=-1,' : ''
  if (!anim || (anim.start === 0 && anim.into === 0)) return hold
  if (anim.into === 0) return `trim=start_frame=${anim.start},setpts=PTS-STARTPTS,${hold}`
  // Part way into that frame: it shows for what is left of it, and every frame
  // after it comes that much sooner. In a fine time base, since the frames'
  // own is a whole frame and would round the difference away.
  return `trim=start_frame=${anim.start},settb=AVTB,setpts='if(eq(N,0),0,PTS-STARTPTS-${anim.into.toFixed(6)}/TB)',${hold}`
}

/**
 * The video filter chain for one clip.
 *
 * Scale to fit and pad rather than stretch: the crop shape and the output shape
 * can differ when the aspect lock is off, and a stretched face is worse than a
 * black bar.
 *
 * The last frame is held for as long as the segment needs. A file whose sound
 * runs a little past its picture, as AAC's padding makes it, gives a clip that
 * reaches its end one frame more than the video has. Without the hold that
 * segment came out a frame short, and every clip after it in the join was out
 * of step with its sound. The frame bounds on the command end it.
 */
export function videoFilter(
  fps: number,
  crop: Clip['transform']['crop'],
  width: number,
  height: number,
  startHold = 0,
  move?: Move,
  look?: string,
  still = false,
  animStart?: { start: number; into: number; once?: boolean },
  headBlur?: HeadBlur,
  tag = 'v',
  timing?: Timing,
  part = 0
): string {
  return [
    `${animationHead(animStart)}${timedRate(fps, timing, part)}`,
    // Frames cloned onto the front where a transition reaches back past the
    // recording's own first frame: the held frame at the other end.
    ...(startHold > 0 ? [`tpad=start_mode=clone:start=${startHold}`] : []),
    // A picture's format first, so a look works on it with its transparency.
    ...stillFilters(still, false),
    ...matrixFilters(headBlur, !still && animStart === undefined),
    ...lookFilters(look, false, tag),
    ...blurFilters(headBlur, tag),
    // A picture that moves takes the window `zoompan` gives it, in place of
    // the fixed crop a still one gets. Everything after is the same: the
    // result is the crop, whichever made it, and it is fitted and padded.
    ...cropFilters(crop, move, fps, width),
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    'tpad=stop_mode=clone:stop=-1'
  ].join(',')
}


/**
 * A picture cut from its source and fitted in its box, exactly the box's
 * size: with black bars, clear ones for a picture laid over another track,
 * or with the picture itself enlarged to cover the box and blurred behind it.
 * `input` opens the chain and it is left open, for the caller to go on with.
 */
export function boxed(input: string, crop: string, box: Rect, blur: number | null, clear: string, tag: string): string {
  const fit = `scale=${box.w}:${box.h}:force_original_aspect_ratio=decrease:flags=lanczos`
  if (blur === null) return `${input}${crop},${fit},pad=${box.w}:${box.h}:(ow-iw)/2:(oh-ih)/2:color=black${clear}`
  return (
    `${input}${crop},split=2[bf${tag}][bb${tag}];` +
    `[bb${tag}]scale=${box.w}:${box.h}:force_original_aspect_ratio=increase:flags=bilinear,crop=${box.w}:${box.h},gblur=sigma=${blur}[bg${tag}];` +
    `[bf${tag}]${fit}[fg${tag}];[bg${tag}][fg${tag}]overlay=(W-w)/2:(H-h)/2`
  )
}

/**
 * An ffmpeg expression for the alpha of a rounded rectangle at `x`, `y`, `w`
 * by `h` with corners of radius `r`, at `level` inside it and clear outside,
 * a pixel of softening on its edge so the corners are not jagged. In the
 * pixel coordinates `geq` works in.
 */
function roundedAlpha(x: number, y: number, w: number, h: number, r: number, level: number): string {
  const dx = `max(max(${x + r}-X,X-${x + w - 1 - r}),0)`
  const dy = `max(max(${y + r}-Y,Y-${y + h - 1 - r}),0)`
  return `${level}*clip(${r}+1-hypot(${dx},${dy}),0,1)`
}

/** A `geq` that keeps a picture's colour and sets its alpha. */
function withAlpha(alpha: string): string {
  return `format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='${alpha}'`
}

/**
 * A picture in picture's frame, from an open chain of its box: its corners
 * rounded, a border round it, and a shadow under it, as the preview draws
 * them. Returns the statements, the label the framed picture comes out as,
 * and how far up and to the left of its box it reaches, which is where it is
 * laid over. Null for a plain box, which is left as it was.
 */
export function framedBox(
  open: string,
  box: Rect,
  style: PictureStyle | undefined,
  fps: number,
  frame: { w: number; h: number },
  tag: string
): { parts: string[]; label: string; reach: number } | null {
  const r = Math.min(style?.radius ?? 0, Math.floor(Math.min(box.w, box.h) / 2))
  const b = style?.border ?? 0
  if (r === 0 && b === 0 && style?.shadow !== true) return null
  const parts: string[] = []
  parts.push(`${open},setsar=1${r > 0 ? `,${withAlpha(roundedAlpha(0, 0, box.w, box.h, r, 255))}` : ''}[pk${tag}]`)
  let label = `pk${tag}`
  const bw = box.w + 2 * b
  const bh = box.h + 2 * b
  if (b > 0) {
    const colour = (style?.borderColour ?? DEFAULT_BORDER_COLOUR).replace('#', '0x')
    parts.push(
      // Made in RGB and turned into video by BT.709, as a picture's colour is:
      // the colour source's own conversion is BT.601, and red came out 15 levels off.
      `color=c=${colour}:s=${bw}x${bh}:r=${fps},format=rgba,${TO_VIDEO},format=yuva420p` +
        `${r > 0 ? `,${withAlpha(roundedAlpha(0, 0, bw, bh, r + b, 255))}` : ''}[bd${tag}];` +
        `[bd${tag}][${label}]overlay=${b}:${b}[pb${tag}]`
    )
    label = `pb${tag}`
  }
  let reach = b
  if (style?.shadow === true) {
    const s = shadowOf(frame.w, frame.h)
    const m = 3 * s.sigma + s.dy
    parts.push(
      `color=c=black:s=${bw + 2 * m}x${bh + 2 * m}:r=${fps},` +
        `${withAlpha(roundedAlpha(m, m + s.dy, bw, bh, r > 0 ? r + b : 0, Math.round(255 * s.alpha)))},gblur=sigma=${s.sigma}[sd${tag}];` +
        `[sd${tag}][${label}]overlay=${m}:${m}[ps${tag}]`
    )
    label = `ps${tag}`
    reach += m
  }
  return { parts, label, reach }
}

/**
 * The filter graph for a clip with more than one picture, or with its main
 * picture not filling the frame. The frame rate is set once, before the
 * split, so every picture has the same frames. Each picture is cropped, then
 * fitted inside its place and padded to exactly that size, never stretched.
 *
 * The main picture is padded out to the whole frame, black around its place,
 * and the layers are laid over it. Its frames set the timing. A separate black
 * frame to lay everything over would start at the very first timestamp, and
 * when the source's first frame after the cut lands later than that, the
 * segment would open on a black frame and lose its last picture.
 *
 * The main picture holds its last frame for as long as the segment needs, as a
 * plain clip's does, and for the same reason. Each layer holds its last frame
 * too, which is how overlay treats an input that ends first.
 */
export function pictureGraph(
  fps: number,
  clip: Clip,
  width: number,
  height: number,
  last = 'v',
  at: {
    input?: number
    startHold?: number
    tag?: string
    transparent?: boolean
    still?: boolean
    animStart?: { start: number; into: number; once?: boolean }
    /** The main picture's move, when it has one. */
    move?: Move
    /** The clip's blur, at the head of its chain after its colour (plan 85). */
    headBlur?: HeadBlur
    /** The piece's clock, when a further picture has a move of its own on it. */
    clock?: Clock
    /** How far into its first recording frame the piece starts, read from that whole frame: see `seekFrom`. */
    part?: number
    /** A picture laid over another track, placed freely: its turn and opacity. */
    free?: { rotation?: number; opacity?: number }
    /** Lying over another track, so its main picture is framed as a picture in picture too. */
    overOther?: boolean
  } = {}
): string {
  const pictures: { crop: Rect; place: Place; style?: PictureStyle; keys?: ZoomKey[]; boxKeys?: BoxKey[] }[] = [
    {
      crop: clip.transform.crop,
      place: clip.transform.place,
      ...(clip.transform.style ? { style: clip.transform.style } : {}),
      ...(clip.transform.boxKeys ? { boxKeys: clip.transform.boxKeys } : {})
    },
    ...clip.layers
  ]
  // A second copy of this graph in one segment, for a blend, needs labels of
  // its own or the two would write to the same ones.
  const g = at.tag ?? ''
  const branches = pictures.map((_, i) => `[s${g}${i}]`).join('')
  // Transparent outside the places, for a picture that is laid over another
  // track: black there would cover what is underneath it.
  const alpha = at.transparent === true
  const head =
    `[${at.input ?? 0}:v]${animationHead(at.animStart)}${timedRate(fps, timingOf(clip), at.part)}` +
    `${(at.startHold ?? 0) > 0 ? `,tpad=start_mode=clone:start=${at.startHold}` : ''}` +
    stillFilters(at.still === true, alpha).map((f) => `,${f}`).join('') +
    matrixFilters(at.headBlur, at.still !== true && at.animStart === undefined).map((f) => `,${f}`).join('') +
    lookFilters(colourKeyOf(clip), alpha, last).map((f) => `,${f}`).join('') +
    blurFilters(at.headBlur, last, alpha).map((f) => `,${f}`).join('') +
    `${alpha ? ',format=yuva420p' : ''}`
  const parts: string[] = [pictures.length > 1 ? `${head},split=${pictures.length}${branches}` : `${head}${branches}`]
  // Clear around a picture laid over another track, as it is outside a blend.
  // A background taken out keeps its clear pixels too, and is never framed (plan 90).
  const keyed = isKeyed(colourKeyOf(clip))
  const clear = alpha && (at.still === true || keyed) ? '@0' : ''
  // Each picture's frame, where it has one, and how far out of its box it reaches.
  const framedOut = new Map<number, { label: string; reach: number }>()
  // Each further picture whose keyframes move its box, and where they put it (plan 97).
  const boxMoved = new Map<number, { label: string; x: string; y: string }>()
  pictures.forEach((p, i) => {
    // Only a picture laid over reaches past the frame and turns, and only its main one.
    const free = i === 0 && alpha && at.still === true && at.free !== undefined
    const box = free ? freePlaceInPixels(p.place, width, height) : placeInPixels(p.place, width, height)
    const blur = clip.blurFill === true && !free && !keyed ? blurSigma(width, height) : null
    const move = i === 0 ? at.move : layerMove(p.keys, at.clock)
    // A layer's own look (task 1188), on its crop alone, over its clip's.
    const own = i > 0 ? lookFilters(colourKeyOf(clip.layers[i - 1]!), alpha, `${last}l${g}${i}`) : []
    const fitted = boxed(`[s${g}${i}]`, [...cropFilters(p.crop, move, fps, box.w), ...own].join(','), box, blur, clear, `${g}${i}`)
    const frame =
      !keyed && (i > 0 || (at.overOther === true && !free)) ? framedBox(fitted, box, p.style, fps, { w: width, h: height }, `${g}${i}`) : null
    // A box its keyframes move (plan 97): laid over a canvas of the frame, the
    // main one included, where they put it on each frame.
    const boxMove = free ? undefined : boxClock(p.boxKeys, i === 0 ? (at.move ?? at.clock) : at.clock)
    if (boxMove) {
      const reach = frame?.reach ?? 0
      const moving = movingBox(boxMove, box, reach, width, height, fps, { toRgb: TO_RGB, toVideo: TO_VIDEO })
      if (frame) parts.push(...frame.parts)
      const head = frame ? `[${frame.label}]` : `${fitted},setsar=1,`
      const label = `bm${g}${i}`
      parts.push(`${head}${moving.before ? `${moving.before},` : ''}format=yuva420p[${label}]`)
      if (i > 0) {
        boxMoved.set(i, { label, x: moving.x, y: moving.y })
        return
      }
      // The main picture sets the segment's timing: its own frames, made a
      // clear or black canvas of the frame, are what it is laid over.
      const out = pictures.length === 1 ? last : `o${g}0`
      parts.push(
        `[${label}]split[${label}a][${label}b];[${label}b]scale=${width}:${height},format=yuva420p,lutyuv=y=16:u=128:v=128:a=${alpha ? 0 : 255}[${label}c];` +
          `[${label}c][${label}a]overlay=x='${moving.x}':y='${moving.y}',format=${alpha ? 'yuva420p' : 'yuv420p'},setsar=1,tpad=stop_mode=clone:stop=-1[${out}]`
      )
      return
    }
    if (frame && i === 0) {
      // Framed, it reaches out of its box, which a pad cannot place: it is put
      // on a clear canvas that much larger all round, and cut back to the frame.
      const out = pictures.length === 1 ? last : `o${g}0`
      const m = frame.reach
      parts.push(...frame.parts)
      parts.push(
        `[${frame.label}]format=rgba,pad=${width + 2 * m}:${height + 2 * m}:${box.x}:${box.y}:color=black@0,` +
          `crop=${width}:${height}:${m}:${m},setsar=1,tpad=stop_mode=clone:stop=-1[${out}]`
      )
      return
    }
    if (frame) {
      parts.push(...frame.parts)
      framedOut.set(i, frame)
      return
    }
    if (free) {
      // Turned, faded, and placed by its centre on a clear canvas wide enough
      // for any turn of its box to land anywhere it may be put, then cut back
      // to the frame: a pad cannot place a picture partly off its own edge.
      const margin = Math.ceil(Math.hypot(box.w, box.h) / 2) * 2
      const cx = box.x + box.w / 2
      const cy = box.y + box.h / 2
      const out = pictures.length === 1 ? last : `o${g}0`
      parts.push(
        // Turning and fading work in RGB, there and back by the matrix the rest uses.
        `${fitted},setsar=1,${TO_RGB},format=rgba${turnAndFade(at.free!.rotation, at.free!.opacity)},` +
          `pad=${width + 2 * margin}:${height + 2 * margin}:x=${margin}+${cx}-iw/2:y=${margin}+${cy}-ih/2:color=black@0,` +
          `crop=${width}:${height}:${margin}:${margin},${TO_VIDEO},format=yuva420p,tpad=stop_mode=clone:stop=-1[${out}]`
      )
    } else if (i === 0) {
      const out = pictures.length === 1 ? last : `o${g}0`
      parts.push(
        `${fitted},pad=${width}:${height}:${box.x}:${box.y}:color=black${alpha ? '@0' : ''},setsar=1,tpad=stop_mode=clone:stop=-1[${out}]`
      )
    } else {
      parts.push(`${fitted},setsar=1[p${g}${i}]`)
    }
  })
  let under = `o${g}0`
  pictures.forEach((p, i) => {
    if (i === 0) return
    const out0 = i === pictures.length - 1 ? last : `o${g}${i}`
    const moved = boxMoved.get(i)
    if (moved) {
      parts.push(`[${under}][${moved.label}]overlay=x='${moved.x}':y='${moved.y}'[${out0}]`)
      under = out0
      return
    }
    const box = placeInPixels(p.place, width, height)
    const out = i === pictures.length - 1 ? last : `o${g}${i}`
    // A framed picture reaches out of its box by its border and shadow, and is laid over that much further up and left.
    const framed = framedOut.get(i)
    const reach = framed?.reach ?? 0
    parts.push(`[${under}][${framed?.label ?? `p${g}${i}`}]overlay=x=${box.x - reach}:y=${box.y - reach}[${out}]`)
    under = out
  })
  return parts.join(';')
}

/**
 * The filters that turn a picture about its centre and make it see-through,
 * after it is fitted in its box: nothing for one that does neither. The frame
 * grows to hold the turned corners and is clear around them.
 */
export function turnAndFade(rotation: number | undefined, opacity: number | undefined): string {
  const parts: string[] = []
  if (rotation) {
    const a = ((rotation * Math.PI) / 180).toFixed(6)
    parts.push(`rotate=a=${a}:ow=rotw(${a}):oh=roth(${a}):c=none`)
  }
  if (opacity !== undefined && opacity < 1) parts.push(`colorchannelmixer=aa=${level(opacity)}`)
  return parts.map((f) => `,${f}`).join('')
}
