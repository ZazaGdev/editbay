import type { WorkspaceView } from './workspace'

/**
 * Where the monitor's two views go: the Source view, the whole recording to
 * crop, and the Output view, the finished frame to place pictures in. For a
 * vertical frame on a wide monitor both fit side by side, the Output taking a
 * third or so of the width; otherwise one view has the whole monitor. Pure,
 * so the arithmetic is tested without a window.
 */

/** A rectangle of the monitor, in layout pixels from its top left corner. */
export interface MonitorBox {
  x: number
  y: number
  width: number
  height: number
}

/** Where each view goes, or null for a view not shown. */
export interface MonitorLayout {
  source: MonitorBox | null
  program: MonitorBox | null
}

/** Pixels between the two views. */
export const SIDE_GAP = 8

/** Pixels kept clear around the Output view side by side, so its outline and handles are not cut off by the monitor's edge. */
export const SIDE_INSET = 4

/**
 * Whether both views show: side by side is on, the frame is taller than
 * wide, and the monitor is at least as wide as it is tall. Handoff, which has
 * no frame, shows one.
 */
export function showsBoth(
  stage: { width: number; height: number },
  frame: { width: number; height: number } | null,
  sideBySide: boolean
): boolean {
  return sideBySide && frame !== null && frame.height > frame.width && stage.height > 0 && stage.width >= stage.height
}

/**
 * Room kept clear inside the monitor's edges, in layout pixels: along the
 * top, where the caption saying what the views are sits, and along the other
 * three sides. In the editor a picture that fills the frame then has its box,
 * its handles and the caption fully inside the monitor, clear of the controls
 * and the panels (bugs and notes 2, note 30); on the whole screen there is none.
 */
export interface MonitorRoom {
  top: number
  side: number
}

export const NO_ROOM: MonitorRoom = { top: 0, side: 0 }

/** The room the editor keeps: enough above for the caption, and a margin elsewhere. */
export const EDITOR_ROOM: MonitorRoom = { top: 26, side: 14 }

/**
 * The views on a monitor this size. Side by side, the Output is on the right,
 * the frame fitted to the monitor's height but never more than half its
 * width, a few pixels in from the edges, and the Source has the rest on the
 * left. Alone, the view the keys act on has the whole monitor. Either way
 * inside the room asked for.
 */
export function monitorLayout(
  stage: { width: number; height: number },
  view: WorkspaceView,
  frame: { width: number; height: number } | null,
  sideBySide: boolean,
  room: MonitorRoom = NO_ROOM
): MonitorLayout {
  const inner = { x: room.side, y: room.top, width: Math.max(0, stage.width - 2 * room.side), height: Math.max(0, stage.height - room.top - room.side) }
  if (!showsBoth(stage, frame, sideBySide) || !frame) {
    return view === 'source' ? { source: inner, program: null } : { source: null, program: inner }
  }
  // The Output keeps at least a few pixels clear, so its outline is not cut off.
  const top = Math.max(SIDE_INSET, room.top)
  const edge = Math.max(SIDE_INSET, room.side)
  const height = stage.height - top - edge
  const programWidth = Math.floor(Math.min((height * frame.width) / frame.height, stage.width / 2 - edge))
  const programX = stage.width - edge - programWidth
  return {
    source: { x: inner.x, y: inner.y, width: programX - SIDE_GAP - inner.x, height: inner.height },
    program: { x: programX, y: top, width: programWidth, height }
  }
}
