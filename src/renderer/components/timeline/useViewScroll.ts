/**
 * The part of the timeline that scrolls sideways: what of it is drawn, the
 * playhead kept in view, a new zoom kept about the playhead or the pointer,
 * and the wheel over it.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ZOOM_LEVELS, drawnSpan, type PxSpan } from '../../../shared/timeline-layout'
import { zoomKey } from '../../../shared/system'
import type { TimelineProps } from './props'

/** How near the right edge the playhead comes while playing before the timeline scrolls on, in pixels. */
const FOLLOW_MARGIN = 16

export function useViewScroll(props: TimelineProps, pxPerFrame: number) {
  /** The part of the timeline that scrolls sideways, which keeps the playhead in view. */
  const scroller = useRef<HTMLDivElement>(null)
  /** The ruler and the blank corner beside it, held at the top while the tracks scroll up and down. */
  const rulerPin = useRef<HTMLDivElement>(null)
  const cornerPin = useRef<HTMLDivElement>(null)
  /** Where it was scrolled to, kept as it scrolls: a zoom changes its width before it can be read. */
  const scrolledTo = useRef(0)
  /** The zoom it was last drawn at, so a new zoom keeps the playhead where it was on screen. */
  const drawnAt = useRef(pxPerFrame)
  /**
   * The playhead being dragged along the ruler. The timeline stays where it is
   * meanwhile: the ruler reads frames from where it is on screen, so scrolling
   * it under the pointer would send the playhead on again and again.
   */
  const scrubbing = useRef(false)
  /** A zoom by Ctrl+wheel: the frame under the pointer, and where the pointer is in the view, to keep it there. */
  const anchor = useRef<{ frame: number; x: number } | null>(null)
  /**
   * The zoom the last Ctrl+wheel asked for, until it is drawn. A quick turn of
   * the wheel sends several notches before the timeline draws again, and each
   * goes on from this rather than all starting from the zoom on screen.
   */
  const asked = useRef<number | null>(null)
  /**
   * The frame a run of Ctrl+wheel notches keeps under the pointer, and where
   * the last of them left the view scrolled. Held for as long as the pointer
   * and the view stay where the notches left them, rather than read again from
   * the scroll on every notch, where each rounding to a whole pixel would add
   * up (task 125).
   */
  const gesture = useRef<{ frame: number; x: number; scroll: number | null } | null>(null)
  /**
   * The view zoomed by Ctrl+wheel while it plays, or moved away from the
   * playhead by the wheel: it is left there, rather than pulled back to the
   * playhead on its next frame, which jumped a zoom about the pointer minutes
   * back (tasks 125 and 1099). Until playback stops or starts again.
   */
  const leftBehind = useRef(false)
  const pxPerFrameRef = useRef(pxPerFrame)
  pxPerFrameRef.current = pxPerFrame
  const playheadOffScreen = (el: HTMLDivElement): boolean => {
    const x = props.playhead.get() * pxPerFrameRef.current
    return x < el.scrollLeft || x > el.scrollLeft + el.clientWidth
  }

  /**
   * The stretch of the timeline near the part in view, in pixels. The ruler's
   * labels and the clips' filmstrips are drawn there and nowhere else, since a
   * long sequence zoomed in has thousands of each and a screenful to see. It
   * moves in whole steps, so scrolling draws the clips again only now and then.
   */
  const [drawn, setDrawn] = useState<PxSpan>(() => drawnSpan(0, 0))
  const seeDrawn = (): void => {
    const el = scroller.current
    if (!el) return
    const next = drawnSpan(el.scrollLeft, el.clientWidth)
    setDrawn((was) => (was.from === next.from && was.to === next.to ? was : next))
  }
  // Measured once there is a view to measure, and again whenever it is resized.
  useLayoutEffect(() => {
    seeDrawn()
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => seeDrawn())
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  // Zooming keeps the playhead where it is on screen when it is in view, and
  // brings it to the middle otherwise, rather than zooming about the start.
  // Ctrl+wheel keeps the frame under the pointer where it is instead.
  useLayoutEffect(() => {
    const el = scroller.current
    const before = drawnAt.current
    drawnAt.current = pxPerFrame
    asked.current = null
    if (!el || before === pxPerFrame) return
    const about = anchor.current
    anchor.current = null
    if (about) {
      const want = about.frame * pxPerFrame - about.x
      el.scrollLeft = Math.max(0, want)
      scrolledTo.current = el.scrollLeft
      if (gesture.current) {
        gesture.current.scroll = el.scrollLeft
        // Against either end, the view could not go far enough: what is under
        // the pointer now is what the next notches keep. Holding on to the
        // moment it could not keep slid the view minutes away from the pointer
        // as it zoomed back in (task 1099).
        if (Math.abs(el.scrollLeft - want) > 1) gesture.current.frame = (el.scrollLeft + about.x) / pxPerFrame
      }
      seeDrawn()
      return
    }
    const at = props.playhead.get()
    const wasAt = at * before - scrolledTo.current
    const keepAt = wasAt >= 0 && wasAt <= el.clientWidth ? wasAt : el.clientWidth / 2
    el.scrollLeft = Math.max(0, at * pxPerFrame - keepAt)
    scrolledTo.current = el.scrollLeft
    // Now rather than when the scroll event comes, so the new part is drawn before it is seen.
    seeDrawn()
    // Only on a new zoom: where the playhead is then is read, not followed.
  }, [pxPerFrame])

  // The playhead kept in view: moved to a frame outside the part in view, as
  // it plays on past the right edge or jumps, the timeline scrolls so it is a
  // tenth of the way in. Scrolling by hand while it stays still is left alone,
  // and so is a scrub along the ruler. Told by the playhead's store, so a tick
  // that leaves it in view draws nothing of the timeline again.
  const playing = useRef(props.playing)
  playing.current = props.playing
  useLayoutEffect(() => {
    const store = props.playhead
    const follow = (): void => {
      const el = scroller.current
      if (!el || scrubbing.current || (playing.current && leftBehind.current)) return
      const x = store.get() * pxPerFrameRef.current
      const margin = playing.current ? FOLLOW_MARGIN : 0
      if (x >= el.scrollLeft && x <= el.scrollLeft + el.clientWidth - margin) return
      el.scrollLeft = Math.max(0, x - el.clientWidth / 10)
      scrolledTo.current = el.scrollLeft
      seeDrawn()
    }
    follow()
    return store.subscribe(follow)
  }, [props.playhead])
  // Playback stopped or started again: the view follows the playhead again.
  useEffect(() => {
    leftBehind.current = false
  }, [props.playing])

  /**
   * The wheel over the timeline.
   *
   * Ctrl zooms it smoothly about the pointer, a third of a step a notch, and
   * never the whole window, as it would otherwise. Anything else scrolls it
   * sideways, because sideways is the only way it goes: it never scrolls up and
   * down, so a wheel left to the browser did nothing at all over it.
   */
  const onWheel = useRef<(e: WheelEvent) => void>(() => undefined)
  onWheel.current = (e: WheelEvent): void => {
    const el = scroller.current
    if (!el) return
    const lines = (d: number): number => (e.deltaMode === 1 ? d * 33 : d)
    if (zoomKey(e)) {
      if (!props.onZoomTo) return
      e.preventDefault()
      const from = asked.current ?? props.zoom
      const next = Math.max(0, Math.min(ZOOM_LEVELS - 1, from - lines(e.deltaY) / 300))
      if (next === from) return
      const x = e.clientX - el.getBoundingClientRect().left
      const run = gesture.current
      // The same run while the pointer stays put and nothing else has scrolled
      // the view since: a notch the timeline has not drawn yet, or the view
      // where the last notch left it.
      const same = run !== null && Math.abs(run.x - x) < 1 && (asked.current !== null || run.scroll === el.scrollLeft)
      const frame = same ? run.frame : (el.scrollLeft + x) / pxPerFrame
      gesture.current = { frame, x, scroll: same ? run.scroll : null }
      anchor.current = { frame, x }
      // While it plays the view stays where the zoom puts it, the playhead on
      // screen or not: following it off the right edge then turned the view a
      // whole screen on in the middle of the zoom, minutes when zoomed out (task 1099).
      if (props.playing) leftBehind.current = true
      asked.current = next
      props.onZoomTo(next)
      return
    }
    gesture.current = null
    // A trackpad's own sideways swipe, or the wheel, whichever moved further.
    const by = Math.abs(lines(e.deltaX)) > Math.abs(lines(e.deltaY)) ? lines(e.deltaX) : lines(e.deltaY)
    if (by === 0) return
    e.preventDefault()
    el.scrollLeft += by
    scrolledTo.current = el.scrollLeft
    if (props.playing && playheadOffScreen(el)) leftBehind.current = true
  }
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const wheel = (e: WheelEvent): void => onWheel.current(e)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  return { scroller, rulerPin, cornerPin, scrolledTo, scrubbing, drawn, seeDrawn }
}
