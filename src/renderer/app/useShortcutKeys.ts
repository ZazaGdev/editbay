/**
 * The keys and mouse buttons that run actions, heard on the window, and a
 * button clicked with the mouse letting go of the focus.
 */

import { useEffect, type RefObject } from 'react'
import { comboFromEvent, comboFromMouse } from '../../shared/keymap'
import type { KeymapState } from '../state/useKeymap'
import { isControlKey, isTypingTarget } from './fields'
import type { RunAction } from './app-state'

export function useShortcutKeys(latest: RefObject<{ run: RunAction; blocked: boolean; lookup: KeymapState['lookup'] }>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const now = latest.current
      // A window over the editor takes keys for itself while it is open.
      if (now.blocked) return
      if (isTypingTarget(e.target) || isControlKey(e)) return
      const combo = comboFromEvent(e)
      const action = combo ? now.lookup.get(combo) : undefined
      if (!action) return
      e.preventDefault()
      now.run(action, e.shiftKey, { code: e.code, repeat: e.repeat })
    }
    window.addEventListener('keydown', onKey)
    // The middle and side buttons of a mouse run what they are put on, as a
    // key does. Heard as they bubble up, so what uses one itself, as the
    // middle button pans a zoomed Source view, keeps it.
    const onButton = (e: PointerEvent): void => {
      const now = latest.current
      if (now.blocked) return
      const combo = comboFromMouse(e)
      const action = combo ? now.lookup.get(combo) : undefined
      if (!action) return
      e.preventDefault()
      now.run(action, e.shiftKey)
    }
    // A side button would otherwise go back or forward, and the middle one
    // start scrolling by itself, when it is a shortcut.
    const quiet = (e: MouseEvent): void => {
      const combo = comboFromMouse(e)
      if (combo && latest.current.lookup.has(combo)) e.preventDefault()
    }
    window.addEventListener('pointerdown', onButton)
    window.addEventListener('mousedown', quiet)
    window.addEventListener('mouseup', quiet)
    window.addEventListener('auxclick', quiet)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onButton)
      window.removeEventListener('mousedown', quiet)
      window.removeEventListener('mouseup', quiet)
      window.removeEventListener('auxclick', quiet)
    }
  }, [])

  // A button clicked with the mouse gives up focus, so Enter does not press it
  // again. One reached with Tab keeps it: a click made with the keyboard has
  // no click count.
  useEffect(() => {
    const letGo = (e: MouseEvent): void => {
      if (e.detail === 0) return
      const button = e.target instanceof Element ? e.target.closest('button') : null
      if (button) button.blur()
    }
    window.addEventListener('click', letGo, true)
    return () => window.removeEventListener('click', letGo, true)
  }, [])
}
