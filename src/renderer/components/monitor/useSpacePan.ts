/**
 * Space held over a zoomed view of the monitor turns a left drag into a pan
 * (task 53). Space is also play and pause: let go without a drag and it plays
 * or pauses as it always did, only on letting go rather than on pressing.
 */

import { useEffect, useRef, useState } from 'react'
import { isTypingTarget } from '../../app/fields'

/** Marks the Space put back for the shortcuts, so it is not held a second time. */
const REPLAYED = Symbol('space replayed')

export function useSpacePan(zoomedUnder: (x: number, y: number) => boolean): {
  held: boolean
  /** A pan began while Space was held: letting go of it then neither plays nor pauses. */
  used: () => void
} {
  const [held, setHeld] = useState(false)
  const state = useRef({ held: false, used: false, x: -1, y: -1 })
  const latest = useRef(zoomedUnder)
  latest.current = zoomedUnder
  useEffect(() => {
    const move = (e: PointerEvent): void => {
      state.current.x = e.clientX
      state.current.y = e.clientY
    }
    const down = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || (e as KeyboardEvent & { [REPLAYED]?: boolean })[REPLAYED]) return
      const s = state.current
      if (!s.held) {
        if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || isTypingTarget(e.target) || !latest.current(s.x, s.y)) return
        s.held = true
        s.used = false
        setHeld(true)
      }
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const up = (e: KeyboardEvent): void => {
      const s = state.current
      if (e.code !== 'Space' || !s.held) return
      s.held = false
      setHeld(false)
      if (s.used) return
      const again = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true })
      Object.assign(again, { [REPLAYED]: true })
      document.body.dispatchEvent(again)
    }
    const lost = (): void => {
      state.current.held = false
      setHeld(false)
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', lost)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', lost)
    }
  }, [])
  return {
    held,
    used: () => {
      state.current.used = true
    }
  }
}
