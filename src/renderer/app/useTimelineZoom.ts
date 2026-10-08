/**
 * Zooming the timeline: by steps, to any zoom, and to fit the whole edit.
 */

import { useCallback } from 'react'
import { ZOOM_LEVELS } from '../../shared/timeline-layout'
import { fitZoomFor } from '../../shared/overview'
import type { AppLocals } from './app-state'

export function useTimelineZoom({ timeline, setZoom }: Pick<AppLocals, 'timeline' | 'setZoom'>) {
  /** The zoom buttons and keys: step by step, to the next whole step from one Ctrl+wheel left between two. */
  const zoomBy = useCallback((delta: number) => {
    setZoom((z) => Math.max(0, Math.min(ZOOM_LEVELS - 1, delta > 0 ? Math.floor(z + 1e-9) + delta : Math.ceil(z - 1e-9) + delta)))
  }, [])
  /** Ctrl+wheel: any zoom from the first step to the last. */
  const zoomTo = useCallback((z: number) => setZoom(Math.max(0, Math.min(ZOOM_LEVELS - 1, z))), [])

  /**
   * Fit: the whole edit on screen at once, and back to its start.
   *
   * The width it fits into is the timeline's own scroller, measured rather
   * than passed down: the zoom lives here, the pixels live there, and a prop
   * for one of them would have to be kept in step with a resize.
   */
  const fitTimeline = useCallback(() => {
    if (!timeline) return
    const el = document.querySelector('[data-testid="timeline-scroll"]')
    const width = el instanceof HTMLElement ? el.clientWidth : 0
    if (width <= 0) return
    zoomTo(fitZoomFor(timeline, width))
    if (el instanceof HTMLElement) el.scrollLeft = 0
  }, [timeline, zoomTo])

  return { zoomBy, zoomTo, fitTimeline }
}
