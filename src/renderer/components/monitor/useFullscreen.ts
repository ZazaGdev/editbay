/**
 * The monitor on the whole screen, and Escape leaving it.
 */

import { useEffect, useRef, type RefObject } from 'react'
import type { MonitorProps } from './monitor-props'

export function useFullscreen(props: Pick<MonitorProps, 'fullscreen' | 'onFullscreenChange'>, stageRef: RefObject<HTMLDivElement | null>): void {
  // Full screen is the stage on its own, whichever view it shows. Leaving it by
  // Escape, which the window cannot see, is reported back.
  // Going on to the whole screen takes a moment, and F may be pressed again
  // meanwhile: once it gets there, it leaves again unless it is still wanted.
  const onFullscreenChange = props.onFullscreenChange
  const wanted = useRef(props.fullscreen)
  wanted.current = props.fullscreen
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    if (props.fullscreen && document.fullscreenElement !== stage) {
      void stage.requestFullscreen().catch(() => onFullscreenChange(false))
    }
    if (!props.fullscreen && document.fullscreenElement === stage) void document.exitFullscreen().catch(() => undefined)
  }, [props.fullscreen, onFullscreenChange])
  useEffect(() => {
    const changed = (): void => {
      const stage = stageRef.current
      if (document.fullscreenElement === stage && !wanted.current) void document.exitFullscreen().catch(() => undefined)
      else if (document.fullscreenElement !== stage) onFullscreenChange(false)
    }
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [onFullscreenChange])
  // Escape leaves full screen, and only that: the browser may or may not see it
  // first, so the monitor takes it too while it is on the whole screen.
  useEffect(() => {
    if (!props.fullscreen) return
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onFullscreenChange(false)
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [props.fullscreen, onFullscreenChange])
}
