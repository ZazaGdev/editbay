/**
 * Which Inspector section is being dragged by its heading, if any (plan 92).
 * The drop strips at the ends of the timeline show while one is, and the
 * heading that is picked up is in a different part of the window from them,
 * so this is kept outside both.
 */

import { useSyncExternalStore } from 'react'

let dragged: string | null = null
const listeners = new Set<() => void>()

function set(name: string | null): void {
  if (dragged === name) return
  dragged = name
  for (const l of listeners) l()
}

export const startSectionDrag = (name: string): void => set(name)
export const endSectionDrag = (): void => set(null)

export function useDraggedSection(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => dragged
  )
}
