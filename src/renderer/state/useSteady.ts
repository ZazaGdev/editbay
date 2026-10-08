import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * A function that keeps one identity for as long as the component is there,
 * and always does what the latest `fn` given to it does.
 *
 * For a handler passed to a memoised child. A handler written inline is new on
 * every render, so the child would render again on every tick of the playhead
 * for nothing; wrapped in `useCallback`, it would go stale the moment what it
 * reads changed. This is neither. It is for handlers called from events, never
 * during a render, which would see the `fn` of the render before.
 */
export function useSteady<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn)
  useLayoutEffect(() => {
    latest.current = fn
  })
  return useCallback((...args: A) => latest.current(...args), [])
}
