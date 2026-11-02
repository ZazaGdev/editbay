import { useSyncExternalStore } from 'react'

/**
 * Task 116: the tool chosen in the command search that is waiting for a clip
 * or an asset to be clicked, by its id, or null when nothing is.
 */

let picking: string | null = null
const listeners = new Set<() => void>()

export function startPicking(toolId: string | null): void {
  if (picking === toolId) return
  picking = toolId
  for (const l of listeners) l()
}

export function usePicking(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => picking
  )
}
