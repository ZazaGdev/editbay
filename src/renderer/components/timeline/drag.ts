/**
 * What a drag on the timeline is: a clip being moved, how far it goes before
 * it counts, the room it is given, and what a source from the bin carries.
 */

import type { Landing, TrackKind } from '../../../shared/project'

export const DRAG_THRESHOLD_PX = 6
/** How far a press on empty space moves before it is a box rather than a click. */
export const BOX_THRESHOLD_PX = 4

/** A clip being dragged: where it began, and where it and its linked clips would land. */
export interface Drag {
  clipId: string
  alone: boolean
  /** The rest of the selection, when the clip pressed was in one: it moves too, by as much. */
  with: string[]
  kind: TrackKind
  startX: number
  /** Where the timeline was scrolled to when the drag began, so a scroll during it moves the clip with the view. */
  startScroll: number
  startY: number
  fromStart: number
  length: number
  /** What it snaps to, taken when the drag began. */
  targets: number[]
  /** The track under the pointer, of the clip's kind, once it has moved. */
  trackId: string
  landings: Landing[] | null
  start: number
  /** Past the drag threshold: it will move when let go. */
  moved: boolean
  /** Ctrl held, from V1 or onto it: taken out where it was and put in where it lands, closing up and opening up. */
  insert: boolean
  /** Whether it, or a clip linked to it, is on V1, so Ctrl takes it out and puts it in wherever it goes. */
  fromV1: boolean
  /** Over the lane past the last track of its kind: `trackId` is a track to make. */
  newTrack: boolean
  /** The id the lane's new track gets, made when the drag began. */
  laneTrackId: string
}

/** How tall the lane past the last track is, while something is being dragged. */
export const LANE_HEIGHT = 26

/**
 * How much empty room there is past the last clip while something is being
 * dragged.
 *
 * Enough to drag a clip out beyond the end of the sequence and have the
 * timeline scroll while you do it. Forty pixels, which is what it was, is less
 * than the width of the edge that triggers the scroll, so a drag to the end had
 * nowhere to go. Only while a drag is on: the rest of the time the width of the
 * timeline is the length of the edit, which is what Fit measures and what the
 * strip above it draws.
 */
export const TAIL_PX = 320

/** How a source dragged from the bin is carried: its id under this type. */
export const SOURCE_TYPE = 'application/x-editbay-source'
/** What a file dragged from the effects folder carries: its path, brought in as it lands (plan 90). */
export const EFFECT_TYPE = 'application/x-editbay-effect'
