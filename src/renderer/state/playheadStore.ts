import { useSyncExternalStore } from 'react'

/**
 * The playhead, for the few things in a memoised panel that follow it, as the
 * Zoom group does. Handing the frame down as a prop would draw the whole
 * Inspector again on every frame of playback; this way only what reads it is
 * drawn again, and only when what it reads from it has changed.
 */
export interface PlayheadStore {
  get: () => number
  set: (frame: number) => void
  subscribe: (listener: () => void) => () => void
}

export function makePlayheadStore(frame = 0): PlayheadStore {
  let now = frame
  const listeners = new Set<() => void>()
  return {
    get: () => now,
    set: (next) => {
      if (next === now) return
      now = next
      for (const l of [...listeners]) l()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

/**
 * What a component reads from the playhead, drawn again only when that
 * changes. `read` must give a number, a string or another value that is the
 * same (`Object.is`) while it means the same.
 */
export function usePlayheadRead<T>(store: PlayheadStore | undefined, read: (frame: number) => T): T {
  return useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    () => read(store ? store.get() : 0)
  )
}

const noSubscribe = (): (() => void) => () => undefined
