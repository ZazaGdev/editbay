/**
 * The undo history: the documents to go back to and forward to again, the
 * newest last. Pure, so it can be tested on its own (audit 2026-10-01); the
 * window keeps one and sends the document a step lands on to main.
 */
export interface History<T> {
  past: readonly T[]
  future: readonly T[]
}

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] }
}

/** An edit made from `before`: it can be gone back to, and nothing undone is offered again. At most `max` are kept. */
export function recorded<T>(h: History<T>, before: T, max: number): History<T> {
  return { past: [...h.past, before].slice(-max), future: [] }
}

/** One step back from `now`: where it lands, and the history after it. Null with nothing to undo. */
export function stepBack<T>(h: History<T>, now: T): { to: T; history: History<T> } | null {
  const to = h.past.at(-1)
  if (to === undefined) return null
  return { to, history: { past: h.past.slice(0, -1), future: [...h.future, now] } }
}

/** One step forward again from `now`: where it lands, and the history after it. Null with nothing to redo. */
export function stepForward<T>(h: History<T>, now: T): { to: T; history: History<T> } | null {
  const to = h.future.at(-1)
  if (to === undefined) return null
  return { to, history: { past: [...h.past, now], future: h.future.slice(0, -1) } }
}
