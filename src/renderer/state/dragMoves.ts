import type { ProjectEdit } from '../../shared/types'

/**
 * What says which thing an edit acts on, as opposed to what it sets it to.
 * Two movements of one drag agree on all of these and differ only in where
 * the thing was dragged to.
 */
const TARGET_KEYS = ['kind', 'sequenceId', 'clipId', 'mediaId', 'captionId', 'markerId', 'trackId', 'picture', 'edge', 'side', 'track', 'alone', 'closeUp'] as const

/**
 * Whether a later movement of a drag can stand in for an earlier one still
 * waiting to be sent: the same kind of edit on the same thing. Every edit a
 * drag sends says where the thing is now, never how far it moved, so the
 * later one alone leaves the document as the two in turn would. Without
 * this, a slow edit on a long project queues every movement of the mouse and
 * the drag carries on long after it is let go.
 */
export function replacesMove(waiting: ProjectEdit, next: ProjectEdit): boolean {
  const a = waiting as unknown as Record<string, unknown>
  const b = next as unknown as Record<string, unknown>
  // A change of some settings only, as a picture in picture's: the same ones.
  const changed = (x: unknown): string => (x && typeof x === 'object' ? Object.keys(x).sort().join() : '')
  return TARGET_KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k])) && changed(a.change) === changed(b.change)
}
