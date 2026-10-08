import { appearAt, type Appear } from '../../shared/appear'
import { colourKey, type Coloured } from '../../shared/looks'
import type { MonitorBox } from '../../shared/monitor-layout'
import type { Lane, PictureLaneClip } from './lanes'

/**
 * The free helpers the HTML video engine plays with: how long its clock waits
 * and its scrub sounds, where an element goes on the monitor, which picture
 * the clock is taken from, and how an overlay is coming in or going out.
 */

/**
 * How long after the picture the clock is taken from starts, or after a cut
 * brings in the next one, before the clock is taken from it. Until then the
 * video is getting going and its time says little about where the sequence is.
 */
export const SETTLE_MS = 300

/**
 * How long the sound plays at each place the playhead is dragged to.
 *
 * Long enough to be a sound rather than a click, and short enough that it has
 * stopped before the pointer has moved far: every editor's scrub is a string
 * of grains like this, and the length is the only dial there is.
 */
export const SCRUB_BURST_MS = 90

/** Put an element at a box of the monitor. */
/** A clip's colour as its lane carries it: the code `colourKey` gives, or nothing for as recorded. */
export function colourOf(c: Coloured): { look: string } | Record<string, never> {
  const key = colourKey(c)
  return key ? { look: key } : {}
}

export function place(el: HTMLElement, box: MonitorBox): void {
  el.style.left = `${box.x}px`
  el.style.top = `${box.y}px`
  el.style.width = `${box.width}px`
  el.style.height = `${box.height}px`
}

/** The most device pixels the Output view's canvas holds, zoomed in (task 53): a canvas past this fails to draw. */
const MAX_CANVAS_PIXELS = 24_000_000

/** Device pixels per layout pixel for a canvas `box` large: the display's, held under a size a canvas can draw. */
export function canvasScale(box: { width: number; height: number }, ratio: number): number {
  const pixels = box.width * box.height * ratio * ratio
  return pixels > MAX_CANVAS_PIXELS ? ratio * Math.sqrt(MAX_CANVAS_PIXELS / pixels) : ratio
}

/** A clip path that cuts what is drawn at `drawn` to `view`, or none when the two are the same. */
export function cutTo(drawn: MonitorBox, view: MonitorBox): string {
  if (drawn === view) return ''
  const right = drawn.x + drawn.width - view.x - view.width
  const bottom = drawn.y + drawn.height - view.y - view.height
  return `inset(${view.y - drawn.y}px ${right}px ${bottom}px ${view.x - drawn.x}px)`
}

/**
 * A clip on a video track under the playhead, and what shows it when it has a
 * frame: a player for a recording, an image for a picture, which has no lane
 * of players and never sets the clock.
 */
export interface Shown {
  /** The track it is on. */
  track: string
  lane: Lane<PictureLaneClip> | null
  clip: PictureLaneClip
  el: HTMLMediaElement | HTMLImageElement | null
}

/** The lowest picture under the playhead that is a recording, which the clock can be taken from. */
export function lowestPlaying(pictures: Shown[]): (Shown & { lane: Lane<PictureLaneClip>; el: HTMLMediaElement | null }) | null {
  const found = pictures.find((p) => p.lane !== null)
  return found ? (found as Shown & { lane: Lane<PictureLaneClip>; el: HTMLMediaElement | null }) : null
}

/**
 * An overlay's turn and opacity at `frame` of the sequence, with how it is
 * coming in or going out worked in: its opacity faded and its size popped,
 * by the same sums the export gives ffmpeg. Not while it blends into another.
 */
export function appearing(
  clip: { free?: { rotation?: number; opacity?: number }; appear?: { start: number; length: number; enter?: Appear; exit?: Appear }; id: string },
  frame: number,
  blending: ReadonlySet<string>
): { rotation?: number; opacity?: number; scale?: number } {
  const free = clip.free ?? {}
  const a = clip.appear
  if (!a || blending.has(clip.id)) return free
  const { alpha, scale } = appearAt(frame - a.start, a.length, a.enter, a.exit)
  const opacity = (free.opacity ?? 1) * alpha
  return { ...free, ...(opacity < 1 ? { opacity } : {}), ...(scale !== 1 ? { scale } : {}) }
}
