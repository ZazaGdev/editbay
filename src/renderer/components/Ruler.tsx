import { useEffect, useLayoutEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import { formatTimecode } from '../../shared/time'
import { rulerFrames, type PxSpan } from '../../shared/timeline-layout'
import { inOrder, type Marker } from '../../shared/markers'
import { markColour } from '../../shared/marks'
import { surface, ink, accent, meaning, motion, radius, type, elevation } from '../theme'

/** A marker's flag: wide enough to hit, narrow enough to leave the ruler scrubbable. */
const FLAG_W = 9
const FLAG_H = 11
/** The most room a marker's name takes, and the least it is worth drawing in. */
const NAME_MAX_W = 140
const NAME_MIN_W = 24

/** Pixels per frame from which each frame's edge is marked on the ruler. */
const FRAME_TICKS_FROM = 8

/** Tall enough to be an obvious target, rather than a strip of labels. */
export const RULER_HEIGHT = 36

/**
 * The time ruler, which is also the scrub bar: press anywhere on it and drag to
 * move the playhead.
 *
 * It has to look like a control and not like a caption. So it gets its own
 * background, a horizontal resize cursor, a handle on the playhead that reads
 * as grabbable, and a guide under the pointer saying where a click would land.
 */
export function Ruler(props: {
  durationFrames: number
  fps: number
  pxPerFrame: number
  playhead: number
  /**
   * The stretch of the ruler near the part in view, in pixels: its labels are
   * drawn there and nowhere else. All of it when not given.
   */
  drawn?: PxSpan
  onSeek: (frame: number) => void
  /** Told when a press on the ruler starts a scrub, and when it lets go. */
  onScrub?: (on: boolean) => void
  /** The timeline scrolling while a scrub is held near its edge. */
  edgeScroll?: { follow: (x: number, scrolled: () => void) => void; stop: () => void }
  /**
   * The range marked with In and Out, `to` not included, shown as a band with
   * a flag at each end. Plain and functional: plan 19 gives it its proper look.
   */
  range?: { from: number; to: number } | null
  /** Notes left on frames of the sequence, drawn as flags along the top. */
  markers?: readonly Marker[]
  /** A marker's flag pressed: its frame, so the playhead goes there. */
  onMarker?: (marker: Marker) => void
  /** A marker's flag right-clicked, for the menu on it. */
  onMarkerMenu?: (marker: Marker, at: { x: number; y: number }) => void
  /** A marker's flag dragged. `continuing` marks every movement after the first, so a drag is one undo step. */
  onMoveMarker?: (marker: Marker, frame: number, continuing: boolean) => void
  /** The marker whose name is being typed, or null. */
  renamingId?: string | null
  /** A name typed and meant. */
  onRenamed?: (marker: Marker, name: string) => void
  /** The typing is over, however it ended. */
  onRenameDone?: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [hoverX, setHoverX] = useState<number | null>(null)
  /** A marker being dragged: which one, where the press landed, and whether it has moved yet. */
  const [grab, setGrab] = useState<{ id: string; startX: number; from: number } | null>(null)
  /**
   * Whether the gesture just finished moved a marker. A click fires after the
   * pointer goes up, and a drag that ended must not also be read as a press
   * taking the playhead back to where the marker started.
   */
  const dragged = useRef(false)
  /** Whether this drag has begun, so every movement after the first carries on its undo step. */
  const moved = useRef(false)

  const DRAG_THRESHOLD_PX = 4

  /**
   * The props as they are now, for the window's listeners below. Read from
   * here, those listeners are added once rather than taken down and added
   * again on every render, which is every tick of the playhead.
   */
  const live = useRef(props)
  useLayoutEffect(() => {
    live.current = props
  })

  const frameAt = (clientX: number): number => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return 0
    const { pxPerFrame, durationFrames } = live.current
    const frame = Math.round((clientX - box.left) / pxPerFrame)
    return Math.max(0, Math.min(durationFrames, frame))
  }

  const seekTo = (clientX: number): void => live.current.onSeek(frameAt(clientX))

  /** Where the scrub's pointer is, so the timeline scrolling under it can seek again from there. */
  const scrubAt = useRef(0)

  useEffect(() => {
    const move = (e: globalThis.PointerEvent): void => {
      if (!dragging.current) return
      scrubAt.current = e.clientX
      // Held near an edge the timeline scrolls, and the playhead goes on with
      // it: the ruler reads the frame from where it is on screen, so a view
      // that moves under a still pointer is a playhead that keeps going, which
      // is the whole point of dragging to the edge.
      live.current.edgeScroll?.follow(e.clientX, () => seekTo(scrubAt.current))
      seekTo(e.clientX)
    }
    const up = (): void => {
      if (!dragging.current) return
      dragging.current = false
      live.current.edgeScroll?.stop()
      live.current.onScrub?.(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  // A marker being dragged. The marker is looked up afresh on every movement,
  // so it is the marker as it is now, moved by the movement before. `moved`
  // is a ref, cleared when the press lands, so every movement after the first
  // carries on one undo step.
  useEffect(() => {
    if (!grab) return
    const move = (e: globalThis.PointerEvent): void => {
      const marker = (live.current.markers ?? []).find((m) => m.id === grab.id)
      if (!marker) return
      if (!moved.current && Math.abs(e.clientX - grab.startX) < DRAG_THRESHOLD_PX) return
      const frame = frameAt(e.clientX)
      if (moved.current && frame === marker.frame) return
      dragged.current = true
      live.current.onMoveMarker?.(marker, frame, moved.current)
      moved.current = true
    }
    const up = (): void => setGrab(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [grab])

  // A label roughly every 120 pixels, snapped to a whole number of seconds,
  // and only near the part in view.
  const labels = rulerFrames(props.durationFrames, props.fps, props.pxPerFrame, props.drawn ?? { from: 0, to: Infinity })

  const onDown = (e: PointerEvent): void => {
    e.preventDefault()
    dragging.current = true
    props.onScrub?.(true)
    seekTo(e.clientX)
  }

  const onHover = (e: PointerEvent): void => {
    const box = ref.current?.getBoundingClientRect()
    if (box) setHoverX(e.clientX - box.left)
  }

  const headX = props.playhead * props.pxPerFrame
  const hoverFrame = hoverX === null ? null : Math.max(0, Math.min(props.durationFrames, Math.round(hoverX / props.pxPerFrame)))

  return (
    <div
      ref={ref}
      data-testid="ruler"
      onPointerDown={onDown}
      onPointerMove={onHover}
      onPointerLeave={() => setHoverX(null)}
      title="Click or drag to move the playhead"
      style={{
        position: 'relative',
        height: RULER_HEIGHT,
        background: hoverX === null ? surface.raised : surface.controlHover,
        borderBottom: `1px solid ${surface.lineStrong}`,
        borderTopLeftRadius: radius.chip,
        borderTopRightRadius: radius.chip,
        transition: `background ${motion.quick} ${motion.easeOut}`,
        cursor: 'ew-resize',
        userSelect: 'none',
        touchAction: 'none'
      }}
    >
      {/* The marked range: a band across the ruler with a flag at each end. */}
      {props.range && (
        <div
          data-testid="marked-range"
          data-from={props.range.from}
          data-to={props.range.to}
          style={{
            position: 'absolute',
            left: props.range.from * props.pxPerFrame,
            top: 0,
            width: Math.max(2, (props.range.to - props.range.from) * props.pxPerFrame),
            height: '100%',
            background: accent.band,
            borderLeft: `2px solid ${accent.base}`,
            borderRight: `2px solid ${accent.base}`,
            boxSizing: 'border-box',
            pointerEvents: 'none'
          }}
        />
      )}

      {/* The markers, along the top, above the labels and under the playhead.
          Each flag is its own target and no wider: the rest of the ruler stays
          a scrub bar, which is what it is mostly used for. */}
      {inOrder(props.markers ?? []).map((m) => (
        <button
          key={m.id}
          type="button"
          data-testid="marker"
          data-marker-id={m.id}
          data-frame={m.frame}
          title={m.name === '' ? `Marker at ${formatTimecode(m.frame, props.fps)}` : `${m.name}  ${formatTimecode(m.frame, props.fps)}`}
          onPointerDown={(e) => {
            // Never a scrub: the flag is the marker's own target, and the rest
            // of the ruler is still the scrub bar.
            e.stopPropagation()
            dragged.current = false
            moved.current = false
            setGrab({ id: m.id, startX: e.clientX, from: m.frame })
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (dragged.current) return
            props.onMarker?.(m)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            props.onMarkerMenu?.(m, { x: e.clientX, y: e.clientY })
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            props.onMarkerMenu?.(m, { x: e.clientX, y: e.clientY })
          }}
          style={{
            position: 'absolute',
            left: m.frame * props.pxPerFrame,
            top: 0,
            width: FLAG_W,
            height: FLAG_H,
            padding: 0,
            border: 'none',
            cursor: 'pointer',
            background: markColour(m.colour) ?? accent.base,
            // A flag: square at the top, pointed at the bottom, pointing at
            // the frame it is on, which is its left edge.
            clipPath: 'polygon(0 0, 100% 0, 100% 60%, 0 100%)'
          }}
        />
      ))}

      {/* Typing a marker's name, on the flag where the name will be. */}
      {inOrder(props.markers ?? [])
        .filter((m) => m.id === props.renamingId)
        .map((m) => (
          <input
            key={`${m.id}-rename`}
            data-testid="marker-rename"
            defaultValue={m.name}
            autoFocus
            placeholder="Name it"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              props.onRenamed?.(m, e.target.value)
              props.onRenameDone?.()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                // Left as it was: Escape everywhere else in this app undoes the typing.
                e.currentTarget.value = m.name
                e.currentTarget.blur()
              }
            }}
            style={{
              position: 'absolute',
              left: m.frame * props.pxPerFrame + FLAG_W + 2,
              top: 0,
              width: 130,
              height: FLAG_H + 5,
              font: type.monoSmall,
              color: ink.primary,
              background: surface.canvas,
              border: `1px solid ${accent.base}`,
              borderRadius: radius.chip,
              outline: 'none',
              padding: '0 4px',
              boxSizing: 'border-box',
              zIndex: 2
            }}
          />
        ))}

      {/* A marker's name beside its flag, in whatever room there is before the
          next flag. Cut short rather than drawn across it: a name running
          under the next marker hides the thing it is next to. */}
      {inOrder(props.markers ?? []).map((m, i, all) => {
        if (m.name === '' || m.id === props.renamingId) return null
        const next = all[i + 1]
        const untilNext = next ? (next.frame - m.frame) * props.pxPerFrame - FLAG_W - 4 : NAME_MAX_W
        const room = Math.min(NAME_MAX_W, untilNext)
        // Too narrow to read a word in. The flag still says it is there, and
        // its tooltip still says what it is called.
        if (room < NAME_MIN_W) return null
        return (
          <span
            key={`${m.id}-name`}
            data-testid="marker-name"
            style={{
              position: 'absolute',
              left: m.frame * props.pxPerFrame + FLAG_W + 2,
              top: 0,
              font: type.monoSmall,
              lineHeight: `${FLAG_H}px`,
              color: ink.secondary,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              maxWidth: room,
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {m.name}
          </span>
        )
      })}

      {/*
        Zoomed in far enough to cut on a frame, a short line at every frame
        boundary, so where one frame ends and the next begins can be seen.
      */}
      {props.pxPerFrame >= FRAME_TICKS_FROM && (
        <div
          data-testid="ruler-frame-ticks"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 5,
            backgroundImage: `repeating-linear-gradient(to right, ${surface.lineStrong} 0 1px, transparent 1px ${props.pxPerFrame}px)`,
            pointerEvents: 'none'
          }}
        />
      )}
      {labels.map((f) => (
        <div
          key={f}
          data-testid="ruler-label"
          data-frame={f}
          style={{
            position: 'absolute',
            left: f * props.pxPerFrame,
            bottom: 0,
            font: type.monoSmall,
            color: ink.muted,
            paddingLeft: 4,
            borderLeft: `1px solid ${surface.lineStrong}`,
            height: 14,
            lineHeight: '14px',
            pointerEvents: 'none'
          }}
        >
          {formatTimecode(f, props.fps)}
        </div>
      ))}

      {/* Where a click would land. */}
      {hoverX !== null && hoverFrame !== null && (
        <>
          <div
            style={{
              position: 'absolute',
              left: hoverFrame * props.pxPerFrame,
              top: 0,
              bottom: 0,
              width: 1,
              background: surface.overlayLineStrong,
              pointerEvents: 'none'
            }}
          />
          <div
            data-testid="ruler-hover"
            style={{
              position: 'absolute',
              left: hoverFrame * props.pxPerFrame + 6,
              top: 3,
              font: type.monoSmall,
              color: ink.primary,
              background: surface.control,
              padding: '1px 4px',
              borderRadius: radius.chip,
              pointerEvents: 'none',
              whiteSpace: 'nowrap'
            }}
          >
            {formatTimecode(hoverFrame, props.fps)}
          </div>
        </>
      )}

      {/* The playhead's handle: the part that looks like something to grab. */}
      <div
        data-testid="playhead-head"
        style={{
          position: 'absolute',
          left: headX - 7,
          top: 2,
          width: 14,
          height: 16,
          background: meaning.playhead,
          borderTopLeftRadius: radius.handle,
          borderTopRightRadius: radius.handle,
          clipPath: 'polygon(0 0, 100% 0, 100% 62%, 50% 100%, 0 62%)',
          pointerEvents: 'none',
          boxShadow: elevation.raised
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: headX,
          top: 16,
          bottom: 0,
          width: 1,
          background: meaning.playhead,
          pointerEvents: 'none'
        }}
      />
    </div>
  )
}
