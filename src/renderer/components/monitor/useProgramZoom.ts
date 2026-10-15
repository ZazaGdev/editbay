/**
 * The Output view zoomed in with Ctrl and the wheel, and panned with a drag
 * (task 53). Only the view: the frame is drawn larger and cut to the view,
 * and nothing in the project changes. Fitted again when Reset is pressed.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { Fit } from '../../../shared/crop-geometry'
import type { MonitorBox } from '../../../shared/monitor-layout'
import { MAX_OUTPUT_ZOOM, WHEEL_ZOOM, panBy, zoomAt, zoomedFit, type SourceZoom } from '../../../shared/source-zoom'
import { zoomKey } from '../../../shared/system'

/** The view's whole frame as a picture fitted to it: the view itself. */
function whole(box: MonitorBox): { fit: Fit; size: { w: number; h: number } } {
  return { fit: { scale: 1, width: box.width, height: box.height, offsetX: 0, offsetY: 0 }, size: { w: box.width, h: box.height } }
}

/** How far one wheel event zooms: a notch is 100 pixels of scroll, and a touchpad sends many small ones. */
export function wheelFactor(e: WheelEvent): number {
  const lines = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
  return Math.pow(WHEEL_ZOOM, Math.max(-3, Math.min(3, -lines / 100)))
}

export function useProgramZoom({ program, stageRef }: { program: MonitorBox | null; stageRef: RefObject<HTMLDivElement | null> }) {
  const [zoom, setZoom] = useState<SourceZoom | null>(null)
  /**
   * Where the frame is drawn in the view, larger than it while zoomed: null
   * when fitted. In the view's own pixels, from its top left.
   */
  const shown = zoom && program ? zoomedFit(whole(program).fit, program, whole(program).size, zoom, MAX_OUTPUT_ZOOM) : null

  // Ctrl and the wheel over the Output view zoom it about the pointer; the
  // wheel alone there does what it did before.
  const onWheel = useRef<(e: WheelEvent) => void>(() => undefined)
  onWheel.current = (e: WheelEvent): void => {
    const stage = stageRef.current
    if (!zoomKey(e) || !stage || !program) return
    const box = stage.getBoundingClientRect()
    const pointer = { x: e.clientX - box.left - program.x, y: e.clientY - box.top - program.y }
    if (pointer.x < 0 || pointer.y < 0 || pointer.x > program.width || pointer.y > program.height) return
    e.preventDefault()
    if (e.buttons !== 0) return
    const { fit, size } = whole(program)
    setZoom(zoomAt(fit, program, size, zoom, pointer, wheelFactor(e), MAX_OUTPUT_ZOOM))
  }
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const wheel = (e: WheelEvent): void => onWheel.current(e)
    stage.addEventListener('wheel', wheel, { passive: false })
    return () => stage.removeEventListener('wheel', wheel)
  }, [])

  /** A drag that pans the zoomed Output view, from where the pointer went down. */
  const startPan = (e: ReactPointerEvent): void => {
    if (!zoom || !program) return
    e.preventDefault()
    const from = { x: e.clientX, y: e.clientY, zoom, view: program }
    const move = (ev: PointerEvent): void => {
      const { fit, size } = whole(from.view)
      const next = panBy(fit, from.view, size, from.zoom, ev.clientX - from.x, ev.clientY - from.y, MAX_OUTPUT_ZOOM)
      if (next) setZoom(next)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return { zoom, setZoom, shown, startPan }
}
