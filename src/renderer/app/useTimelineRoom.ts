/**
 * The room the timeline's tracks have to grow into, measured from the
 * window and measured again as it is resized.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { PICTURE_MIN, TIMELINE_LEAVES, TIMELINE_MIN } from '../state/useSettings'
import type { AppLocals } from './app-state'

export function useTimelineRoom({ timelineTracks }: Pick<AppLocals, 'timelineTracks'>) {
  /**
   * The tallest the tracks may be dragged: as tall as they are now, and all
   * but `PICTURE_MIN` of the monitor's picture on top. Measured, since what is
   * above and below them changes with the window. Null until it has been.
   */
  const [timelineRoom, setTimelineRoom] = useState<number | null>(null)
  const timelineRoomNow = useRef<number | null>(null)
  const measureTimelineRoom = useCallback((): void => {
    const tracks = timelineTracks.current?.getBoundingClientRect().height
    const stage = document.querySelector('[data-testid="monitor-stage"]')?.getBoundingClientRect().height
    if (tracks === undefined || stage === undefined) return
    const room = Math.max(TIMELINE_MIN, Math.round(tracks + stage - PICTURE_MIN))
    timelineRoomNow.current = room
    setTimelineRoom(room)
  }, [])
  // A smaller window has less to give: measured again once it has been resized.
  useEffect(() => {
    let frame: number | null = null
    const resized = (): void => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        measureTimelineRoom()
      })
    }
    window.addEventListener('resize', resized)
    return () => {
      window.removeEventListener('resize', resized)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [measureTimelineRoom])
  /** A height for the tracks, kept between the least they show and the room there is. */
  const clampTracks = (h: number): number =>
    Math.round(Math.max(TIMELINE_MIN, Math.min(timelineRoomNow.current ?? window.innerHeight - TIMELINE_LEAVES, h)))

  return { timelineRoom, measureTimelineRoom, clampTracks }
}
