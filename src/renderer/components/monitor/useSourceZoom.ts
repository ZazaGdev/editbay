/**
 * The Source view zoomed in on its recording with the wheel, and panned with a drag.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { PlayPosition } from '../../../shared/playback'
import { fitInBox } from '../../../shared/crop-geometry'
import type { MonitorBox } from '../../../shared/monitor-layout'
import { WHEEL_ZOOM, panBy, zoomAt, zoomedFit, type SourceZoom } from '../../../shared/source-zoom'
import type { HtmlVideoEngine } from '../../preview/htmlVideo'

export function useSourceZoom({
  at,
  source,
  sourceSize,
  stageRef,
  engineRef
}: {
  at: PlayPosition | null
  source: MonitorBox | null
  sourceSize: { w: number; h: number } | null
  stageRef: RefObject<HTMLDivElement | null>
  engineRef: RefObject<HtmlVideoEngine | null>
}) {
  // The Source view zoomed in on the recording it shows, which the wheel
  // zooms about the pointer and a drag pans. Kept while the Source view shows
  // the same recording, fitted again when it shows another.
  const [zoomed, setZoomed] = useState<{ mediaId: string; zoom: SourceZoom } | null>(null)
  const shownMedia = at?.media.id ?? null
  useEffect(() => {
    setZoomed((z) => (z && z.mediaId !== shownMedia ? null : z))
  }, [shownMedia])
  const zoom = zoomed && shownMedia === zoomed.mediaId ? zoomed.zoom : null
  const sourceFit = source && sourceSize ? fitInBox(sourceSize.w, sourceSize.h, source.width, source.height) : null
  const shownFit = sourceFit && source && sourceSize ? zoomedFit(sourceFit, source, sourceSize, zoom) : null
  const zoomedPath = zoom && at ? at.media.playablePath : null
  useEffect(() => {
    engineRef.current?.setSourceZoom(zoom && zoomedPath ? { path: zoomedPath, zoom } : null)
  }, [zoom, zoomedPath])

  /** A button pressed in the Source view and not yet let go: a crop drag or a pan under way. */
  const pressed = useRef(false)
  useEffect(() => {
    const letGo = (): void => {
      pressed.current = false
    }
    window.addEventListener('pointerup', letGo)
    window.addEventListener('blur', letGo)
    return () => {
      window.removeEventListener('pointerup', letGo)
      window.removeEventListener('blur', letGo)
    }
  }, [])

  // The wheel over the Source view zooms it; over the rest of the monitor it
  // does nothing, and never zooms the whole window, as Ctrl+wheel would.
  const onWheel = useRef<(e: WheelEvent) => void>(() => undefined)
  onWheel.current = (e: WheelEvent): void => {
    if (e.ctrlKey) e.preventDefault()
    const stage = stageRef.current
    if (!stage || !source || !sourceFit || !sourceSize || !at) return
    const box = stage.getBoundingClientRect()
    const pointer = { x: e.clientX - box.left - source.x, y: e.clientY - box.top - source.y }
    if (pointer.x < 0 || pointer.y < 0 || pointer.x > source.width || pointer.y > source.height) return
    e.preventDefault()
    // Not while a button is held: a crop drag or a pan under way works from
    // where it began at the zoom it began at, and would jump.
    if (e.buttons !== 0 || pressed.current) return
    // A notch is 100 pixels of scroll; a touchpad sends many small ones.
    const lines = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
    const factor = Math.pow(WHEEL_ZOOM, Math.max(-3, Math.min(3, -lines / 100)))
    const next = zoomAt(sourceFit, source, sourceSize, zoom, pointer, factor)
    setZoomed(next ? { mediaId: at.media.id, zoom: next } : null)
  }
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const wheel = (e: WheelEvent): void => onWheel.current(e)
    stage.addEventListener('wheel', wheel, { passive: false })
    return () => stage.removeEventListener('wheel', wheel)
  }, [])

  /** A drag that pans the zoomed Source view, from where the pointer went down. */
  const startPan = (e: ReactPointerEvent): void => {
    if (!zoom || !sourceFit || !source || !sourceSize || !at) return
    e.preventDefault()
    const from = { x: e.clientX, y: e.clientY, zoom, fit: sourceFit, view: source, size: sourceSize, mediaId: at.media.id }
    const move = (ev: PointerEvent): void => {
      const next = panBy(from.fit, from.view, from.size, from.zoom, ev.clientX - from.x, ev.clientY - from.y)
      if (next) setZoomed({ mediaId: from.mediaId, zoom: next })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return { zoom, setZoomed, shownFit, pressed, startPan }
}
