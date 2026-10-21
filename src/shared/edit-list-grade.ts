import { at, notNegative, object, oneOf, refuse, seconds, text } from './edit-list-fields'
import { ADJUSTMENTS, LOOKS, type ColourAdjust } from './looks'
import { viewOf, viewsOf } from './layout'
import type { ProjectMedia, Rect, Timeline } from './project'

/**
 * A reel's grade (task 1188): one of Editbay's looks, its strength and the
 * four sliders, on every picture of one camera and nothing else, so the
 * camera footage is graded and the screen recording stays as recorded. Read
 * as a clip's Look section would be set, on a clip whose pictures are all the
 * camera's, or on the one picture of a clip that is, such as the bottom half
 * of a split Short.
 */

export interface EditGrade {
  /** The source whose pictures are graded, by its id in the reel. Every picture of its file is. */
  source: string
  /** The half of a side-by-side recording that is the camera. Every picture of the file when left out. */
  view?: 'left' | 'right'
  /** One of the looks a clip can have, as the Inspector offers them. */
  look?: string
  /** How strongly the look is on, 0 to 100. Full when left out. */
  lookStrength?: number
  /** The four sliders, each -100 to 100. */
  adjust?: ColourAdjust
}

export function readGrade(raw: unknown, where: string): EditGrade {
  const o = object(raw, where, ['source'], ['view', 'look', 'lookStrength', 'adjust'])
  if (o.look === undefined && o.adjust === undefined) refuse(where, 'changes nothing: give it a look, or adjust')
  if (o.lookStrength !== undefined && o.look === undefined) refuse(at(where, 'lookStrength'), 'is the strength of a look, and there is none')
  let lookStrength: number | undefined
  if (o.lookStrength !== undefined) {
    lookStrength = notNegative(o.lookStrength, at(where, 'lookStrength'))
    if (lookStrength > 100) refuse(at(where, 'lookStrength'), 'must be from 0 to 100')
  }
  let adjust: ColourAdjust | undefined
  if (o.adjust !== undefined) {
    const a = object(o.adjust, at(where, 'adjust'), [], ADJUSTMENTS.map((x) => x.id))
    adjust = {}
    for (const { id } of ADJUSTMENTS) {
      if (a[id] === undefined) continue
      const n = seconds(a[id], at(at(where, 'adjust'), id))
      if (n < -100 || n > 100) refuse(at(at(where, 'adjust'), id), 'must be from -100 to 100')
      adjust[id] = n
    }
  }
  return {
    source: text(o.source, at(where, 'source')),
    ...(o.view !== undefined ? { view: oneOf(o.view, at(where, 'view'), ['left', 'right'] as const) } : {}),
    ...(o.look !== undefined ? { look: oneOf(o.look, at(where, 'look'), LOOKS.map((l) => l.id)) } : {}),
    ...(lookStrength !== undefined ? { lookStrength } : {}),
    ...(adjust !== undefined ? { adjust } : {})
  }
}

/**
 * The grade put on every picture of the camera on the reel's picture tracks
 * (V1 and the corner), as `path` and the half name it. A clip all of whose
 * pictures are the camera's takes it as its own look; a layer that is the
 * camera's, in a clip whose main picture is not, takes it as the layer's. A
 * clip whose main picture is the camera's but one of its layers is not is
 * refused: a clip's look is on all of its pictures.
 */
export function applyGrade(t: Timeline, grade: EditGrade, path: string, layerTrack: string, where: string): Timeline {
  const media = new Map<string, ProjectMedia>(t.media.filter((m) => m.originalPath === path).map((m) => [m.id, m]))
  const colour = {
    ...(grade.look !== undefined ? { look: grade.look } : {}),
    ...(grade.lookStrength !== undefined && grade.lookStrength !== 100 ? { lookStrength: Math.round(grade.lookStrength) } : {}),
    ...(grade.adjust !== undefined ? { adjust: grade.adjust } : {})
  }
  let graded = 0
  const videoTracks = t.videoTracks.map((track) => {
    if (track.id.startsWith(layerTrack)) return track
    return {
      ...track,
      clips: track.clips.map((c) => {
        const m = media.get(c.mediaId)
        if (!m) return c
        if (grade.view !== undefined && viewsOf(m.width, m.height).length < 2) {
          refuse(at(where, 'view'), `${m.originalPath} is not a side-by-side recording, so it has no ${grade.view} half`)
        }
        const half = grade.view === undefined ? null : viewsOf(m.width, m.height)[grade.view === 'left' ? 0 : 1]!
        const camera = (crop: Rect): boolean => half === null || viewOf(crop, m.width, m.height).x === half.x
        const main = camera(c.transform.crop)
        const layers = c.layers.map((l) => camera(l.crop))
        if (main && layers.every(Boolean)) {
          graded++
          return { ...c, ...colour }
        }
        if (main) refuse(where, `would grade a clip at ${(c.timelineStart / t.fps).toFixed(2)} s whose main picture is the camera and whose other picture is not; Editbay's look on a clip is on all of its pictures`)
        if (!layers.some(Boolean)) return c
        graded++
        return { ...c, layers: c.layers.map((l, i) => (layers[i] ? { ...l, ...colour } : l)) }
      })
    }
  })
  if (graded === 0) refuse(where, 'grades nothing: no picture of the reel shows that camera')
  return { ...t, videoTracks }
}
