/**
 * Scrolling the timeline while a drag, a trim, a scrub or a source from the
 * bin is held near its left or right edge, and what the overview strip reads
 * and moves.
 */

import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useSteady } from '../../state/useSteady'

/** How near its left or right edge a drag scrolls the timeline, in pixels, and how fast at most, in pixels a frame of the screen. */
const EDGE_PX = 40
const EDGE_SPEED = 18

export function useEdgeScroll(scroller: RefObject<HTMLDivElement | null>, scrolledTo: RefObject<number>) {
  /**
   * Scrolling the timeline while a drag is held near its left or right edge:
   * where the pointer is, what to do each time it has scrolled so the drag
   * lands where the pointer now points, and, for a source dragged from the
   * bin, whose drag gives no word when it stops, until when to go on.
   */
  const edge = useRef<{ x: number; raf: number; scrolled: () => void; until: number; band: number } | null>(null)
  const edgeStep = (): void => {
    const e = edge.current
    const el = scroller.current
    if (!e || !el) return
    const box = el.getBoundingClientRect()
    const into = e.x < box.left + e.band ? e.x - (box.left + e.band) : e.x > box.right - e.band ? e.x - (box.right - e.band) : 0
    if (into === 0 || performance.now() > e.until) {
      e.raf = 0
      return
    }
    const before = el.scrollLeft
    // Faster the further into the edge, up to a steady pace.
    el.scrollLeft = before + Math.sign(into) * Math.min(EDGE_SPEED, Math.max(2, Math.abs(into) / 2))
    scrolledTo.current = el.scrollLeft
    if (el.scrollLeft !== before) e.scrolled()
    e.raf = requestAnimationFrame(edgeStep)
  }
  /**
   * A drag's pointer is at `x`: scroll while it stays near an edge, telling
   * `scrolled` each time.
   *
   * `band` is how near the edge counts as near it. A clip being dragged starts
   * scrolling before the pointer reaches the edge, because the clip under it
   * needs somewhere to go. A scrub waits until the pointer is past the edge
   * altogether: the playhead follows the pointer exactly, so a band would move
   * the timeline under a pointer that had not left the part in view.
   */
  const followEdge = (x: number, scrolled: () => void, opts: { forMs?: number; band?: number } = {}): void => {
    const until = performance.now() + (opts.forMs ?? Infinity)
    const band = opts.band ?? EDGE_PX
    const e = edge.current ?? (edge.current = { x, raf: 0, scrolled, until, band })
    e.x = x
    e.scrolled = scrolled
    e.until = until
    e.band = band
    if (!e.raf) e.raf = requestAnimationFrame(edgeStep)
  }
  const stopEdge = (): void => {
    if (edge.current?.raf) cancelAnimationFrame(edge.current.raf)
    edge.current = null
  }
  useEffect(() => stopEdge, [])
  const followSteady = useSteady(followEdge)
  const stopSteady = useSteady(stopEdge)
  /**
   * What a trim needs to scroll the timeline as it goes, and to allow for it.
   * The same object on every render, so it never makes a clip draw again.
   */
  const edgeScroll = useMemo(
    () => ({
      left: (): number => scroller.current?.scrollLeft ?? 0,
      follow: (x: number, scrolled: () => void): void => followSteady(x, scrolled),
      stop: stopSteady
    }),
    [followSteady, stopSteady]
  )
  /** The same for a scrub, which only scrolls once the pointer is past the edge. */
  const scrubScroll = {
    follow: (x: number, scrolled: () => void): void => followEdge(x, scrolled, { band: 0 }),
    stop: stopEdge
  }
  /**
   * What the overview strip reads and moves: the scroller's place and width,
   * and where to put it. Held in a ref so the strip's own frame loop is not
   * given a new object on every render.
   */
  const overviewScroller = useRef({
    element: (): HTMLElement | null => scroller.current,
    left: (): number => scroller.current?.scrollLeft ?? 0,
    width: (): number => scroller.current?.clientWidth ?? 0,
    scrollTo: (px: number): void => {
      const el = scroller.current
      if (!el) return
      el.scrollLeft = px
      scrolledTo.current = el.scrollLeft
    }
  })

  return { followEdge, stopEdge, edgeScroll, scrubScroll, overviewScroller }
}
