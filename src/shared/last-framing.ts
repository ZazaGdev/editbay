import { startingCrop } from './drawn-media'
import { isFullFrame } from './layout'
import { findVideoClip, framingOf, framingRefusal, hasPicture, isOverlay, type Clip, type Framing, type ProjectMedia, type Timeline } from './project'
import type { ClipEdit } from './types'

/**
 * Plan 93: the framing you used last, offered to a recording put on a project
 * where nothing is framed yet. Given by itself to a recording of the same
 * width and height as the one it was made on, and offered for any other.
 */

/** A recording: a picture that fills its place in the frame, not an image, a text, a shape or a colour laid over one. */
export function isRecording(m: ProjectMedia): boolean {
  return hasPicture(m) && !isOverlay(m)
}

/**
 * The edits that change a recording's framing, as Copy framing copies it, and
 * the clip each is about: the first of several, which all take the same.
 */
export function framingEditedClip(e: ClipEdit): string | null {
  if (e.kind === 'onSelected') return framingEditedClip(e.edit)
  switch (e.kind) {
    case 'setCrop':
    case 'setPlace':
    case 'setPip':
    case 'applyLayout':
    case 'applyLayoutToSource':
    case 'setFraming':
    case 'addLayer':
    case 'removeLayer':
    case 'swapPictures':
    case 'setPictureStyle':
      return e.clipId
    case 'setFramingOn':
    case 'setCropOn':
      return e.clipIds[0] ?? null
    case 'setCropsOn':
      return e.crops[0]?.clipId ?? null
    default:
      return null
  }
}

/** The framing of a recording clip, to remember as the last one, or null for anything else. */
export function lastFramingOf(t: Timeline, clipId: string): Framing | null {
  const found = findVideoClip(t, clipId)
  const m = found ? t.media.find((x) => x.id === found.clip.mediaId) : undefined
  if (!found || !m || !isRecording(m)) return null
  return framingOf(t, clipId)
}

/** Whether a recording clip still has the framing it was put down with: one picture filling the frame, on its starting crop. */
export function isUntouched(t: Timeline, c: Clip, m: ProjectMedia): boolean {
  if (c.layout !== 'single' || c.layers.length > 0 || c.transform.style || !isFullFrame(c.transform.place)) return false
  const start = startingCrop(t, m)
  const crop = c.transform.crop
  return crop.x === start.x && crop.y === start.y && crop.w === start.w && crop.h === start.h
}

/**
 * Whether a clip carries a framing already: the same layout, with every
 * picture in the same place. Its crops are left out, since a framing given
 * to a recording of another size has them scaled to it.
 */
function carries(c: Clip, f: Framing): boolean {
  const same = (a: object | undefined, b: object | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  return (
    c.layout === f.layout &&
    same(c.transform.place, f.place) &&
    c.layers.length === f.layers.length &&
    c.layers.every((l, i) => same(l.place, f.layers[i]!.place) && same(l.style, f.layers[i]!.style))
  )
}

/**
 * What to do with the last framing for a recording clip just put on the
 * sequence: give it, offer it, or nothing. Nothing once any recording there
 * has been framed by hand, so only a project where nothing is framed yet is
 * touched: `given` are the clips it was given to here, which still count as
 * unframed while they carry it. And nothing when it cannot be given to this
 * recording at all.
 */
export function lastFramingFor(t: Timeline, clipId: string, last: Framing | null, given: ReadonlySet<string> = new Set()): 'apply' | 'offer' | null {
  if (!last) return null
  const found = findVideoClip(t, clipId)
  const m = found ? t.media.find((x) => x.id === found.clip.mediaId) : undefined
  if (!found || !m || !isRecording(m) || !isUntouched(t, found.clip, m)) return null
  if (framingRefusal(t, clipId, last) !== null) return null
  for (const track of t.videoTracks) {
    for (const c of track.clips) {
      if (c.id === clipId) continue
      const other = t.media.find((x) => x.id === c.mediaId)
      if (other && isRecording(other) && !isUntouched(t, c, other) && !(given.has(c.id) && carries(c, last))) return null
    }
  }
  return m.width === last.width && m.height === last.height ? 'apply' : 'offer'
}
