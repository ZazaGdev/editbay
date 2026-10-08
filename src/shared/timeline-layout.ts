/**
 * Pixel geometry for the timeline. Pure, so the interaction it drives can be
 * tested without a browser.
 */

/**
 * Pixels per frame at each zoom level, most zoomed out first. The last three
 * are for cutting and trimming on an exact frame. Steps are only ever added
 * at the end, so a zoom level saved with a project keeps meaning the same zoom.
 */
export const ZOOM_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.4, 0.8, 1.5, 3, 6, 12, 24, 48]
export const ZOOM_LEVELS = ZOOM_STEPS.length
export const DEFAULT_ZOOM = 5

/**
 * Pixels per frame at a zoom, which may lie between two steps, as Ctrl+wheel
 * leaves it: geometrically between them, so each notch looks the same size
 * whatever the zoom. Never past the first or the last step.
 */
export function pxPerFrameAt(zoom: number): number {
  const z = Math.max(0, Math.min(ZOOM_LEVELS - 1, Number.isFinite(zoom) ? zoom : DEFAULT_ZOOM))
  const low = Math.floor(z)
  const high = Math.min(ZOOM_LEVELS - 1, low + 1)
  const a = ZOOM_STEPS[low]!
  const b = ZOOM_STEPS[high]!
  return a * Math.pow(b / a, z - low)
}

/**
 * How tall the tracks are. Three sizes rather than a drag handle: the thing
 * anyone actually wants is a filmstrip big enough to recognise a shot in, and
 * three named sizes give that in one press with nothing to remember.
 *
 * Small is what the timeline was before there was a choice.
 */
export type TrackSize = 'small' | 'medium' | 'large'

export const TRACK_SIZES: { id: TrackSize; name: string; video: number; audio: number }[] = [
  { id: 'small', name: 'Small', video: 46, audio: 44 },
  { id: 'medium', name: 'Medium', video: 64, audio: 54 },
  { id: 'large', name: 'Large', video: 96, audio: 72 }
]

/**
 * Small: the height the timeline has always had.
 *
 * Medium was tried as the default and taken back out. The timeline takes its
 * height from the monitor, and thirty pixels of timeline is thirty pixels less
 * preview, which is the thing you actually look at. Taller is one press away
 * when a filmstrip needs reading.
 */
export const DEFAULT_TRACK_SIZE: TrackSize = 'small'

/** How tall a video track and an audio track are at a size. An unknown size is the default. */
/**
 * How short and how tall a track can be dragged.
 *
 * Short enough that a track you are not working on takes almost no room, and
 * tall enough to read a waveform's shape rather than its outline, which is what
 * a sound track is resized for.
 */
export const MIN_TRACK_HEIGHT = 24
export const MAX_TRACK_HEIGHT = 320

/** A height a track has been dragged to, held between the two ends. */
export function heldTrackHeight(px: number): number {
  return Math.round(Math.min(MAX_TRACK_HEIGHT, Math.max(MIN_TRACK_HEIGHT, px)))
}

export function trackHeights(size: TrackSize): { video: number; audio: number } {
  const found = TRACK_SIZES.find((s) => s.id === size) ?? TRACK_SIZES.find((s) => s.id === DEFAULT_TRACK_SIZE)!
  return { video: found.video, audio: found.audio }
}

/** Whether a stored value names a size. */
export function isTrackSize(raw: unknown): raw is TrackSize {
  return TRACK_SIZES.some((s) => s.id === raw)
}

/** The size after this one, wrapping round from the largest. What the size button steps through. */
export function nextTrackSize(size: TrackSize): TrackSize {
  const at = TRACK_SIZES.findIndex((s) => s.id === size)
  return TRACK_SIZES[(at + 1) % TRACK_SIZES.length]!.id
}

export const MIN_CLIP_WIDTH = 18
const MAX_HANDLE_WIDTH = 12
/** Body left clickable between the two handles, so a short clip can still be selected. */
const MIN_BODY_WIDTH = 10

/**
 * How wide each trim handle should be on a clip of `clipWidth` pixels.
 *
 * Handles shrink on a narrow clip rather than covering it. A clip trimmed to a
 * single frame is only a few pixels wide, and two full size handles would
 * swallow it whole: it could not be selected, dragged or deleted.
 */
export function handleWidthFor(clipWidth: number): number {
  return Math.max(2, Math.min(MAX_HANDLE_WIDTH, Math.floor((clipWidth - MIN_BODY_WIDTH) / 2)))
}

/**
 * How the drawn part of the timeline is rounded out, in pixels. The timeline
 * draws only what is near the part in view, and rounding that out to whole
 * steps means a scroll redraws the clips only when it crosses a step, not on
 * every pixel it moves.
 */
export const DRAW_STEP_PX = 1024

/** A stretch of the timeline, in pixels from its start, `to` not included. */
export interface PxSpan {
  from: number
  to: number
}

/**
 * The stretch of the timeline worth drawing when it is scrolled to `left` and
 * `width` of it is in view: that part and a screen's width either side, so a
 * scroll or a playhead running on never reaches the edge of what is drawn
 * before it is drawn further. A view not measured yet counts as a step wide.
 */
export function drawnSpan(left: number, width: number): PxSpan {
  const screen = Math.max(width, DRAW_STEP_PX)
  const from = Math.max(0, Math.floor((left - screen) / DRAW_STEP_PX) * DRAW_STEP_PX)
  const to = Math.ceil((left + 2 * screen) / DRAW_STEP_PX) * DRAW_STEP_PX
  return { from, to }
}

/**
 * Which part of a clip drawn from `left`, `width` wide, falls in `span`, in
 * the clip's own pixels from its left edge. Nothing, 0 to 0, when none does.
 * A clip wholly inside the span always gets 0 to its width, so scrolling past
 * it asks nothing new of it.
 */
export function shownPart(left: number, width: number, span: PxSpan): PxSpan {
  const from = Math.max(0, Math.min(width, span.from - left))
  const to = Math.max(0, Math.min(width, span.to - left))
  return from < to ? { from, to } : { from: 0, to: 0 }
}

/**
 * The seconds the ruler labels, roughly one every 120 pixels on whole seconds,
 * from the start to `durationFrames`, but only those near `span`: a long
 * sequence zoomed in has thousands, and all but a screenful are out of sight.
 * One label before the span is kept, since a label is drawn to the right of
 * its second and can reach into it.
 */
/**
 * The frames the ruler labels: whole seconds as `rulerSeconds` gives them, or,
 * zoomed in far enough that a label fits in less than a second, every few
 * frames, stepping by a number of frames that divides the second so each
 * second still gets its own label. Only those near `span`, as there.
 */
export function rulerFrames(durationFrames: number, fps: number, pxPerFrame: number, span: PxSpan): number[] {
  const whole = Math.round(fps)
  const step = [...Array(Math.max(0, whole - 1)).keys()].map((i) => i + 1).find((d) => whole % d === 0 && d * pxPerFrame >= 120)
  if (step === undefined || whole <= 1) return rulerSeconds(durationFrames, fps, pxPerFrame, span).map((s) => Math.round(s * fps))
  const pxEvery = step * pxPerFrame
  const first = Math.max(0, Math.floor(span.from / pxEvery) - 1) * step
  const out: number[] = []
  for (let f = first; f <= durationFrames && f * pxPerFrame < span.to; f += step) out.push(f)
  return out
}

export function rulerSeconds(durationFrames: number, fps: number, pxPerFrame: number, span: PxSpan): number[] {
  const every = Math.max(1, Math.round(120 / Math.max(0.001, pxPerFrame * fps)))
  const pxEvery = every * fps * pxPerFrame
  const first = pxEvery > 0 ? Math.max(0, Math.floor(span.from / pxEvery) - 1) * every : 0
  const out: number[] = []
  for (let s = first; s * fps <= durationFrames && s * fps * pxPerFrame < span.to; s += every) out.push(s)
  return out
}
