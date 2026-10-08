import type { Rect, ZoomKey } from './project'

/**
 * Follow face (plan 100): the faces found on frames of a recording, turned
 * into zoom keyframes that keep one face in a crop of the size the picture
 * has now. The crop holds still while the face stays in its middle third and
 * makes one eased pan when it leaves, so the result is a few calm moves you
 * can then adjust, not a crop that shakes on every frame.
 */

/** The faces found on one frame of the recording (the unit `sourceIn` counts in), in its own pixels. */
export interface FaceSample {
  at: number
  faces: Rect[]
}

/** What looking for faces gave: the samples and how many a second, or why it could not look. */
export type FacesFound = { ok: true; samples: FaceSample[]; rate: number } | { ok: false; message: string }

/** How long the followed face may go unseen before the largest face is taken instead. */
const LOST_SEC = 2
/** The followed face's next box is the nearest one within this many of its widths. */
const NEAR_WIDTHS = 1.5
/** Where the face's middle sits down the crop: a little above the middle leaves room for the shoulders. */
const FACE_DOWN = 0.4
/** The crop moves once the face leaves its middle third. */
const DEAD_ZONE = 1 / 6
/** A pan ends where the face stops moving by more than this share of the crop per sample. */
const SETTLE = 0.015
/** The shortest pan, so a quick move is still a pan rather than a jump. */
const MIN_PAN_SEC = 0.5

const centreOf = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
const area = (r: Rect): number => r.w * r.h
const largest = (faces: readonly Rect[]): Rect => faces.reduce((a, b) => (area(b) > area(a) ? b : a))
const inside = (r: Rect, crop: Rect): boolean => {
  const c = centreOf(r)
  return c.x >= crop.x && c.x <= crop.x + crop.w && c.y >= crop.y && c.y <= crop.y + crop.h
}

/**
 * The one face followed on each sample, or null where it is not seen. It is
 * the largest face inside `crop` on the first sample that has one, or the
 * largest anywhere when none is inside, so a crop put roughly over someone
 * follows them; after that the nearest face to where it was, so a second
 * person passing does not take the crop.
 */
export function trackFace(samples: readonly FaceSample[], crop: Rect, rate: number): (Rect | null)[] {
  const lostAfter = Math.max(1, Math.round(LOST_SEC * rate))
  let last: Rect | null = null
  let missed = 0
  return samples.map((s) => {
    if (s.faces.length === 0) {
      missed++
      return null
    }
    if (last === null || missed > lostAfter) {
      const within = last === null ? s.faces.filter((f) => inside(f, crop)) : []
      last = largest(within.length > 0 ? within : s.faces)
      missed = 0
      return last
    }
    const was = centreOf(last)
    let best: Rect | null = null
    let bestDist = NEAR_WIDTHS * last.w
    for (const f of s.faces) {
      const c = centreOf(f)
      const d = Math.hypot(c.x - was.x, c.y - was.y)
      if (d <= bestDist) {
        best = f
        bestDist = d
      }
    }
    if (best === null) {
      missed++
      return null
    }
    last = best
    missed = 0
    return best
  })
}

/** Each sample's face middle, a gap held at the last one seen (or the first, before any), smoothed by a running median. */
function smoothedCentres(track: readonly (Rect | null)[], rate: number): { x: number; y: number }[] {
  const first = track.find((r) => r !== null)
  if (!first) return []
  let held = centreOf(first)
  const raw = track.map((r) => (r ? (held = centreOf(r)) : held))
  const half = Math.max(1, Math.round(rate / 2))
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]!
  }
  // As many samples after as before, so near either end the middle is not pulled ahead or behind.
  return raw.map((_, i) => {
    const k = Math.min(half, i, raw.length - 1 - i)
    const near = raw.slice(i - k, i + k + 1)
    return { x: median(near.map((c) => c.x)), y: median(near.map((c) => c.y)) }
  })
}

/**
 * The zoom keyframes that follow the face, `crop`'s size throughout and held
 * inside the recording, from the clip's first frame (`sourceIn`) to its last
 * (`sourceOut - 1`). Null when no face is found on any sample.
 *
 * `rate` is samples a second and `fps` frames a second of the recording.
 */
export function followFaceKeys(
  samples: readonly FaceSample[],
  crop: Rect,
  size: { width: number; height: number },
  span: { sourceIn: number; sourceOut: number },
  rate: number,
  fps: number
): ZoomKey[] | null {
  const centres = smoothedCentres(trackFace(samples, crop, rate), rate)
  if (centres.length === 0) return null
  const { w, h } = crop
  const at = (c: { x: number; y: number }): Rect => ({
    x: Math.min(Math.max(c.x - w / 2, 0), Math.max(0, size.width - w)),
    y: Math.min(Math.max(c.y - h * FACE_DOWN, 0), Math.max(0, size.height - h)),
    w,
    h
  })
  const wanted = centres.map(at)
  const last = Math.max(span.sourceIn, span.sourceOut - 1)
  const minPan = Math.max(1, Math.round(MIN_PAN_SEC * fps))
  const frame = (i: number): number => Math.min(Math.max(Math.round(samples[i]!.at), span.sourceIn), last)

  let cam = wanted[0]!
  const keys: ZoomKey[] = [{ at: span.sourceIn, crop: cam }]
  const far = (a: Rect, b: Rect): boolean => Math.abs(a.x - b.x) > w * DEAD_ZONE || Math.abs(a.y - b.y) > h * DEAD_ZONE
  const moving = (a: Rect, b: Rect): boolean => Math.abs(a.x - b.x) > w * SETTLE || Math.abs(a.y - b.y) > h * SETTLE
  let i = 1
  while (i < wanted.length) {
    if (!far(wanted[i]!, cam)) {
      i++
      continue
    }
    // The pan starts from the last sample the face was still in the middle, and runs until it stops moving.
    const from = Math.max(frame(i - 1), keys[keys.length - 1]!.at)
    let j = i
    while (j + 1 < wanted.length && moving(wanted[j + 1]!, wanted[j]!)) j++
    const to = Math.min(Math.max(frame(j), from + minPan), last)
    if (to <= from) break
    if (from > keys[keys.length - 1]!.at) keys.push({ at: from, crop: cam })
    cam = wanted[j]!
    keys.push({ at: to, crop: cam })
    i = j + 1
    while (i < wanted.length && frame(i) <= to) i++
  }
  if (keys[keys.length - 1]!.at < last) keys.push({ at: last, crop: cam })
  return keys
}

/**
 * Centre on face (task 100): one still crop, `crop`'s size, with the face in
 * its middle, from where the face mostly is over the clip. Made for a round
 * picture in picture of someone sitting at a desk, who moves a little but
 * not far, where a crop that pans looks unsteady. Held inside the recording,
 * so a face near its edge comes as near the middle as it can. Null when no
 * face is found on any sample.
 */
export function faceCentredCrop(
  samples: readonly FaceSample[],
  crop: Rect,
  size: { width: number; height: number },
  rate: number
): Rect | null {
  const seen = trackFace(samples, crop, rate).filter((r): r is Rect => r !== null)
  if (seen.length === 0) return null
  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
  const x = median(seen.map((r) => centreOf(r).x))
  const y = median(seen.map((r) => centreOf(r).y))
  const { w, h } = crop
  return {
    x: Math.round(Math.min(Math.max(x - w / 2, 0), Math.max(0, size.width - w))),
    y: Math.round(Math.min(Math.max(y - h / 2, 0), Math.max(0, size.height - h))),
    w,
    h
  }
}
