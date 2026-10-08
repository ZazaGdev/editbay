/**
 * Stills, animations and what the app draws itself: texts, shapes and colours,
 * added to a timeline and changed, and an overlay's turn, opacity and how it
 * appears.
 */

import { presetById } from './presets'
import { largestRectOfAspect } from './crop-geometry'
import { hasRoom, MAX_VIDEO_TRACKS, spanEnd } from './tracks'
import { type Place, tidyFreePlace, FULL_PLACE, tidyAngle, fitInPlace, tidyPlace, placeFromPixels } from './layout'
import { type TextStyle, cleanTextStyle, textMargin } from './text'
import { type Appear, cleanAppear } from './appear'
import { type ShapeStyle, cleanShapeStyle } from './shape'
import { evenDown, clamp } from './project-core'
import type { ProjectMedia, Project, Clip, VideoTrack, Timeline, Rect } from './project'
import { sourceFrames } from './project-media'
import { editSequence, targetAspect } from './sequences'
import { updateVideoClip } from './timeline-query'
import { placeSource } from './place-source'
import { addTrack } from './track-edits'
import { hasFrame } from './framing-layouts'

/**
 * How long a picture is taken to be, in seconds. A still has no length, but
 * every trim, drag and split is measured against its source's, so it is given
 * one long enough never to be met, and lands in the middle of it: three hours
 * either way before a limit is reached.
 */
export const STILL_SEC = 6 * 60 * 60

/** How long a picture is when it lands, in seconds: Premiere's default. */
export const STILL_LANDS_SEC = 5

/** Whether a source is a picture rather than a recording. */
export function isStill(m: Pick<ProjectMedia, 'still'>): boolean {
  return m.still === true
}

/** Whether a source is a picture that moves: frames of its own, looping. */
export function isAnimated(m: Pick<ProjectMedia, 'frames' | 'frameRate'>): boolean {
  return (m.frames ?? 0) > 1 && (m.frameRate ?? 0) > 0
}

/** An animation's frame files as ffmpeg reads them in order: its playable file, numbered. */
export function framesPattern(m: Pick<ProjectMedia, 'playablePath'>): string {
  return m.playablePath.replace(/0001\.png$/, '%04d.png')
}

/** One of an animation's frame files, counted from 0. */
export function framePath(m: Pick<ProjectMedia, 'playablePath'>, index: number): string {
  return m.playablePath.replace(/0001\.png$/, `${String(index + 1).padStart(4, '0')}.png`)
}

/**
 * Which of an animation's frames shows at a point of its source, counted
 * from 0: the one its time since the frame it lands on gives, looping. The
 * preview and the export both ask this, so they show the same frame. It is
 * measured from where it lands, so it starts on its first frame there, and
 * trimming its head moves the loop, as it would footage.
 */
export function animationFrame(m: ProjectMedia, sourceFrame: number, fps: number): number {
  return animationAt(m, sourceFrame, fps).frame
}

/**
 * The same, and how far into that frame of the animation the moment is, in
 * seconds: an export piece can start part way through one of a slow GIF's
 * frames, and has to show it for only what is left of it.
 */
export function animationAt(m: ProjectMedia, sourceFrame: number, fps: number): { frame: number; into: number } {
  const n = m.frames ?? 1
  if (!isAnimated(m) || !(fps > 0)) return { frame: 0, into: 0 }
  const from = stillSpan(m, fps).from
  const exact = ((sourceFrame - from) / fps) * m.frameRate!
  const at = Math.floor(exact + 1e-6)
  const into = Math.max(0, exact - at) / m.frameRate!
  // One that plays once holds its last frame from there on.
  if (m.once === true && at >= n - 1) return { frame: n - 1, into: 0 }
  return { frame: ((at % n) + n) % n, into: into < 1e-6 ? 0 : into }
}

/** Whether a source is words drawn over the video. */
export function isText(m: Pick<ProjectMedia, 'text'>): boolean {
  return m.text !== undefined
}

/** A text's picture, as the window drew it: the file, and its size in output pixels. */
export interface DrawnText {
  path: string
  width: number
  height: number
  /** Plan 88: a run of pictures, played once, `path` the first: how many, and how many a second. */
  frames?: number
  frameRate?: number
}

/** A text as a source: a picture with no file of its own and no length. */
function textMedia(id: string, style: TextStyle, drawn: DrawnText): ProjectMedia {
  return {
    id,
    originalPath: '',
    playablePath: drawn.path,
    conformed: false,
    conformReasons: [],
    durationSec: STILL_SEC,
    width: Math.max(2, Math.round(drawn.width)),
    height: Math.max(2, Math.round(drawn.height)),
    fps: 0,
    codec: 'text',
    hasAudio: false,
    peaksPath: '',
    filmstripPath: '',
    still: true,
    text: cleanTextStyle(style)
  }
}

/**
 * Put a new text on a sequence: a source of its own, and a clip of it at
 * `at`, on the lowest track above V1 with room for its five seconds, or a new
 * one at the top. Over the footage is where words go. Nothing happens when
 * the id is taken, or there is no room for another track.
 */
export function addTextTo(
  p: Project,
  sequenceId: string,
  add: { mediaId: string; clipId: string; at: number; style: TextStyle; drawn: DrawnText }
): Project {
  if (p.media.some((m) => m.id === add.mediaId)) return p
  // Under a shape with no frame, as Handoff, only V1 is drawn: a text above it would never show.
  const shape = p.sequences.find((s) => s.id === sequenceId)
  if (!shape || presetById(shape.presetId).width === null) return p
  const next: Project = { ...p, media: [...p.media, textMedia(add.mediaId, add.style, add.drawn)] }
  let landed = false
  const placed = editSequence(next, sequenceId, (t) => {
    const at = Math.max(0, Math.round(add.at))
    const length = Math.max(1, Math.round(STILL_LANDS_SEC * t.fps))
    let index = t.videoTracks.findIndex((r, i) => i > 0 && !r.locked && hasRoom(r.clips, at, length))
    let timeline = t
    if (index < 0) {
      if (t.videoTracks.length >= MAX_VIDEO_TRACKS) return t
      timeline = addTrack(t, 'video', `${add.clipId}.v`)
      index = timeline.videoTracks.length - 1
    }
    const done = placeSource(timeline, { mediaId: add.mediaId, clipId: add.clipId, at, onTrack: timeline.videoTracks[index]!.id })
    landed = done.refused === null
    return done.refused ? t : done.timeline
  })
  // Refused, the source goes too: a text is only ever there for its clip.
  return landed ? placed : p
}

/** Whether a source is a shape drawn over the video. */
export function isShape(m: Pick<ProjectMedia, 'shape'>): boolean {
  return m.shape !== undefined
}

/**
 * Whether the window draws a source's picture from what it is, a text or a
 * shape: each clip has its own, it lands at the size it was drawn, it has
 * nothing to crop or zoom, and a copy of its clip is a new source.
 */
export function isDrawn(m: Pick<ProjectMedia, 'text' | 'shape'>): boolean {
  return m.text !== undefined || m.shape !== undefined
}

/** A shape as a source: a picture with no file of its own and no length. */
function shapeMedia(id: string, style: ShapeStyle, drawn: DrawnText): ProjectMedia {
  return {
    id,
    originalPath: '',
    playablePath: drawn.path,
    conformed: false,
    conformReasons: [],
    durationSec: STILL_SEC,
    width: Math.max(2, Math.round(drawn.width)),
    height: Math.max(2, Math.round(drawn.height)),
    fps: 0,
    codec: 'shape',
    hasAudio: false,
    peaksPath: '',
    filmstripPath: '',
    still: true,
    shape: cleanShapeStyle(style),
    // Drawing itself on: a run of pictures, played once from where it lands (plan 88).
    ...(drawn.frames !== undefined && drawn.frames > 1 && drawn.frameRate !== undefined && drawn.frameRate > 0
      ? { frames: drawn.frames, frameRate: drawn.frameRate, once: true }
      : {})
  }
}

/**
 * Put a new shape on a sequence where it was drawn: a source of its own, and
 * a clip of it at `at` in its place on the frame, on the lowest track above
 * V1 with room for its five seconds, or a new one at the top. Nothing happens
 * when the id is taken, or there is no room for another track.
 */
export function addShapeTo(
  p: Project,
  sequenceId: string,
  add: { mediaId: string; clipId: string; at: number; style: ShapeStyle; drawn: DrawnText; place: Place }
): Project {
  if (p.media.some((m) => m.id === add.mediaId)) return p
  const shape = p.sequences.find((s) => s.id === sequenceId)
  if (!shape || presetById(shape.presetId).width === null) return p
  const m = shapeMedia(add.mediaId, add.style, add.drawn)
  const next: Project = { ...p, media: [...p.media, m] }
  let landed = false
  const placed = editSequence(next, sequenceId, (t) => {
    const at = Math.max(0, Math.round(add.at))
    const length = Math.max(1, Math.round(STILL_LANDS_SEC * t.fps))
    let index = t.videoTracks.findIndex((r, i) => i > 0 && !r.locked && hasRoom(r.clips, at, length))
    let timeline = t
    if (index < 0) {
      if (t.videoTracks.length >= MAX_VIDEO_TRACKS) return t
      timeline = addTrack(t, 'video', `${add.clipId}.v`)
      index = timeline.videoTracks.length - 1
    }
    const done = placeSource(timeline, { mediaId: add.mediaId, clipId: add.clipId, at, onTrack: timeline.videoTracks[index]!.id })
    landed = done.refused === null
    if (done.refused) return t
    const { width: W, height: H } = t.output
    const crop = { x: 0, y: 0, w: evenDown(m.width), h: evenDown(m.height) }
    return updateVideoClip(done.timeline, add.clipId, (c) => ({ ...c, transform: { ...c.transform, crop, place: tidyFreePlace(add.place, W, H) } }))
  })
  // Refused, the source goes too: a shape is only ever there for its clip.
  return landed ? placed : p
}

/**
 * Change a shape, with the picture drawn from it. Every clip of it takes the
 * new picture about the middle of where it was, so a wider outline grows it
 * evenly; or, for the clip named in `placed`, exactly where that says, as
 * when an end of an arrow is dragged.
 */
export function setShapeOn(p: Project, mediaId: string, style: ShapeStyle, drawn: DrawnText, placed?: { clipId: string; place: Place }): Project {
  const old = p.media.find((m) => m.id === mediaId)
  if (!old || !isShape(old)) return p
  const m = { ...shapeMedia(mediaId, style, drawn), ...(old.addedAt !== undefined ? { addedAt: old.addedAt } : {}) }
  const crop = { x: 0, y: 0, w: evenDown(m.width), h: evenDown(m.height) }
  const sequences = p.sequences.map((s) => {
    const { width: W, height: H } = s.output
    const framed = presetById(s.presetId).width !== null
    const reframe = (c: Clip): Clip => {
      if (c.mediaId !== mediaId) return c
      if (!framed) return { ...c, transform: { ...c.transform, crop, place: FULL_PLACE } }
      if (placed && placed.clipId === c.id) return { ...c, transform: { ...c.transform, crop, place: tidyFreePlace(placed.place, W, H) } }
      const at = c.transform.place
      const w = m.width / W
      const h = m.height / H
      return { ...c, transform: { ...c.transform, crop, place: tidyFreePlace({ x: at.x + at.w / 2 - w / 2, y: at.y + at.h / 2 - h / 2, w, h }, W, H) } }
    }
    return { ...s, videoTracks: s.videoTracks.map((r) => ({ ...r, clips: r.clips.map(reframe) })) }
  })
  return { ...p, media: p.media.map((x) => (x.id === mediaId ? m : x)), sequences }
}

/** Whether a source is one plain colour, as a black screen is. */
export function isColour(m: Pick<ProjectMedia, 'colour'>): boolean {
  return m.colour !== undefined
}

/** A colour as `#rrggbb`, or null for anything that is not one. */
export function cleanColour(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null
}

/** A black screen's colour, which it starts as. */
export const BLACK_SCREEN = '#000000'

/** How long a black screen lands for, in seconds: long enough to read a line over it. */
export const COLOUR_LANDS_SEC = 3

/** A plain colour as a source: a still of the sequence's size, with no file of its own. */
function colourMedia(id: string, colour: string, drawn: DrawnText): ProjectMedia {
  return {
    id,
    originalPath: '',
    playablePath: drawn.path,
    conformed: false,
    conformReasons: [],
    durationSec: STILL_SEC,
    width: Math.max(2, Math.round(drawn.width)),
    height: Math.max(2, Math.round(drawn.height)),
    fps: 0,
    codec: 'colour',
    hasAudio: false,
    peaksPath: '',
    filmstripPath: '',
    still: true,
    colour
  }
}

/**
 * Put a plain colour on a sequence, a source of its own and a clip of it:
 * on `trackId` at `at` when one is given, as a gap filled from its menu;
 * otherwise on V1 at `at` when there is room there, straight after V1's last
 * clip when `at` is at or past it, and on the lowest track above V1 with room
 * when V1 is taken there, or a new one at the top. `length` frames long, or
 * `COLOUR_LANDS_SEC`. Nothing happens when there is no room, or the id is taken.
 */
export function addColourTo(
  p: Project,
  sequenceId: string,
  add: { mediaId: string; clipId: string; at: number; colour: string; drawn: DrawnText; length?: number; trackId?: string }
): Project {
  const colour = cleanColour(add.colour)
  if (!colour || p.media.some((m) => m.id === add.mediaId)) return p
  const next: Project = { ...p, media: [...p.media, colourMedia(add.mediaId, colour, add.drawn)] }
  let landed = false
  const placed = editSequence(next, sequenceId, (t) => {
    const length = Math.max(1, Math.round(add.length ?? COLOUR_LANDS_SEC * t.fps))
    let at = Math.max(0, Math.round(add.at))
    let timeline = t
    let onTrack: string | undefined
    if (add.trackId !== undefined) {
      const track = [...t.videoTracks, ...t.audioTracks].find((r) => r.id === add.trackId)
      if (!track || !t.videoTracks.includes(track as VideoTrack) || track.locked || !hasRoom(track.clips, at, length)) return t
      onTrack = track.id
    } else {
      const v1 = t.videoTracks[0]!
      const end = v1.clips.reduce((e, c) => Math.max(e, spanEnd(c)), 0)
      if (at >= end && v1.clips.length > 0) at = end
      // Never on a locked track, which nothing is put on (audit 2026-10-01).
      if (!v1.locked && hasRoom(v1.clips, at, length)) onTrack = v1.id
      else {
        const index = t.videoTracks.findIndex((r, i) => i > 0 && !r.locked && hasRoom(r.clips, at, length))
        if (index > 0) onTrack = t.videoTracks[index]!.id
        else {
          if (t.videoTracks.length >= MAX_VIDEO_TRACKS) return t
          timeline = addTrack(t, 'video', `${add.clipId}.v`)
          onTrack = timeline.videoTracks[timeline.videoTracks.length - 1]!.id
        }
      }
    }
    const done = placeSource(timeline, { mediaId: add.mediaId, clipId: add.clipId, at, onTrack, length })
    landed = done.refused === null
    return done.refused ? t : done.timeline
  })
  // Refused, the source goes too: a colour is only ever there for its clip.
  return landed ? placed : p
}

/** Change a plain colour, with the picture drawn from it: every clip of it shows the new one. */
export function setColourOn(p: Project, mediaId: string, colour: string, drawn: DrawnText): Project {
  const old = p.media.find((m) => m.id === mediaId)
  const clean = cleanColour(colour)
  if (!old || !isColour(old) || !clean) return p
  const m = { ...colourMedia(mediaId, clean, drawn), ...(old.addedAt !== undefined ? { addedAt: old.addedAt } : {}) }
  return { ...p, media: p.media.map((x) => (x.id === mediaId ? m : x)) }
}

/**
 * Change a text's words or style, with the picture drawn from them. Every
 * clip of it takes the new picture whole, at the size it was drawn, about the
 * middle of where it was, so a text grows from its centre as it is typed.
 */
export function setTextOn(p: Project, mediaId: string, style: TextStyle, drawn: DrawnText): Project {
  const old = p.media.find((m) => m.id === mediaId)
  if (!old || !isText(old)) return p
  const m = { ...textMedia(mediaId, style, drawn), ...(old.addedAt !== undefined ? { addedAt: old.addedAt } : {}) }
  const crop = { x: 0, y: 0, w: evenDown(m.width), h: evenDown(m.height) }
  const sequences = p.sequences.map((s) => {
    const { width: W, height: H } = s.output
    const framed = presetById(s.presetId).width !== null
    const reframe = (c: Clip): Clip => {
      if (c.mediaId !== mediaId) return c
      const at = c.transform.place
      const w = m.width / W
      // Its align decides which side stays put as it grows or shrinks: a left
      // aligned text keeps its left edge, so typing more grows it rightwards,
      // a right aligned one its right edge, a centred one its middle.
      // It is the letters that stay put, not the picture's edge: a glow or a
      // shadow turned on widens the room round them, which goes outwards (plan 99).
      const grew = (textMargin(style) - (old.text ? textMargin(old.text) : textMargin(style))) / W
      const x = style.align === 'left' ? at.x - grew : style.align === 'right' ? at.x + at.w - w + grew : at.x + at.w / 2 - w / 2
      const place = framed
        ? tidyFreePlace({ x, y: at.y + at.h / 2 - m.height / H / 2, w, h: m.height / H }, W, H)
        : FULL_PLACE
      return { ...c, transform: { ...c.transform, crop, place } }
    }
    return { ...s, videoTracks: s.videoTracks.map((r) => ({ ...r, clips: r.clips.map(reframe) })) }
  })
  return { ...p, media: p.media.map((x) => (x.id === mediaId ? m : x)), sequences }
}

/**
 * Whether a source is an overlay: something laid over the footage that can
 * go partly off the frame, be turned and be made see-through. A picture, and
 * everything that is a picture underneath.
 */
export function isOverlay(m: Pick<ProjectMedia, 'still'>): boolean {
  return isStill(m)
}

/** An overlay's turn and opacity as they are kept: tidied, and absent when they do nothing. */
export function cleanOverlay(o: { rotation?: unknown; opacity?: unknown }): { rotation?: number; opacity?: number } {
  const rotation = typeof o.rotation === 'number' ? tidyAngle(o.rotation) : 0
  const opacity = typeof o.opacity === 'number' && Number.isFinite(o.opacity) ? clamp(o.opacity, 0, 1) : 1
  return { ...(rotation !== 0 ? { rotation } : {}), ...(opacity < 1 ? { opacity } : {}) }
}

/**
 * Turn an overlay, or change how see-through it is. Either left out stays as
 * it is. Nothing happens to a clip that is not an overlay, or under a shape
 * with no frame to lay anything over.
 */
export function setOverlay(p: Timeline, clipId: string, change: { rotation?: number; opacity?: number }): Timeline {
  if (!hasFrame(p)) return p
  return updateVideoClip(p, clipId, (c, m) => {
    if (!isOverlay(m)) return c
    const { rotation: _r, opacity: _o, ...rest } = c.transform
    const next = cleanOverlay({
      rotation: change.rotation ?? c.transform.rotation,
      opacity: change.opacity ?? c.transform.opacity
    })
    return { ...c, transform: { ...rest, ...next } }
  })
}

/**
 * How a text or a picture comes in (`side` 'in') or goes out ('out'): a fade
 * or a pop and its length in frames, or null for straight in or out. Only
 * for an overlay, and only under a shape with a frame to draw it in.
 */
export function setAppear(p: Timeline, clipId: string, side: 'in' | 'out', appear: Appear | null): Timeline {
  if (!hasFrame(p)) return p
  return updateVideoClip(p, clipId, (c, m) => {
    if (!isOverlay(m)) return c
    const { enter, exit, ...rest } = c
    const kept = appear === null ? undefined : cleanAppear(appear)
    const next = side === 'in' ? { enter: kept, exit } : { enter, exit: kept }
    return { ...rest, ...(next.enter ? { enter: next.enter } : {}), ...(next.exit ? { exit: next.exit } : {}) }
  })
}

/**
 * Where a picture lands in its nominal length, and how much of it: five
 * seconds from the middle, so it can be stretched either way.
 */
export function stillSpan(m: ProjectMedia, fps: number): { from: number; to: number } {
  const length = sourceFrames(m, fps)
  const from = Math.floor(length / 2)
  return { from, to: Math.min(length, from + Math.max(1, Math.round(STILL_LANDS_SEC * fps))) }
}

/**
 * Where a picture's place starts: the whole of it, as large as fits in the
 * frame and centred, the shape of the picture. That is the box it is moved
 * and resized by, so it is its own shape rather than the frame's.
 */
export function stillPlace(p: Timeline, crop: Rect, m?: ProjectMedia): Place {
  const { width: W, height: H } = p.output
  // A text is drawn at the size it shows, so it lands at that size, fitted
  // only when it would not fit.
  const k = m && isDrawn(m) ? Math.min(1, W / crop.w, H / crop.h) : null
  const fitted =
    k !== null
      ? { x: (W - crop.w * k) / 2, y: (H - crop.h * k) / 2, w: crop.w * k, h: crop.h * k }
      : fitInPlace(crop.w, crop.h, { x: 0, y: 0, w: W, h: H })
  return tidyPlace(placeFromPixels(fitted, W, H), W, H)
}

/** Where a clip's crop starts: the largest box of the project shape, centred. */
export function startingCrop(p: Timeline, m: ProjectMedia): Rect {
  const aspect = targetAspect(p)
  if (aspect === null) return { x: 0, y: 0, w: evenDown(m.width), h: evenDown(m.height) }
  return largestRectOfAspect(m.width, m.height, aspect)
}
