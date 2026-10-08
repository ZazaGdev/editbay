/**
 * The colours a clip can be marked with, and what to call each.
 *
 * A mark means whatever you decide it means. The names say what the
 * colour looks like rather than what it is for, because a name like "Reshoot"
 * would be wrong for half the marks anyone actually makes.
 *
 * Five, and no more. A list you have to read to use is not a mark.
 */

export interface ClipMark {
  id: string
  name: string
  /** What the band on the clip and the block on the overview strip are drawn in. */
  colour: string
}

export const CLIP_MARKS: readonly ClipMark[] = [
  { id: 'red', name: 'Red', colour: '#E5484D' },
  { id: 'amber', name: 'Amber', colour: '#F5B23D' },
  { id: 'green', name: 'Green', colour: '#4FBF87' },
  { id: 'blue', name: 'Blue', colour: '#4C8DF5' },
  { id: 'purple', name: 'Purple', colour: '#B98CE0' }
]

/** A mark by its id, or null for one that names no colour, including undefined. */
export function markOf(id: unknown): ClipMark | null {
  return CLIP_MARKS.find((m) => m.id === id) ?? null
}

/** What a mark is drawn in, or null when there is no mark. */
export function markColour(id: unknown): string | null {
  return markOf(id)?.colour ?? null
}

/** What a mark is called, or null when there is no mark. */
export function markName(id: unknown): string | null {
  return markOf(id)?.name ?? null
}

/** A stored mark made safe: the id when it names a colour, undefined otherwise. */
export function cleanMark(raw: unknown): string | undefined {
  return markOf(raw)?.id
}
