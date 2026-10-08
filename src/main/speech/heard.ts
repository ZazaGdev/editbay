import type { Timeline } from '../../shared/project'

/**
 * The sequence as it was when the last listening for captions began. The
 * words come back timed against it, and the window may have cut or moved
 * clips while it listened, so the captions are made on this and then carried
 * to wherever their footage is now. Only the last one is kept: one listening
 * runs at a time.
 */
let last: { id: string; timeline: Timeline } | null = null
let count = 0

/** Keep the sequence about to be listened to, and the id to find it by. */
export function rememberHeard(timeline: Timeline): string {
  count += 1
  const id = `heard-${count}`
  last = { id, timeline }
  return id
}

/** The sequence the words of `id` were heard on, or null once it is no longer kept. */
export function heardTimeline(id: string): Timeline | null {
  return last?.id === id ? last.timeline : null
}
