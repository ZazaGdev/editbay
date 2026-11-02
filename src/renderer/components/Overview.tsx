import { useCallback, useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { overviewBlocks, overviewFrames, scrollToShow, viewportFrames } from '../../shared/overview'
import type { Timeline } from '../../shared/project'
import { surface, ink, accent, meaning, track as trackColour, space, radius, type } from '../theme'
import { markColour } from '../../shared/marks'
import { IconButton } from '../ui/IconButton'
import { inOrder } from '../../shared/markers'
import { usePlayheadRead, type PlayheadStore } from '../state/playheadStore'

/** The playhead on the strip, drawn again on its own as it moves. */
function OverviewPlayhead({ playhead, frames }: { playhead: PlayheadStore; frames: number }): JSX.Element {
  const left = usePlayheadRead(playhead, (frame) => `${(frame / frames) * 100}%`)
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        left,
        top: -5,
        bottom: -5,
        width: 2,
        marginLeft: -1,
        background: meaning.playhead,
        pointerEvents: 'none'
      }}
    />
  )
}

/** How tall the strip is, and how tall each of its two rows is. */
export const OVERVIEW_HEIGHT = 44

/**
 * The whole edit at once, above the ruler: a block for every clip, the part
 * the timeline is showing boxed on it, and the playhead.
 *
 * It answers the one thing the timeline cannot, which is where you are in the
 * whole of it. Pressing it moves the view, never the playhead: it is where you
 * are looking, not where you are.
 */
export function Overview(props: {
  timeline: Timeline
  playhead: PlayheadStore
  /** The timeline's scroller, read for the box and moved when the strip is pressed. */
  scroller: {
    element: () => HTMLElement | null
    left: () => number
    width: () => number
    scrollTo: (px: number) => void
  }
  zoom: number
  /** Told when the strip is being dragged, so the timeline leaves the scroll alone. */
  onDragging?: ((on: boolean) => void) | undefined
  /** Put it away. Whether it is away belongs to the window, not to the project. */
  onHide: () => void
}): JSX.Element | null {
  const strip = useRef<HTMLDivElement>(null)
  /**
   * A drag under way: how far into the box it was taken, in frames, so the box
   * keeps the grip it was picked up by. Null when nothing is being dragged,
   * which is what a movement of the pointer alone is checked against.
   */
  const grabbed = useRef<number | null>(null)
  const [box, setBox] = useState<{ from: number; to: number }>({ from: 0, to: 0 })
  /** Whether the pointer is over the box, which is the one part of the strip a press takes hold of. */
  const [overBox, setOverBox] = useState(false)
  const frames = overviewFrames(props.timeline)
  const blocks = overviewBlocks(props.timeline)

  // The scroller's position is not React state, so the box follows its own
  // scroll and resize rather than a loop: a loop would read layout on every
  // frame for the life of the window, whether anything moved or not. The
  // timeline moves the scroller in code as well as by hand, and that fires a
  // scroll event too, so one listener catches both.
  const { scroller, zoom } = props
  /**
   * Read where the timeline is and draw the box there. A drag calls it the
   * moment it has moved the scroller, so the box is redrawn in the same breath
   * as the pointer rather than a frame or two later, when the scroll event
   * comes round.
   */
  const measure = useCallback((): void => {
    const seen = viewportFrames(scroller.left(), scroller.width(), zoom, frames)
    setBox((was) => (Math.abs(was.from - seen.from) < 0.5 && Math.abs(was.to - seen.to) < 0.5 ? was : seen))
  }, [scroller, zoom, frames])

  useEffect(() => {
    const el = scroller.element()
    let queued = 0
    // At most once a frame: a scroll fires far more often than that.
    const soon = (): void => {
      if (queued === 0)
        queued = window.requestAnimationFrame(() => {
          queued = 0
          measure()
        })
    }
    measure()
    el?.addEventListener('scroll', soon, { passive: true })
    const watch = el ? new ResizeObserver(soon) : null
    if (el) watch?.observe(el)
    return () => {
      if (queued !== 0) window.cancelAnimationFrame(queued)
      el?.removeEventListener('scroll', soon)
      watch?.disconnect()
    }
  }, [scroller, measure])

  if (blocks.length === 0) return null

  /** The frame under a pointer on the strip. */
  const frameAt = (clientX: number): number => {
    const r = strip.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return 0
    return Math.max(0, Math.min(frames, ((clientX - r.left) / r.width) * frames))
  }

  /** Where the timeline is now, read from the scroller rather than from the last render. */
  const seenNow = (): { from: number; to: number } =>
    viewportFrames(props.scroller.left(), props.scroller.width(), props.zoom, frames)

  /**
   * Pressing the box takes hold of it, picked up where it was touched, and it
   * keeps that grip for the whole drag. Pressing anywhere else on the strip
   * does nothing: nothing moves until the box itself is dragged, so the strip
   * never shifts under a pointer still deciding where to go.
   *
   * The grip is what keeps the drag one for one: centring on the pointer every
   * time meant a box taken by its left edge jumped out from under the press
   * and then sat still until the pointer had travelled half a view.
   */
  const press = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const frame = frameAt(e.clientX)
    const seen = seenNow()
    if (frame < seen.from || frame > seen.to) return
    grabbed.current = frame - seen.from
    props.onDragging?.(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  /**
   * The box's left edge goes where the pointer says, less the grip, so it
   * tracks the pointer one for one until the timeline runs out of scroll.
   * Worked out from where the pointer is rather than how far it has moved, so
   * a drag that ran past either end picks the box up again on the way back
   * instead of carrying an offset it collected there.
   */
  const move = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const grip = grabbed.current
    if (grip === null) {
      // Only to say what a press would do here: the hand over the box, nothing elsewhere.
      const frame = frameAt(e.clientX)
      setOverBox(frame >= box.from && frame <= box.to)
      return
    }
    props.scroller.scrollTo(scrollToShow(frameAt(e.clientX) - grip, props.scroller.width(), props.zoom, frames))
    measure()
  }

  const letGo = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (grabbed.current === null) return
    grabbed.current = null
    props.onDragging?.(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const percent = (frame: number): string => `${(frame / frames) * 100}%`
  const rowFor = (kind: 'video' | 'audio'): { top: number; height: number } =>
    kind === 'video' ? { top: 0, height: 13 } : { top: 15, height: 13 }

  return (
    <div
      data-testid="overview"
      data-from={box.from.toFixed(1)}
      data-to={box.to.toFixed(1)}
      data-frames={frames}
      style={{
        height: OVERVIEW_HEIGHT,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'stretch',
        background: surface.canvas,
        borderBottom: `1px solid ${surface.line}`
      }}
    >
      <span
        style={{
          width: 46,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${space.sm}px`,
          boxSizing: 'border-box',
          font: type.label,
          letterSpacing: type.labelTracking,
          color: ink.muted,
          borderRight: `1px solid ${surface.line}`
        }}
      >
        ALL
      </span>
      <div
        ref={strip}
        title="The whole edit. Drag the box to move what the timeline is showing."
        onPointerDown={press}
        onPointerMove={move}
        onPointerUp={letGo}
        onPointerCancel={letGo}
        onPointerLeave={() => setOverBox(false)}
        style={{ flexGrow: 1, position: 'relative', padding: `7px ${space.sm}px`, boxSizing: 'border-box', cursor: overBox ? 'grab' : 'default', touchAction: 'none' }}
      >
        <div style={{ position: 'relative', height: '100%' }}>
          {blocks.map((b, i) => {
            const row = rowFor(b.kind)
            return (
              <span
                key={`${b.kind}${b.trackIndex}-${b.from}-${i}`}
                data-testid="overview-block"
                data-kind={b.kind}
                data-mark={b.mark ?? ''}
                style={{
                  position: 'absolute',
                  left: percent(b.from),
                  width: `calc(${percent(b.to - b.from)} - 1px)`,
                  top: row.top,
                  height: row.height,
                  minWidth: 1,
                  borderRadius: radius.handle,
                  background: markColour(b.mark) ?? (b.kind === 'video' ? trackColour.picture : trackColour.sound),
                  // Quiet enough that the box and the playhead read over them.
                  // A marked clip is a little stronger: the point of marking one
                  // is to find it again on a strip of two hundred.
                  opacity: b.mark === undefined ? 0.35 : 0.7
                }}
              />
            )
          })}

          {/* A tick per marker, so the whole edit says where the notes are.
              Drawn under the box and the playhead, and not a target: the strip
              is for looking, and the flags on the ruler are for pressing. */}
          {inOrder(props.timeline.markers).map((m) => (
            <span
              key={m.id}
              aria-hidden="true"
              data-testid="overview-marker"
              data-frame={m.frame}
              style={{
                position: 'absolute',
                left: percent(m.frame),
                top: -5,
                height: 6,
                width: 2,
                marginLeft: -1,
                background: markColour(m.colour) ?? accent.base,
                pointerEvents: 'none'
              }}
            />
          ))}

          {/* What the timeline is showing, boxed. */}
          <span
            data-testid="overview-box"
            style={{
              position: 'absolute',
              left: percent(box.from),
              width: `max(3px, ${percent(Math.max(0, box.to - box.from))})`,
              top: -3,
              bottom: -3,
              border: `1.5px solid ${accent.bright}`,
              borderRadius: radius.chip,
              background: accent.tint,
              boxSizing: 'border-box',
              pointerEvents: 'none'
            }}
          />

          <OverviewPlayhead playhead={props.playhead} frames={frames} />
        </div>
      </div>
      {/*
        Put the whole row away. In its own cell at the end rather than over the
        strip: the strip is a target, and a button floating on it would be one
        more thing to miss the strip with.
      */}
      <span style={{ display: 'flex', alignItems: 'center', padding: `0 ${space.xs}px` }}>
        <IconButton
          icon="close"
          label="Hide the strip showing the whole edit"
          testid="overview-hide"
          size="small"
          variant="ghost"
          onClick={props.onHide}
        />
      </span>
    </div>
  )
}
