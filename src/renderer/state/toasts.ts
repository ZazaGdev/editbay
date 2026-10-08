import { useSyncExternalStore } from 'react'

/**
 * Short notices for things worth confirming: a save, or an edit that changed
 * many clips at once, with an Undo for it. They go by themselves, unlike
 * main's notices, which report something that went wrong and stay until read.
 */

export interface Toast {
  id: number
  text: string
  /** Offered while the edit it undoes is still the last one. */
  undo?: () => void
  /** Something else to do about it, such as opening what it is about. */
  action?: { label: string; run: () => void }
  /**
   * Stays until the next edit rather than going after a few seconds: for
   * news that may arrive while you are away, such as an export finishing.
   */
  sticky?: boolean
  /** Stays through edits too, until dismissed: news about something outside the project. */
  lasting?: boolean
  /** What the button that puts a notice away says. Given, a notice that fades has the button too. */
  dismissLabel?: string
  /** Names the kind of notice for the tests. */
  kind: string
}

const TOAST_MS = 5000
const MAX_TOASTS = 3

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function changed(): void {
  for (const l of listeners) l()
}

export function showToast(t: Omit<Toast, 'id'>): void {
  const id = nextId++
  // A newer Undo replaces an older one: only the last edit can be undone from here.
  const kept = t.undo ? toasts.filter((x) => !x.undo) : toasts
  let next = [...kept, { ...t, id }]
  // Too many: the oldest goes, but one that waits for an answer goes last.
  while (next.length > MAX_TOASTS) {
    const i = next.findIndex((x) => !x.lasting)
    next = next.filter((_, j) => j !== (i < 0 ? 0 : i))
  }
  toasts = next
  changed()
  if (!t.sticky) window.setTimeout(() => dismissToast(id), TOAST_MS)
}

export function dismissToast(id: number): void {
  if (!toasts.some((t) => t.id === id)) return
  toasts = toasts.filter((t) => t.id !== id)
  changed()
}

/**
 * Another edit, an undo or a redo happened. What was said is no longer news,
 * and an Undo on offer would now undo something else.
 */
export function editMade(): void {
  const kept = toasts.filter((t) => t.lasting)
  if (kept.length === toasts.length) return
  toasts = kept
  changed()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The notices on screen, oldest first. */
export function currentToasts(): Toast[] {
  return toasts
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, currentToasts)
}
