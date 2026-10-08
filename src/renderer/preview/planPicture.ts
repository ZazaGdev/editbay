/**
 * What the HTML video engine hands the draw plan for one picture under the
 * playhead: its pictures at this frame, in the shown video's pixels, and the
 * look, blurs, wash and coming in or going out that are drawn with it.
 */

import { washOver, type TransitionWindow } from '../../shared/transitions'
import { picturesAt } from './pictures-at'
import { appearing, type Shown } from './pictureShowing'

export function planPicture(p: Shown, frame: number, windows: TransitionWindow[], blending: ReadonlySet<string>, lowestTrack: string | undefined) {
  const wash = washOver(windows, p.clip.id, frame)
  const moved = picturesAt(p.clip.pictures, p.clip.move, frame)

  // Crops are in the recording's pixels. A lighter copy is smaller: the same part of it is taken.
  const shownWidth = (p.el as { videoWidth?: number } | null)?.videoWidth ?? 0
  const k = shownWidth > 0 && p.clip.width > 0 ? shownWidth / p.clip.width : 1
  const drawn =
    Math.abs(k - 1) < 1e-6 ? moved : moved.map((q) => ({ ...q, crop: { x: q.crop.x * k, y: q.crop.y * k, w: q.crop.w * k, h: q.crop.h * k } }))
  return {
    pictures: drawn,
    ...(wash ? { wash } : {}),
    ...(p.clip.look ? { look: p.clip.look } : {}),
    // In the shown video's pixels, as its crops are.
    ...(p.clip.blurs
      ? { blurs: p.clip.blurs.map((b) => ({ rect: { x: b.rect.x * k, y: b.rect.y * k, w: b.rect.w * k, h: b.rect.h * k }, sigma: b.sigma * k })) }
      : {}),
    ...(p.clip.free ? { free: appearing(p.clip, frame, blending) } : {}),
    ...(p.clip.blurFill ? { blurFill: true } : {}),
    // Over another track, as the export lays it over, and not the second side of a blend on the lowest.
    ...(p.track !== lowestTrack ? { over: true } : {})
  }
}
