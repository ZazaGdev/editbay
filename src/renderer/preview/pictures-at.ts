import { boxAtKeys, boxMoves } from '../../shared/box-keys'
import { cropAtKeys } from '../../shared/crop-geometry'
import type { BoxKey, Clip, PictureStyle, ZoomKey } from '../../shared/project'
import type { Place } from '../../shared/layout'
import type { Rect } from '../../shared/project'

type Picture = { crop: Rect; place: Place; style?: PictureStyle; keys?: ZoomKey[]; boxKeys?: BoxKey[] }

/**
 * A clip's pictures on a frame of the sequence, for a clip that moves, read
 * on the recording's own frame as the export reads it: each crop by its zoom
 * keyframes, the main one by the clip's keys and a further one by its own,
 * and each box by its box keyframes where they move it (plan 97).
 */
export function picturesAt(
  pictures: readonly Picture[],
  move: { keys: ZoomKey[]; sourceIn: number; startFrame: number } | undefined,
  frame: number
): (Picture & { box?: { place: Place; opacity: number } })[] {
  if (!move) return [...pictures]
  const at = move.sourceIn + frame - move.startFrame
  return pictures.map((q, i) => {
    const keys = i === 0 ? move.keys : q.keys
    const zoomed = keys && keys.length > 0 ? { ...q, crop: cropAtKeys(q.crop, keys, at) } : q
    return q.boxKeys && boxMoves(q.boxKeys) ? { ...zoomed, box: boxAtKeys(q.place, q.boxKeys, at) } : zoomed
  })
}

/** A clip's main picture as the preview reads it: its crop, place and frame, and its box keyframes (plan 97). */
export function mainPicture(c: Clip): Picture {
  const t = c.transform
  return { crop: t.crop, place: t.place, ...(t.style ? { style: t.style } : {}), ...(t.boxKeys ? { boxKeys: t.boxKeys } : {}) }
}
