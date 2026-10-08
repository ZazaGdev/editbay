import { allClips, timelineDuration, type Timeline } from './project'
import { spanEnd } from './tracks'

/**
 * The cuts of a sequence, which Up and Down jump between: every frame where a
 * clip starts or ends, on any track, and the sequence's start and end. Pure,
 * so where a jump lands is tested without a window.
 */

/** Every cut, in order, each once. */
export function cutPoints(t: Timeline): number[] {
  const points = new Set([0, timelineDuration(t)])
  for (const c of allClips(t)) {
    points.add(c.timelineStart)
    points.add(spanEnd(c))
  }
  return [...points].sort((a, b) => a - b)
}

/** The last cut before `frame`, or the start. */
export function previousCut(t: Timeline, frame: number): number {
  return cutPoints(t).filter((p) => p < frame).pop() ?? 0
}

/** The first cut after `frame`, or the end. */
export function nextCut(t: Timeline, frame: number): number {
  return cutPoints(t).find((p) => p > frame) ?? timelineDuration(t)
}
