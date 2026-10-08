import { allClips, timelineDuration, type Timeline } from './project'
import { spanEnd } from './tracks'
import { ZOOM_LEVELS, ZOOM_STEPS, pxPerFrameAt } from './timeline-layout'

/**
 * The strip above the ruler that shows the whole edit at once, and the zoom
 * that puts the whole edit on screen. Pure, so what the strip draws and where
 * Fit lands are tested without a browser.
 */

/** One clip on the strip: where it is, and which kind of track it came off. */
export interface OverviewBlock {
  from: number
  to: number
  kind: 'video' | 'audio'
  /** Which track of its kind, from 0, so a block can take that track's colour. */
  trackIndex: number
  /** The colour it was marked with, if any, which it takes instead of its track's. */
  mark?: string
}

/**
 * Every clip of the sequence, in frames, sorted so the same timeline always
 * draws the same strip. Sorted by where it starts and then by track, because
 * two clips starting together on different tracks would otherwise swap places
 * between renders and the strip would flicker.
 */
export function overviewBlocks(t: Timeline): OverviewBlock[] {
  const blocks: OverviewBlock[] = []
  t.videoTracks.forEach((track, trackIndex) => {
    for (const c of track.clips) {
      blocks.push({ from: c.timelineStart, to: spanEnd(c), kind: 'video', trackIndex, ...(c.mark === undefined ? {} : { mark: c.mark }) })
    }
  })
  t.audioTracks.forEach((track, trackIndex) => {
    for (const c of track.clips) {
      blocks.push({ from: c.timelineStart, to: spanEnd(c), kind: 'audio', trackIndex, ...(c.mark === undefined ? {} : { mark: c.mark }) })
    }
  })
  return blocks.sort((a, b) => a.from - b.from || a.kind.localeCompare(b.kind) || a.trackIndex - b.trackIndex)
}

/**
 * How long the strip draws, in frames. The sequence's own length, or one
 * second when it is empty, so a strip never divides by zero and a first clip
 * dropped at 0 does not fill it edge to edge.
 */
export function overviewFrames(t: Timeline): number {
  return Math.max(t.fps, timelineDuration(t))
}

/**
 * The zoom at which `frames` fills `widthPx`, which may lie between two steps
 * as Ctrl+wheel leaves it.
 *
 * Never past the first or the last step. A short edit is held at the step
 * before the last rather than magnified to six pixels a frame: fitting two
 * seconds is not a reason to show every frame as a block.
 */
export function fitZoom(frames: number, widthPx: number): number {
  if (!Number.isFinite(frames) || !Number.isFinite(widthPx) || frames <= 0 || widthPx <= 0) return ZOOM_LEVELS - 1
  const wanted = widthPx / frames
  const first = ZOOM_STEPS[0]!
  const last = ZOOM_STEPS[ZOOM_LEVELS - 1]!
  if (wanted <= first) return 0
  if (wanted >= last) return ZOOM_LEVELS - 1
  // The steps are geometric, so the zoom between two of them is the log of the
  // ratio: the same arithmetic `pxPerFrameAt` undoes.
  for (let i = 0; i < ZOOM_LEVELS - 1; i++) {
    const a = ZOOM_STEPS[i]!
    const b = ZOOM_STEPS[i + 1]!
    if (wanted <= b) return i + Math.log(wanted / a) / Math.log(b / a)
  }
  return ZOOM_LEVELS - 1
}

/** The zoom that fits the whole of `t` into `widthPx` of timeline. */
export function fitZoomFor(t: Timeline, widthPx: number): number {
  return fitZoom(overviewFrames(t), widthPx)
}

/**
 * The part of the sequence a scroller is showing, in frames, held inside the
 * strip's own length so the box never runs off its end. `to` is exclusive.
 */
export function viewportFrames(scrollLeft: number, clientWidth: number, zoom: number, frames: number): { from: number; to: number } {
  const pxPerFrame = pxPerFrameAt(zoom)
  const from = Math.max(0, Math.min(frames, scrollLeft / pxPerFrame))
  const to = Math.max(from, Math.min(frames, (scrollLeft + clientWidth) / pxPerFrame))
  return { from, to }
}

/**
 * Where the scroller should go to put `frame` in the middle of what it shows,
 * never before the start and never past the end of what there is to scroll.
 */
export function scrollToCentre(frame: number, clientWidth: number, zoom: number, frames: number): number {
  const pxPerFrame = pxPerFrameAt(zoom)
  const most = Math.max(0, frames * pxPerFrame - clientWidth)
  return Math.max(0, Math.min(most, frame * pxPerFrame - clientWidth / 2))
}

/**
 * Where the scroller should go to put `frame` at the left edge of what it
 * shows, never before the start and never past the end of what there is to
 * scroll.
 *
 * What a drag on the box uses. Centring on the pointer is right for a press on
 * bare strip, and wrong for a drag: a box taken by its left edge would jump so
 * the pointer was in its middle, and would then sit still until the pointer
 * had travelled half a view.
 */
export function scrollToShow(frame: number, clientWidth: number, zoom: number, frames: number): number {
  const pxPerFrame = pxPerFrameAt(zoom)
  const most = Math.max(0, frames * pxPerFrame - clientWidth)
  return Math.max(0, Math.min(most, frame * pxPerFrame))
}

/** Whether the sequence has anything on it at all, which is when the strip is drawn. */
export function hasAnything(t: Timeline): boolean {
  return allClips(t).length > 0
}
