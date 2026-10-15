import { BACKGROUND_COLOURS, type BackgroundColour } from './looks'
import { at, fractionRect, flag, notNegative, object, oneOf, refuse, text } from './edit-list-fields'
import { fitInPlace, placeFromPixels, tidyPlace } from './layout'
import { hasRoom, MAX_VIDEO_TRACKS } from './tracks'
import { evenDown } from './project-core'
import {
  MAIN_PICTURE,
  addTrack,
  findClip,
  hasPicture,
  isStill,
  mediaDurationFrames,
  newId,
  placeSource,
  setClipOut,
  setCrop,
  setPlace,
  setRemoveBackground,
  targetAspect,
  type ProjectMedia,
  type Timeline
} from './project'

/**
 * Layers in an edit list (task 137): a picture, such as a hand sketch, or an
 * overlay clip, such as a subscribe animation, laid over the cut for a while.
 * Each lands as an ordinary clip on a picture track above the cut, as a drop
 * from Sources would, so it can still be moved, trimmed or deleted in the app.
 */

/** Where a layer sits: a named part of the frame, or a box in fractions of the frame. */
export type LayerBox = 'full' | 'left-half' | 'right-half' | { x: number; y: number; w: number; h: number }
export const NAMED_BOXES = ['full', 'left-half', 'right-half'] as const

export interface EditLayer {
  /** A picture or a video file. A path that is not whole is taken from the list's own folder. */
  path: string
  /** Where it comes in, on the reel's main recording's clock. */
  fromSec: number
  /** Where it goes. Needed for a picture; a clip plays whole when left out. */
  toSec?: number
  /** The part of the frame it is fitted inside, keeping its own shape; the whole frame when left out. */
  box?: LayerBox
  /** A plain background taken out, as Remove background does: a green-screen clip's green. */
  key?: BackgroundColour
  why?: string
  /** A marker where it comes in, named from `why` or the file's name. */
  mark?: boolean
}

export function readLayer(raw: unknown, where: string): EditLayer {
  const o = object(raw, where, ['path', 'fromSec'], ['toSec', 'box', 'key', 'why', 'mark'])
  const path = text(o.path, at(where, 'path'))
  const fromSec = notNegative(o.fromSec, at(where, 'fromSec'))
  let toSec: number | undefined
  if (o.toSec !== undefined) {
    toSec = notNegative(o.toSec, at(where, 'toSec'))
    if (toSec <= fromSec) refuse(where, `ends at ${toSec} s, which is not after where it starts, ${fromSec} s`)
  }
  let box: LayerBox | undefined
  if (o.box !== undefined) {
    box = typeof o.box === 'string' ? oneOf(o.box, at(where, 'box'), NAMED_BOXES) : fractionRect(o.box, at(where, 'box'))
  }
  return {
    path,
    fromSec,
    ...(toSec !== undefined ? { toSec } : {}),
    ...(box !== undefined ? { box } : {}),
    ...(o.key !== undefined ? { key: oneOf(o.key, at(where, 'key'), BACKGROUND_COLOURS) } : {}),
    ...(o.why !== undefined ? { why: typeof o.why === 'string' ? o.why : refuse(at(where, 'why'), 'must be text') } : {}),
    ...(o.mark !== undefined ? { mark: flag(o.mark, at(where, 'mark')) } : {})
  }
}

/** What laying a reel's layers needs from the reel: where its moments land in the cut, and where the cut ends. */
export interface LayerClock {
  /** The frame of the cut a moment of the main recording lands on, refused when it is taken out. */
  start(sec: number, where: string): number
  /** The frame of the cut a moment lands on, a moment taken out landing on its join. */
  end(sec: number): number
  /** The reel's last frame in the cut, not included. */
  reelEnd: number
}

/** Layer tracks are named so, and kept above every other picture track. */
export const LAYER_TRACK = 'layer'

/** The box in output pixels. */
function boxPixels(box: LayerBox, W: number, H: number): { x: number; y: number; w: number; h: number } {
  if (box === 'full') return { x: 0, y: 0, w: W, h: H }
  if (box === 'left-half') return { x: 0, y: 0, w: W / 2, h: H }
  if (box === 'right-half') return { x: W / 2, y: 0, w: W / 2, h: H }
  return { x: box.x * W, y: box.y * H, w: box.w * W, h: box.h * H }
}

/**
 * Each layer put on the reel's timeline after the cuts are taken out, so a
 * clip plays unbroken from where its start lands. It goes on the lowest layer
 * track with room for it, or a new one at the top, and its sound, when it has
 * some, on an audio track with room, linked to it. Returns the timeline and
 * the markers the layers ask for.
 */
export function layLayers(
  base: Timeline,
  layers: readonly EditLayer[],
  media: readonly ProjectMedia[],
  clock: LayerClock,
  where: (i: number) => string,
  shape: string
): { timeline: Timeline; marks: { frame: number; label: string }[] } {
  let t = base
  const marks: { frame: number; label: string }[] = []
  layers.forEach((layer, i) => {
    const w = where(i)
    const m = media[i]!
    if (!hasPicture(m)) refuse(at(w, 'path'), `${m.originalPath} has no picture to lay over the cut`)
    if (targetAspect(t) === null) refuse(w, `the ${shape} shape has no frame to lay a picture over`)
    const still = isStill(m)
    const a = clock.start(layer.fromSec, at(w, 'fromSec'))
    let length: number
    if (still) {
      if (layer.toSec === undefined) refuse(at(w, 'toSec'), `is missing: ${m.originalPath} is a picture, so it needs to be told when to go`)
      length = clock.end(layer.toSec) - a
    } else {
      const whole = mediaDurationFrames(m, t.fps)
      length = layer.toSec === undefined ? whole : clock.end(layer.toSec) - a
      if (length > whole) refuse(at(w, 'toSec'), `keeps it on for ${(length / t.fps).toFixed(2)} s of the cut, longer than ${m.originalPath}, ${m.durationSec.toFixed(2)} s`)
    }
    if (length < 1) refuse(w, `is shorter than one frame of the cut`)
    if (a + length > clock.reelEnd) {
      refuse(w, `runs ${((a + length - clock.reelEnd) / t.fps).toFixed(2)} s past the end of its reel's cut; start it earlier or give it an earlier toSec`)
    }

    // The lowest layer track with room, or a new one.
    const layerTracks = t.videoTracks.filter((r) => r.id.startsWith(LAYER_TRACK))
    let track = layerTracks.find((r) => hasRoom(r.clips, a, length))?.id
    if (track === undefined) {
      if (t.videoTracks.length >= MAX_VIDEO_TRACKS) refuse(w, `needs a picture track of its own, and a sequence has at most ${MAX_VIDEO_TRACKS}`)
      track = `${LAYER_TRACK}${layerTracks.length + 1}`
      t = addTrack(t, 'video', track)
    }
    const clipId = newId()
    const { timeline, refused } = placeSource(t, {
      mediaId: m.id,
      clipId,
      at: a,
      onTrack: track,
      streams: m.hasAudio ? [0] : [],
      ...(still ? { length } : { whole: true })
    })
    if (refused !== null) refuse(w, refused)
    t = timeline
    if (!still) {
      const c = findClip(t, clipId)!.clip
      if (c.sourceOut - c.sourceIn > length) t = setClipOut(t, clipId, c.sourceIn + length)
    }

    // All of the picture, fitted inside its box in its own shape.
    const { width: W, height: H } = t.output
    const crop = { x: 0, y: 0, w: evenDown(m.width), h: evenDown(m.height) }
    if (!still) t = setCrop(t, clipId, crop)
    const place = tidyPlace(placeFromPixels(fitInPlace(crop.w, crop.h, boxPixels(layer.box ?? 'full', W, H)), W, H), W, H)
    t = setPlace(t, clipId, MAIN_PICTURE, place, false)
    if (layer.key) t = setRemoveBackground(t, clipId, { colour: layer.key })

    if (layer.mark) {
      const why = layer.why?.trim() ?? ''
      marks.push({ frame: a, label: why !== '' ? why : (m.originalPath.split(/[\\/]/).pop() ?? m.originalPath) })
    }
  })
  return { timeline: t, marks }
}
