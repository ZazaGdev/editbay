/**
 * The format painter: a clip's framing taken up and given to the picture
 * clips pressed next.
 */

import { useCallback, useEffect, useState } from 'react'
import { framingOf, framingRefusal, type Framing } from '../../shared/project'
import type { Painting } from '../components/Inspector'
import { showToast } from '../state/toasts'
import type { AppLocals, EditClip } from './app-state'

export function usePainter({ timeline, selected, editClip }: Pick<AppLocals, 'timeline' | 'selected'> & Pick<EditClip, 'editClip'>) {
  /**
   * The format painter: a clip's framing taken up from the Inspector, and
   * given to the next picture clip pressed on the timeline, or to every one
   * pressed until Esc when it was double clicked. A third way to paste a
   * framing, one press rather than copy, select and paste.
   */
  const [painter, setPainter] = useState<{ framing: Framing; how: Exclude<Painting, null> } | null>(null)
  const paint = useCallback(
    (how: Painting) => {
      const framing = how && timeline && selected ? framingOf(timeline, selected) : null
      setPainter(how && framing ? { framing, how } : null)
    },
    [timeline, selected]
  )
  const paintOnto = useCallback(
    (clipId: string) => {
      if (!painter || !timeline) return
      const refused = framingRefusal(timeline, clipId, painter.framing)
      if (refused) {
        showToast({ kind: 'refused', text: refused })
        return
      }
      editClip({ kind: 'setFraming', clipId, framing: painter.framing })
      if (painter.how === 'once') setPainter(null)
    },
    [painter, timeline, editClip, showToast]
  )

  // Esc puts the painter down before it does anything else, in the capture
  // phase so it never also clears the selection the painter was armed from.
  useEffect(() => {
    if (!painter) return
    const down = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      setPainter(null)
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [painter])

  return { painter, setPainter, paint, paintOnto }
}
