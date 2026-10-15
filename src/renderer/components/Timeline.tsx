import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { TIMELINE_LEAVES, TIMELINE_MIN } from '../state/useSettings'
import type { Clip, Landing, SoundClip, Timeline as TimelineData, TrackKind } from '../../shared/project'
import { allClips, findClip, groupsOnV1, linkedIds, markedSpan, mediaDurationFrames, newId, plannedMove, timelineDuration, trackLabel, trackOf,
  rippleTrimBlockers, transitionsOf
} from '../../shared/project'
import { MAX_AUDIO_TRACKS, MAX_VIDEO_TRACKS, gapAt, snapFrame, snapFrameTo, snapMove, snapMoveTo, snapReach, snapTargets, spanEnd, trimTargets, type Span } from '../../shared/tracks'
import { heldInWindows, nearestSeam, seamsOn, type TransitionSide, type TransitionWindow } from '../../shared/transitions'
import { MIN_CLIP_WIDTH, pxPerFrameAt, shownPart, trackHeights } from '../../shared/timeline-layout'
import { clipLabel, clipLabels } from '../../shared/clip-name'
import { peaksKey } from '../../shared/sound'
import { commandKey } from '../../shared/system'
import { useSteady } from '../state/useSteady'
import { surface, ink, accent, meaning, track as trackColour, radius, type } from '../theme'
import { Overview } from './Overview'
import { Ruler } from './Ruler'
import { TrackClip } from './TrackClip'
import { ClipTransition, SeamButton, SEAM_REACH_PX, SEAM_ROOM_PX, seamButtonSize } from './ClipTransition'
import { CaptionTrack } from './CaptionTrack'
import { BOX_THRESHOLD_PX, DRAG_THRESHOLD_PX, EFFECT_TYPE, LANE_HEIGHT, SOURCE_TYPE, TAIL_PX, type Drag } from './timeline/drag'
import { fadeableSides, innerOf, touching } from './timeline/clip-sides'
import type { TimelineProps } from './timeline/props'
import { useViewScroll } from './timeline/useViewScroll'
import { useEdgeScroll } from './timeline/useEdgeScroll'
import { useClipHandlers } from './timeline/useClipHandlers'
import { TimelineToolbar } from './timeline/TimelineToolbar'
import { TrackHeaders } from './timeline/TrackHeaders'
import { TimelineOverlays } from './timeline/TimelineOverlays'

export { SOURCE_TYPE, EFFECT_TYPE } from './timeline/drag'

export function Timeline(props: TimelineProps): JSX.Element {
  const t = props.timeline
  const heights = trackHeights(props.trackSize)
  /** How tall one track is drawn: what it has been dragged to, or what its kind gets. */
  const heightOf = (trackId: string, kind: TrackKind): number =>
    props.trackHeights?.[trackId] ?? (kind === 'video' ? heights.video : heights.audio)
  const pxPerFrame = pxPerFrameAt(props.zoom)
  // Worked out once per timeline, not on every tick of the playhead, which
  // draws the timeline again to move its line.
  const total = useMemo(() => timelineDuration(t), [t])
  const trackRefs = useRef(new Map<string, HTMLDivElement>())
  const laneRefs = useRef(new Map<TrackKind, HTMLDivElement>())
  const [drag, setDrag] = useState<Drag | null>(null)
  /** A box being drawn over empty timeline space to pick several clips, in client pixels. */
  const [box, setBox] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null)
  /** Where that press landed, for the click it turns into if it never moves: its row's left edge on screen included. */
  const pressedOn = useRef<{ trackId: string; clips: Span[]; add: boolean; left: number } | null>(null)
  /** A source from the bin being dragged over the timeline, which shows the lanes for new tracks. */
  const [binDrag, setBinDrag] = useState(false)
  // How near in frames 8 pixels is at this zoom, or nothing with snapping off.
  const snapWithin = snapReach(props.snapping, pxPerFrame)

  const { scroller, rulerPin, cornerPin, scrolledTo, scrubbing, drawn, seeDrawn } = useViewScroll(props, pxPerFrame)

  const { followEdge, stopEdge, edgeScroll, scrubScroll, overviewScroller } = useEdgeScroll(scroller, scrolledTo)

  /**
   * What a drag has caught, for the line drawn at it, and which clip is being
   * closed up, for the clips in its way. Both go as soon as the drag lets go.
   */
  const [snapped, setSnapped] = useState<number | null>(null)
  // The edge drag that closes up, and the sequence as it was when it began:
  // what is in its way is asked of that, at the frame it has got to, as the
  // edit itself will ask it (audit 2026-10-01).
  const [closingUp, setClosingUp] = useState<{ clipId: string; edge: 'start' | 'end'; frame: number; alone: boolean; base: TimelineData } | null>(null)
  const blockers = useMemo(
    () => (closingUp ? rippleTrimBlockers(closingUp.base, closingUp.clipId, closingUp.edge, closingUp.frame, closingUp.alone) : []),
    [closingUp]
  )
  const inTheWay = useMemo(() => new Set(blockers.map((c) => c.id)), [blockers])
  const trimBlocked = useMemo(() => {
    const first = blockers[0]
    if (!first || !closingUp) return null
    const track = [...closingUp.base.videoTracks, ...closingUp.base.audioTracks].find((r) => (r.clips as { id: string }[]).some((c) => c.id === first.id))
    const name = clipLabel(closingUp.base, first.id)
    return track ? `${name} on ${trackLabel(closingUp.base, track.id)}` : name
  }, [blockers, closingUp])

  /**
   * Every transition of the sequence, by the track it is on, clamped against
   * the clips around it. One place works them out and the drawing, the export
   * and the preview all read the same answers.
   */
  const transitions = useMemo(() => new Map(transitionsOf(t).map((r) => [r.trackId, r.windows])), [t])

  /** The seam the pointer is near, so its button shows, and only on that track. */
  const [nearSeam, setNearSeam] = useState<{ trackId: string; at: number; clipId: string; side: TransitionSide; inside?: 'left' | 'right' } | null>(null)

  /** The latest movement of a clip being dragged, so a scroll can move it on without the pointer moving. */
  const dragMove = useRef<{ move: (e: globalThis.PointerEvent) => void; last: globalThis.PointerEvent | null }>({ move: () => undefined, last: null })

  const allTracks = (): Span[][] => [...t.videoTracks.map((r) => r.clips as Span[]), ...t.audioTracks.map((r) => r.clips as Span[])]

  /**
   * Only what is on screen catches a drag. Snapping to a cut scrolled out of
   * sight pulls an edge towards something nobody can see, which reads as the
   * edge refusing to go where it was put.
   *
   * Asked afresh on every movement, never once when the drag begins: the
   * timeline scrolls under a drag held near its edge, and a set taken at the
   * start would go stale the moment it did.
   */
  const onScreen = (targets: number[]): number[] => {
    const el = scroller.current
    if (!el || el.clientWidth <= 0) return targets
    const margin = snapReach(true, pxPerFrame)
    const from = el.scrollLeft / pxPerFrame - margin
    const to = (el.scrollLeft + el.clientWidth) / pxPerFrame + margin
    const seen = targets.filter((f) => f >= from && f <= to)
    // Never nothing: an edge with nothing in sight keeps the start of the
    // sequence and the playhead, which are where a cut is usually wanted.
    return seen.length > 0 ? seen : targets.filter((f) => f === 0 || f === props.playhead)
  }

  /** What a trim of a clip snaps to: only what stays put while it moves. */
  const trimSnapTargets = useSteady((clipId: string, alone: boolean, edge: 'start' | 'end', closesUp: boolean): number[] => {
    const found = findClip(t, clipId)
    if (!found) return []
    // A trim that closes up always takes the whole group with it.
    const moving = new Set(alone && !closesUp ? [clipId] : linkedIds(t, clipId))
    return trimTargets(allTracks(), found.clip, edge, props.playhead, { closesUp, moving })
  })
  const onScreenSteady = useSteady(onScreen)
  /** The same for every clip, and the same object until the zoom changes how near is near. */
  const clipSnap = useMemo(
    () => ({ targets: trimSnapTargets, onScreen: onScreenSteady, within: snapWithin }),
    [trimSnapTargets, onScreenSteady, snapWithin]
  )

  /**
   * A source from the bin, let go over a track, or over the lane past the last
   * track of a kind, which makes a new one. Its start or end snaps to an edge
   * or the playhead as a moved clip's does, unless Alt is held; Ctrl puts it
   * in, opening up the sequence, rather than covering what is there.
   */
  const dropProps = (onto: string | { newTrack: TrackKind }) => ({
    onDragOver: (e: React.DragEvent<HTMLDivElement>): void => {
      if (!e.dataTransfer.types.includes(SOURCE_TYPE) && !e.dataTransfer.types.includes(EFFECT_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      // Near an edge the timeline scrolls; the drop reads where the track is then. A drag
      // held still goes on sending this, so it stops a moment after the last one.
      followEdge(e.clientX, () => undefined, { forMs: 250 })
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>): void => {
      setBinDrag(false)
      stopEdge()
      const effect = e.dataTransfer.getData(EFFECT_TYPE)
      if (effect) {
        // Its length is not known until it is brought in: only its start snaps.
        e.preventDefault()
        e.stopPropagation()
        const box = e.currentTarget.getBoundingClientRect()
        const raw = Math.max(0, Math.round((e.clientX - box.left) / pxPerFrame))
        const frame = e.altKey ? raw : snapFrame(raw, snapTargets(allTracks(), props.playhead), snapWithin)
        props.onDropEffect?.(effect, typeof onto === 'string' ? onto : newId(), frame, typeof onto === 'string' ? {} : { newTrack: onto.newTrack })
        return
      }
      const mediaId = e.dataTransfer.getData(SOURCE_TYPE)
      if (!mediaId) return
      e.preventDefault()
      e.stopPropagation()
      const box = e.currentTarget.getBoundingClientRect()
      const raw = Math.max(0, Math.round((e.clientX - box.left) / pxPerFrame))
      const m = t.media.find((x) => x.id === mediaId)
      // What lands: the part marked on it, or a picture's five seconds, not the whole source.
      const span = m ? markedSpan(m, t.fps) : null
      const length = span ? span.to - span.from : 1
      const targets = snapTargets(allTracks(), props.playhead)
      // Ctrl puts it in, opening up the sequence, on V1 only; anywhere else it is a plain drop.
      const insert = commandKey(e) && onto === t.videoTracks[0]!.id
      // Put in, only its start matters: what is there moves on past its end.
      const frame = e.altKey ? raw : insert ? snapFrame(raw, targets, snapWithin) : snapMove(raw, length, targets, snapWithin)
      const trackId = typeof onto === 'string' ? onto : newId()
      props.onDropSource?.(mediaId, trackId, frame, {
        insert,
        ...(typeof onto === 'string' ? {} : { newTrack: onto.newTrack })
      })
    }
  })

  // A clip moves along its track, or to another of its kind, with the clips
  // linked to it, landing where it is let go.
  useEffect(() => {
    if (!drag) return
    const move = (e: globalThis.PointerEvent): void => {
      const dy = e.clientY - drag.startY
      if (!drag.moved && Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return
      // Near an edge the timeline scrolls, and the clip goes with the view.
      dragMove.current.last = e
      followEdge(e.clientX, () => {
        const last = dragMove.current.last
        if (last) dragMove.current.move(last)
      })
      const dx = e.clientX - drag.startX + ((scroller.current?.scrollLeft ?? 0) - drag.startScroll)
      const raw = Math.max(0, drag.fromStart + Math.round(dx / pxPerFrame))
      // Only onto a track of the same kind: pictures stay among pictures, sound among sound.
      const sameKind = new Set((drag.kind === 'video' ? t.videoTracks : t.audioTracks).map((r) => r.id))
      let trackId = drag.trackId
      let newTrack = drag.newTrack
      for (const [id, el] of trackRefs.current) {
        const box = el.getBoundingClientRect()
        if (sameKind.has(id) && e.clientY >= box.top && e.clientY < box.bottom) {
          trackId = id
          newTrack = false
        }
      }
      const lane = laneRefs.current.get(drag.kind)?.getBoundingClientRect()
      if (lane && e.clientY >= lane.top && e.clientY < lane.bottom) {
        trackId = drag.laneTrackId
        newTrack = true
      }
      // Ctrl takes it out and puts it in from V1 or onto it; anywhere else it is a plain move.
      const insert = commandKey(e) && (drag.fromV1 || trackId === t.videoTracks[0]!.id)
      // Its start or end snaps to an edge or the playhead, unless Alt is held;
      // only its start when it is put in.
      const snap = e.altKey
        ? { frame: raw, caught: null }
        : insert
          ? snapFrameTo(raw, onScreen(drag.targets), snapWithin)
          : snapMoveTo(raw, drag.length, onScreen(drag.targets), snapWithin)
      const start = snap.frame
      setSnapped(snap.caught)
      const landings = newTrack || insert ? null : plannedMove(t, drag.clipId, trackId, start, drag.alone, drag.with)
      setDrag((d) => (d ? { ...d, trackId, start, landings, moved: true, insert, newTrack } : d))
    }
    dragMove.current.move = move
    const up = (): void => {
      stopEdge()
      setSnapped(null)
      dragMove.current.last = null
      setDrag((d) => {
        if (d?.moved && (d.landings?.length || d.insert || d.newTrack)) {
          props.onEdit({
            kind: 'moveClip',
            clipId: d.clipId,
            trackId: d.trackId,
            start: d.start,
            ...(d.alone ? { alone: true } : {}),
            // Put in with Ctrl, only the clip pressed and its group go: an
            // insert opens the sequence up for one stretch, not for several.
            ...(d.with.length > 0 && !d.insert ? { with: d.with } : {}),
            ...(d.insert ? { insert: true } : {}),
            ...(d.newTrack ? { newTrack: true } : {})
          })
        }
        // A press that never moved was a click.
        if (d && !d.moved) props.onClickClip?.(d.clipId)
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, props, pxPerFrame, snapWithin, t])

  /**
   * A press on an empty stretch of a track. Let go where it began, it moves
   * the playhead there, and selects the gap it landed in, or clears the
   * selection past the last clip. Dragged, it draws a box and every clip the
   * box touches is selected, with Shift added to what was selected already.
   */
  const pressEmpty = (trackId: string, clips: Span[]) => (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget || e.button !== 0) return
    pressedOn.current = { trackId, clips, add: e.shiftKey, left: e.currentTarget.getBoundingClientRect().left }
    setBox({ x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY })
  }

  /** Every clip a box over the timeline touches at all, by id. */
  const clipsTouched = (x0: number, y0: number, x1: number, y1: number): string[] => {
    const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)]
    const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)]
    const out: string[] = []
    for (const [id, el] of trackRefs.current) {
      const row = el.getBoundingClientRect()
      if (row.bottom <= top || row.top >= bottom) continue
      const from = (left - row.left) / pxPerFrame
      const to = (right - row.left) / pxPerFrame
      for (const c of (trackOf(t, id)?.track.clips ?? []) as Span[]) {
        if (c.timelineStart < to && spanEnd(c) > from) out.push(c.id)
      }
    }
    return out
  }

  // The box being drawn, until it is let go.
  useEffect(() => {
    if (!box) return
    const move = (e: globalThis.PointerEvent): void => setBox((b) => (b ? { ...b, x: e.clientX, y: e.clientY } : b))
    const up = (e: globalThis.PointerEvent): void => {
      const from = pressedOn.current
      pressedOn.current = null
      setBox(null)
      if (!from) return
      if (Math.abs(e.clientX - box.x0) <= BOX_THRESHOLD_PX && Math.abs(e.clientY - box.y0) <= BOX_THRESHOLD_PX) {
        const frame = Math.max(0, Math.min(total, Math.round((e.clientX - from.left) / pxPerFrame)))
        const gap = gapAt(from.clips, frame)
        if (gap) props.onSelectGap({ trackId: from.trackId, ...gap })
        else props.onSelect(null, false)
        props.onSeek(frame)
        return
      }
      props.onSelectMany?.(clipsTouched(box.x0, box.y0, e.clientX, e.clientY), from.add)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [box, props, pxPerFrame, total, t])


  /** Where each clip of the drag would land, on the tracks there are. */
  const landingsOn = (kind: TrackKind, index: number): Landing[] =>
    drag?.landings?.filter((l) => l.kind === kind && l.index === index) ?? []

  /**
   * Whether a transition is picked out: the one pressed, and the one faded with
   * it on the clip linked to that one, unless it was taken on its own.
   */
  const transitionPicked = (clipId: string, side: TransitionSide): boolean => {
    const at = props.selectedTransition
    if (!at || at.side !== side) return false
    if (at.clipId === clipId) return true
    return at.alone !== true && linkedIds(t, at.clipId).includes(clipId)
  }

  /**
   * The seam nearest `frame` on a track with no transition on it yet, and which
   * side of it has room for the button, or null when neither has.
   *
   * The button never sits on the seam, where the trim handles are, so it needs
   * a clip wide enough beside it to sit on. On a cut between two clips a few
   * pixels wide there is no button, and the clip's menu and the keys are the
   * way in.
   */
  const seamNear = (
    track: { id: string; clips: (Clip | SoundClip)[] },
    kind: TrackKind,
    frame: number
  ): { trackId: string; at: number; clipId: string; side: TransitionSide; inside?: 'left' | 'right' } | null => {
    const seam = nearestSeam(track.clips as Span[], kind === 'video' ? 'picture' : 'sound', frame, SEAM_REACH_PX / pxPerFrame)
    if (!seam) return null
    const lone = !touching(track.clips, seam.at)
    // A sound clip's edge with nothing against it has its fade handle there
    // instead, which the button would sit on top of: only a cut between two
    // sounds, a crossfade, is offered here.
    if (kind === 'audio' && lone) return null
    const edges = seamsOn(track.clips as Span[]).map((x) => x.at)
    const right = Math.min(...edges.filter((x) => x > seam.at), Infinity) - seam.at
    const left = seam.at - Math.max(...edges.filter((x) => x < seam.at), 0)
    const room = SEAM_ROOM_PX / pxPerFrame
    // Bugs and notes 2, note 22: an edge with nothing beside it, as the
    // sequence's first frame or a clip after a gap, has the button just
    // inside the clip, whole and clickable, and needs room on that side only.
    if (lone) {
      const inside = seam.side === 'in' ? 'right' : 'left'
      return (inside === 'right' ? right : left) >= 2 * room ? { trackId: track.id, ...seam, inside } : null
    }
    // Room on both sides, because it sits on the seam: two buttons on two cuts
    // a few pixels apart would cover each other.
    if (right < room || left < room) return null
    // On a cut at the edge of the view, half of it would be out of sight: it
    // sits inside the clip on the view's side of the cut.
    const view = scroller.current
    const x = seam.at * pxPerFrame
    const half = seamButtonSize(heightOf(track.id, kind)) / 2
    if (view && x - half < view.scrollLeft && right >= 2 * room) return { trackId: track.id, ...seam, inside: 'right' }
    if (view && x + half > view.scrollLeft + view.clientWidth && left >= 2 * room) return { trackId: track.id, ...seam, inside: 'left' }
    return { trackId: track.id, ...seam }
  }

  /**
   * How many frames at each end of every window hold one frame for want of
   * footage: Premiere's "insufficient media", which it hatches. Once per
   * timeline, so a transition is drawn again only when something changed.
   */
  const held = useMemo(() => {
    const out = new Map<TransitionWindow, { head: number; tail: number }>()
    const frames = (clip: Span): number => {
      const media = t.media.find((m) => m.id === clip.mediaId)
      return media ? mediaDurationFrames(media, t.fps) : 0
    }
    const each = (tracks: { id: string; clips: Span[] }[], kinds: 'picture' | 'sound'): void => {
      for (const r of tracks) for (const [w, h] of heldInWindows(r.clips, kinds, transitions.get(r.id) ?? [], frames)) out.set(w, h)
    }
    each(t.videoTracks, 'picture')
    each(t.audioTracks, 'sound')
    return out
  }, [t, transitions])
  const transitionPick = useSteady((w: TransitionWindow, alone: boolean) => props.onSelectTransition?.({ clipId: w.clipId, side: w.side, ...(alone ? { alone } : {}) }))
  const transitionMenu = useSteady((w: TransitionWindow, at: { x: number; y: number }) => props.onTransitionMenu?.({ clipId: w.clipId, side: w.side }, at))
  const transitionDrag = useSteady((w: TransitionWindow, at: { length: number; before: number }, continuing: boolean, alone: boolean) =>
    props.onEdit({ kind: 'setTransition', clipId: w.clipId, side: w.side, length: at.length, before: at.before, ...(alone ? { alone } : {}) }, continuing)
  )
  const transitionDone = useSteady((at: { length: number; before: number }) => props.onTransitionFrames?.(at.length))

  /**
   * What each clip is called, whether it closes up the sequence, and its
   * source, worked out once per timeline. Asked of every clip on every
   * render, each of these searched the whole sequence for the clip first.
   */
  const labels = useMemo(() => clipLabels(t), [t])
  const onV1 = useMemo(() => groupsOnV1(t), [t])
  const mediaById = useMemo(() => new Map(t.media.map((m) => [m.id, m] as const)), [t.media])
  const missing = useMemo(() => new Set(props.missingMedia), [props.missingMedia])
  const rebuilding = useMemo(() => new Set(props.rebuildingMedia), [props.rebuildingMedia])

  const { clipSelect, captionPressEmpty, captionSnaps, clipClosingUp, clipSkim, clipMenu, clipPaint, clipKeyframe, clipTrim, clipFade, clipDragStart } =
    useClipHandlers({ props, t, total, drag, setDrag, setClosingUp, scroller, allTracks, onV1 })

  const trackRow = (kind: TrackKind, index: number): JSX.Element => {
    const track = kind === 'video' ? t.videoTracks[index]! : t.audioTracks[index]!
    const height = heightOf(track.id, kind)
    const gap = props.selectedGap?.trackId === track.id ? props.selectedGap : null
    return (
      <div
        key={track.id}
        data-testid="track"
        data-kind={kind}
        data-track-id={track.id}
        data-index={index}
        ref={(el) => {
          if (el) trackRefs.current.set(track.id, el)
          else trackRefs.current.delete(track.id)
        }}
        onPointerDown={pressEmpty(track.id, track.clips as Span[])}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget || !props.onGapMenu) return
          const frame = Math.max(0, Math.min(total, Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / pxPerFrame)))
          const found = gapAt(track.clips as Span[], frame)
          if (!found) return
          e.preventDefault()
          const g = { trackId: track.id, ...found }
          props.onSelectGap(g)
          props.onGapMenu(g, { x: e.clientX, y: e.clientY })
        }}
        onMouseMove={(e) => {
          if (drag !== null) return
          const box = e.currentTarget.getBoundingClientRect()
          const found = seamNear(track, kind, (e.clientX - box.left) / pxPerFrame)
          // Only when it actually changes. Set on every movement, this would
          // render the whole timeline on every pixel the pointer travels, and
          // a drag's own listeners would be torn down and rebuilt under it.
          setNearSeam((was) =>
            (was?.trackId ?? null) === (found?.trackId ?? null) && (was?.at ?? null) === (found?.at ?? null) ? was : found
          )
        }}
        onMouseLeave={() => setNearSeam((at) => (at?.trackId === track.id ? null : at))}
        {...dropProps(track.id)}
        style={{
          position: 'relative',
          height,
          boxSizing: 'border-box',
          borderTop: `1px solid ${surface.line}`,
          // The track a drag would land on is lifted, so it is clear where it goes.
          background: drag?.trackId === track.id && drag.landings ? surface.sunken : surface.canvas,
          // A hidden track is faded, not emptied: its clips are still there to
          // be moved and trimmed, they are simply not in the picture.
          opacity: track.hidden === true ? 0.45 : 1
        }}
      >
        {gap && (
          <div
            data-testid="selected-gap"
            data-from={gap.from}
            data-to={gap.to}
            style={{
              position: 'absolute',
              left: gap.from * pxPerFrame,
              top: 2,
              width: Math.max(2, (gap.to - gap.from) * pxPerFrame),
              height: height - 4,
              background: accent.tint,
              outline: `1px dashed ${accent.base}`,
              outlineOffset: -1,
              pointerEvents: 'none'
            }}
          />
        )}
        {(track.clips as (Clip | SoundClip)[]).map((clip) => {
          const media = mediaById.get(clip.mediaId)
          if (!media) return null
          const selected = props.selectedIds.has(clip.id)
          // Every prop a primitive, or an object that only changes when the
          // clip does: this is drawn again only when something about it changed.
          const width = Math.max(MIN_CLIP_WIDTH, (clip.sourceOut - clip.sourceIn) * pxPerFrame)
          const shown = shownPart(clip.timelineStart * pxPerFrame, width, drawn)
          return (
            <TrackClip
              key={clip.id}
              clip={clip}
              kind={kind}
              media={media}
              label={labels.get(clip.id) ?? ''}
              colour={kind === 'video' ? trackColour.picture : trackColour.sound}
              height={height}
              blocking={inTheWay.has(clip.id)}
              onSnap={setSnapped}
              onClosingUp={clipClosingUp}
              trimBlocked={closingUp?.clipId === clip.id ? trimBlocked : null}
              onSkim={props.onSkim ? clipSkim : undefined}
              {...(props.onClipMenu ? { onMenu: clipMenu } : {})}
              fps={t.fps}
              pxPerFrame={pxPerFrame}
              selected={selected}
              selectedAlone={selected && props.selectedAlone}
              offline={missing.has(media.id)}
              rebuilding={rebuilding.has(media.id)}
              revision={props.revisions.get(media.id) ?? 0}
              peaks={kind === 'audio' ? props.peaks.get(peaksKey(clip.mediaId, (clip as SoundClip).track)) : undefined}
              dragging={drag !== null && drag.landings !== null && (drag.landings.some((l) => l.clipId === clip.id))}
              snap={clipSnap}
              edgeScroll={edgeScroll}
              onSelect={clipSelect}
              onPaint={props.onPaint && kind === 'video' ? clipPaint : undefined}
              onKeyframe={kind === 'video' ? clipKeyframe : undefined}
              onEffectMark={props.onEffectMark}
              onKeyframeMove={kind === 'video' ? props.onKeyframeMove : undefined}
              zoomPicture={selected ? props.picture : undefined}
              showKeys={props.showClipKeys !== false}
              ripples={onV1.has(clip.id)}
              inner={innerOf(track.clips as (Clip | SoundClip)[], clip)}
              onTrim={clipTrim}
              {...(kind === 'audio' ? { onFade: clipFade, fadeable: fadeableSides(track.clips, clip) } : {})}
              onDragStart={clipDragStart}
              shownFrom={shown.from}
              shownTo={shown.to}
            />
          )
        })}
        {(transitions.get(track.id) ?? []).filter((w) => w.to * pxPerFrame >= drawn.from && w.from * pxPerFrame <= drawn.to).map((w) => (
          <ClipTransition
            key={`${w.clipId}:${w.side}`}
            window={w}
            kinds={kind === 'video' ? 'picture' : 'sound'}
            height={height}
            pxPerFrame={pxPerFrame}
            selected={transitionPicked(w.clipId, w.side)}
            selectedAlone={props.selectedTransition?.alone === true && props.selectedTransition.clipId === w.clipId}
            held={held.get(w)}
            onSelect={transitionPick}
            {...(props.onTransitionMenu ? { onMenu: transitionMenu } : {})}
            onDrag={transitionDrag}
            onDragDone={transitionDone}
          />
        ))}
        {nearSeam?.trackId === track.id && drag === null && (
          <SeamButton
            at={nearSeam.at}
            inside={nearSeam.inside}
            height={height}
            pxPerFrame={pxPerFrame}
            onAdd={() => {
              props.onEdit(
                {
                  kind: 'addTransition',
                  clipId: nearSeam.clipId,
                  side: nearSeam.side,
                  ...(props.transitionKinds ? { transitionKind: kind === 'video' ? props.transitionKinds.picture : props.transitionKinds.sound } : {}),
                  length: Math.max(1, Math.round(props.transitionFrames ?? t.fps))
                },
                false
              )
              props.onSelectTransition?.({ clipId: nearSeam.clipId, side: nearSeam.side })
              setNearSeam(null)
            }}
          />
        )}
        {drag?.moved && drag.insert && drag.trackId === track.id && (
          <div
            data-testid="insert-marker"
            data-start={drag.start}
            style={{
              position: 'absolute',
              left: drag.start * pxPerFrame - 1,
              top: 0,
              bottom: 0,
              width: 2,
              background: meaning.attention,
              pointerEvents: 'none',
              zIndex: 4
            }}
          />
        )}
        {landingsOn(kind, index).map((l) => {
          const moved = drag ? l.start - drag.fromStart : 0
          return (
            <div
              key={l.clipId}
              data-testid="drop-outline"
              data-start={l.start}
              data-moved={moved}
              style={{
                position: 'absolute',
                left: l.start * pxPerFrame,
                top: 2,
                width: Math.max(4, l.length * pxPerFrame),
                height: height - 4,
                outline: `2px dashed ${meaning.attention}`,
                outlineOffset: -2,
                borderRadius: radius.chip,
                pointerEvents: 'none',
                zIndex: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}
            >
              {moved !== 0 && Math.max(4, l.length * pxPerFrame) > 54 && (
                <span
                  style={{
                    font: type.monoSmall,
                    color: meaning.attention,
                    background: surface.overlay,
                    padding: '1px 5px',
                    borderRadius: radius.chip,
                    whiteSpace: 'nowrap'
                  }}
                >
                  {moved > 0 ? '+' : ''}
                  {moved}
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  /**
   * An empty lane past the last track of a kind takes a clip or a source
   * dropped on it onto a new track. It always keeps its place, so nothing
   * moves under the pointer when a drag begins, and says what it is for only
   * while something that could go there is being dragged.
   */
  const lanesShown = (kind: TrackKind): boolean =>
    kind === 'video' ? t.videoTracks.length < MAX_VIDEO_TRACKS : t.audioTracks.length < MAX_AUDIO_TRACKS
  const laneActive = (kind: TrackKind): boolean => binDrag || (drag !== null && drag.moved && drag.kind === kind)
  const newTrackLane = (kind: TrackKind): JSX.Element | null =>
    lanesShown(kind) ? (
      <div
        key={`lane-${kind}`}
        data-testid="new-track-lane"
        data-kind={kind}
        ref={(el) => {
          if (el) laneRefs.current.set(kind, el)
          else laneRefs.current.delete(kind)
        }}
        {...dropProps({ newTrack: kind })}
        // A press on it moves the playhead, as one on an empty stretch of track does.
        onPointerDown={pressEmpty(kind, [])}
        data-active={laneActive(kind) ? 'yes' : 'no'}
        style={{
          position: 'relative',
          height: LANE_HEIGHT,
          boxSizing: 'border-box',
          border: `1px dashed ${
            drag?.newTrack && drag.kind === kind
              ? meaning.attention
              : laneActive(kind)
                ? surface.edge
                : 'transparent'
          }`,
          font: type.meta,
          color: ink.muted,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 8
        }}
      >
        {laneActive(kind) ? `Drop here for a new ${kind === 'video' ? 'video' : 'audio'} track` : ''}
      </div>
    ) : null

  const videoOrder = t.videoTracks.map((_, i) => i).reverse()
  // The caption track is there once the sequence has captions.
  const captioned = t.captions.clips.length > 0
  const lastFrame = useMemo(() => Math.max(total, ...allClips(t).map((c) => c.timelineStart + c.sourceOut - c.sourceIn)), [total, t])

  return (
    <section
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes(SOURCE_TYPE) || e.dataTransfer.types.includes(EFFECT_TYPE)) setBinDrag(true)
      }}
      onDragLeave={(e) => {
        // Only when the pointer leaves the timeline, not when it crosses from one track to the next.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setBinDrag(false)
          stopEdge()
        }
      }}
      onDrop={() => {
        setBinDrag(false)
        stopEdge()
      }}
    >
      {box && (Math.abs(box.x - box.x0) > BOX_THRESHOLD_PX || Math.abs(box.y - box.y0) > BOX_THRESHOLD_PX) && (
        <div
          data-testid="select-box"
          style={{
            position: 'fixed',
            left: Math.min(box.x0, box.x),
            top: Math.min(box.y0, box.y),
            width: Math.abs(box.x - box.x0),
            height: Math.abs(box.y - box.y0),
            border: `1px solid ${accent.base}`,
            background: accent.tint,
            pointerEvents: 'none',
            zIndex: 5
          }}
        />
      )}
      <TimelineToolbar props={props} t={t} total={total} />

      {props.overview && (
        <Overview
          timeline={t}
          playhead={props.playhead}
          scroller={overviewScroller.current}
          zoom={props.zoom}
          onDragging={(on) => (scrubbing.current = on)}
          onHide={() => props.onOverview(false)}
        />
      )}

      {/*
        Tall enough for its tracks, up to 40% of the window, then it scrolls.
        Once the divider above it is dragged, as tall as that, with room below
        the last track if there are few, never leaving the monitor less than
        its smallest picture.
      */}
      <div
        ref={props.tracksBox}
        data-testid="timeline-tracks"
        style={{
          display: 'flex',
          // Each column as tall as its own tracks. Stretched, the lanes were
          // only as tall as the area on screen, and with more tracks than fit
          // the lowest ones were cut off when scrolled down to.
          alignItems: 'flex-start',
          ...(props.tracksHeight != null
            ? {
                height:
                  props.tracksRoom != null
                    ? Math.min(props.tracksHeight, props.tracksRoom)
                    : `min(${props.tracksHeight}px, calc(100vh - ${TIMELINE_LEAVES}px))`,
                minHeight: TIMELINE_MIN
              }
            : { maxHeight: '40vh' }),
          overflowY: 'auto'
        }}
        // The ruler, and the corner above the track names, stay at the top as
        // the tracks scroll up under them, however many tracks there are.
        onScroll={(e) => {
          const y = `translateY(${e.currentTarget.scrollTop}px)`
          if (rulerPin.current) rulerPin.current.style.transform = y
          if (cornerPin.current) cornerPin.current.style.transform = y
        }}
      >
        <TrackHeaders props={props} t={t} heightOf={heightOf} cornerPin={cornerPin} captioned={captioned} lanesShown={lanesShown} videoOrder={videoOrder} />

        <div
          ref={scroller}
          data-testid="timeline-scroll"
          onScroll={(e) => {
            scrolledTo.current = e.currentTarget.scrollLeft
            seeDrawn()
          }}
          style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 6 }}
        >
          <div style={{ minWidth: Math.max(600, lastFrame * pxPerFrame + (drag || binDrag ? TAIL_PX : 40)) }}>
            <div ref={rulerPin} data-testid="ruler-pin" style={{ position: 'relative', zIndex: 4 }}>
            <Ruler
              durationFrames={total}
              fps={t.fps}
              pxPerFrame={pxPerFrame}
              playhead={props.playhead}
              drawn={drawn}
              onSeek={props.onSeek}
              edgeScroll={scrubScroll}
              onScrub={(on) => {
                scrubbing.current = on
                props.onScrubPlayhead?.(on)
              }}
              markers={t.markers}
              onMarker={(m) => props.onSeek(m.frame)}
              {...(props.onMarkerMenu ? { onMarkerMenu: props.onMarkerMenu } : {})}
              onMoveMarker={(m, frame, continuing) =>
                props.onEdit({ kind: 'moveMarker', markerId: m.id, frame }, continuing)
              }
              renamingId={props.renamingMarkerId ?? null}
              onRenamed={(m, name) => {
                if (name.trim() !== m.name) props.onEdit({ kind: 'renameMarker', markerId: m.id, name }, false)
              }}
              {...(props.onRenameDone ? { onRenameDone: props.onRenameDone } : {})}
              range={props.range ?? null}
            />
            </div>

            <div style={{ position: 'relative' }}>
              {captioned && (
                <CaptionTrack
                  clips={t.captions.clips}
                  style={t.captions.style}
                  pxPerFrame={pxPerFrame}
                  selectedId={props.selectedCaptionId}
                  onSelect={props.onSelectCaption}
                  onPressEmpty={captionPressEmpty}
                  onEdit={props.onEdit}
                  targets={captionSnaps}
                  snapWithin={snapWithin}
                  drawn={drawn}
                />
              )}
              {/* The top track is the last: V2 above V1, as they are drawn. */}
              {newTrackLane('video')}
              {videoOrder.map((i) => trackRow('video', i))}
              {t.audioTracks.map((_, i) => trackRow('audio', i))}
              {newTrackLane('audio')}

              <TimelineOverlays props={props} snapped={snapped} pxPerFrame={pxPerFrame} binDrag={binDrag} drag={drag} />
            </div>
          </div>
        </div>
      </div>

      {allClips(t).length === 0 && (
        <p style={{ color: ink.muted, font: type.body, margin: 0 }}>
          Drag a source from the bin onto a track, or press Add to timeline.
        </p>
      )}
    </section>
  )
}
