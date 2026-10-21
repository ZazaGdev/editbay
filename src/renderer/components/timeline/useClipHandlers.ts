/**
 * What every clip on the timeline is given to call: selecting, skimming,
 * trimming, fading and starting a drag, each with one identity for the life
 * of the timeline.
 */

import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { Clip, SoundClip, Timeline as TimelineData } from '../../../shared/project'
import { findClip, newId } from '../../../shared/project'
import { groupedIds } from '../../../shared/groups'
import { captionTargets, snapTargets, spanLength, type Span } from '../../../shared/tracks'
import { useSteady } from '../../state/useSteady'
import type { Drag } from './drag'
import type { TimelineProps } from './props'

export function useClipHandlers({ props, t, total, drag, setDrag, setClosingUp, scroller, allTracks, onV1 }: {
  props: TimelineProps
  t: TimelineData
  total: number
  drag: Drag | null
  setDrag: Dispatch<SetStateAction<Drag | null>>
  setClosingUp: Dispatch<SetStateAction<{ clipId: string; edge: 'start' | 'end'; frame: number; alone: boolean; base: TimelineData } | null>>
  scroller: RefObject<HTMLDivElement | null>
  allTracks: () => Span[][]
  onV1: ReadonlySet<string>
}) {
  /*
   * The handlers every clip is given. Each is told which clip it is about, and
   * each keeps one identity for the life of the timeline, so a clip whose own
   * props are unchanged is not drawn again when the playhead moves.
   */
  const clipSelect = useSteady((clipId: string, alone: boolean, add: boolean): void => props.onSelect(clipId, alone, add))
  // Steady, so the caption track, drawn only when it changes, is not drawn again on every frame.
  const captionPressEmpty = useSteady((frame: number): void => {
    props.onSelect(null, false)
    props.onSeek(Math.min(total, frame))
  })
  // A caption snaps to every clip's edges, the other captions' and the playhead, as a clip does.
  const captionSnaps = useSteady((except: string, edgeAt?: number): number[] =>
    captionTargets(allTracks(), t.captions.clips, props.playhead.get(), except, edgeAt)
  )
  const clipClosingUp = useSteady((clipId: string, on: boolean, trim?: { edge: 'start' | 'end'; frame: number; alone: boolean }): void =>
    setClosingUp((was) => (on && trim ? { clipId, ...trim, base: was?.clipId === clipId ? was.base : t } : null))
  )
  const clipSkim = useSteady((frame: number | null): void => {
    // A drag has the pointer: what it passes over is where the
    // clip is going, not something being looked at.
    if (drag !== null) return
    props.onSkim?.(frame)
  })
  const clipMenu = useSteady((clipId: string, at: { x: number; y: number }): void => props.onClipMenu?.(clipId, at))
  const clipPaint = useSteady((clipId: string): void => props.onPaint?.(clipId))
  const clipKeyframe = useSteady((frame: number): void => props.onSeek(frame))
  const clipTrim = useSteady(
    (clipId: string, edge: 'start' | 'end', frame: number, continuing: boolean, alone: boolean, closeUp: boolean): void => {
      const how = { ...(alone ? { alone } : {}), ...(closeUp ? { closeUp } : {}) }
      props.onEdit(
        edge === 'start' ? { kind: 'setClipIn', clipId, frame, ...how } : { kind: 'setClipOut', clipId, frame, ...how },
        continuing
      )
    }
  )
  const clipFade = useSteady((clipId: string, side: 'in' | 'out', length: number, continuing: boolean): void =>
    props.onEdit({ kind: 'setFade', clipId, side, length }, continuing)
  )
  const clipDragStart = useSteady((clipId: string, x: number, y: number, alone: boolean): void => {
    const found = findClip(t, clipId)
    if (!found) return
    const clip = found.clip as Clip | SoundClip
    // A press means doing rather than looking: the picture goes
    // back to the playhead, and the drag is free to use the pointer.
    props.onSkim?.(null)
    // A piece of a group takes the whole group with it.
    const own = alone ? [clipId] : groupedIds(t, clipId)
    // Pressed inside a selection, the whole selection goes.
    const rest = props.selectedIds.has(clipId) ? [...props.selectedIds].filter((id) => !own.includes(id)) : []
    const moving = new Set([...own, ...rest])
    setDrag({
      clipId,
      alone,
      with: rest,
      kind: found.kind,
      startX: x,
      startScroll: scroller.current?.scrollLeft ?? 0,
      startY: y,
      fromStart: clip.timelineStart,
      length: spanLength(clip),
      targets: snapTargets(allTracks(), props.playhead.get(), moving),
      trackId: found.track.id,
      landings: null,
      start: clip.timelineStart,
      moved: false,
      insert: false,
      fromV1: onV1.has(clipId),
      newTrack: false,
      laneTrackId: newId()
    })
  })

  return { clipSelect, captionPressEmpty, captionSnaps, clipClosingUp, clipSkim, clipMenu, clipPaint, clipKeyframe, clipTrim, clipFade, clipDragStart }
}
