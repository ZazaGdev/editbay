import { memo, useEffect, useState, type JSX, type PointerEvent } from 'react'
import { kindName, type KindSet, type TransitionWindow } from '../../shared/transitions'
import { surface, ink, accent, meaning, radius, type } from '../theme'

/**
 * A transition on the timeline: a rectangle straddling a seam, drawn over both
 * clips it joins, with a grab handle at each end.
 *
 * Dragging an end changes how long it is; dragging the body slides it across
 * the seam, which changes its alignment and never moves the cut. Both are one
 * undo step, as a clip drag and the volume slider are.
 *
 * Its own file rather than more of `TrackClip.tsx`, which is long enough, and
 * because a transition is not a clip: it belongs to the seam between two.
 */

/** How wide each grab handle is, and the least the body can be and still be grabbable. */
const HANDLE_PX = 6
const BODY_PX = 10

/** How near a seam the pointer has to come for its button to appear. */
export const SEAM_REACH_PX = 12

/**
 * How much room a seam needs either side of it for its button, and how big the
 * button is on a row of a given height.
 *
 * On the seam, because that is the cut it belongs to and a button beside it is
 * a button you have to aim at. At the top of the row rather than the middle,
 * because a clip's trim handle is exactly there at the full height of the row:
 * a button over the middle of it eats every trim started by grabbing an edge,
 * which is how most of them start. The top strip is the one part of a clip
 * nobody grabs to trim.
 *
 * Where a seam has no room either side, on a cut between two clips a few pixels
 * wide, there is no button and the clip's menu and the keys are the way in.
 */
export const SEAM_ROOM_PX = 14

export function seamButtonSize(height: number): number {
  // As big as the row can spare without reaching the middle of it, which is
  // where a hand goes for a trim handle.
  return Math.max(12, Math.min(24, Math.round(height * 0.4), Math.round(height / 2) - 4))
}

/** What a drag is doing to the window. */
type Grab = 'start' | 'end' | 'body'

/**
 * Drawn again only when something about it changed: its handlers are steady
 * and say which window they are for, so a step of the playhead, which draws
 * the timeline again, leaves every transition as it was (audit 2026-10-08).
 */
export const ClipTransition = memo(function ClipTransition(props: {
  window: TransitionWindow
  /** Which set of kinds it comes from, for its name. */
  kinds: KindSet
  height: number
  pxPerFrame: number
  selected: boolean
  /** Picked out on its own, without the transition faded with it, as a double click takes it. */
  selectedAlone?: boolean | undefined
  /** How many frames at each end have no footage behind them and hold one frame. */
  held?: { head: number; tail: number } | undefined
  /**
   * Picked out. A picture and the sound faded with it are one transition to
   * anyone looking at them, so a press takes both; `alone` is the double click
   * that takes this one on its own, as Alt does on a clip.
   */
  onSelect: (w: TransitionWindow, alone: boolean) => void
  onMenu?: ((w: TransitionWindow, at: { x: number; y: number }) => void) | undefined
  /**
   * Where the drag has taken it, as a length and how much of it falls before
   * the seam. `continuing` marks every movement after the first, so one drag
   * is one undo step. `alone` leaves the clips linked to it out of it.
   */
  onDrag: (w: TransitionWindow, at: { length: number; before: number }, continuing: boolean, alone: boolean) => void
  /** Where the drag left it, once it lets go, so the length can be remembered for the next one. */
  onDragDone?: ((at: { length: number; before: number }) => void) | undefined
}): JSX.Element {
  const w = props.window
  const [grab, setGrab] = useState<{ how: Grab; startX: number; from: number; to: number; alone: boolean } | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  useEffect(() => {
    if (!grab) return
    const move = (e: globalThis.PointerEvent): void => {
      const moved = Math.round((e.clientX - grab.startX) / props.pxPerFrame)
      // Worked out from where the drag began every time, never added to where
      // it has got to, so a movement into a clamp and back gives back what the
      // clamp took. The clamps themselves live in `transitions.ts`, and they
      // are applied again when the window is read back.
      const from = grab.how === 'end' ? grab.from : grab.from + moved
      const to = grab.how === 'start' ? grab.to : grab.to + moved
      const length = Math.max(1, to - from)
      const before = Math.min(length, Math.max(0, w.cut - from))
      const key = `${length}:${before}`
      if (key === sent) return
      props.onDrag(w, { length, before }, sent !== null, grab.alone)
      setSent(key)
    }
    const up = (): void => {
      const last = sent?.split(':').map(Number)
      if (last && last.length === 2) props.onDragDone?.({ length: last[0]!, before: last[1]! })
      setGrab(null)
      setSent(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [grab, sent, props, w])

  const width = Math.max(BODY_PX, (w.to - w.from) * props.pxPerFrame)
  const start = (how: Grab) => (e: PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    props.onSelect(w, false)
    setSent(null)
    // Alt, or one already picked out on its own: the same rule a clip drag uses.
    setGrab({ how, startX: e.clientX, from: w.from, to: w.to, alone: e.altKey || props.selectedAlone === true })
  }

  const handle = {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: HANDLE_PX,
    cursor: 'ew-resize',
    background: props.selected ? accent.bright : surface.edge,
    opacity: 0.95
  }
  // The part with nothing behind it, hatched as Premiere's diagonal bars are.
  const hatch = `repeating-linear-gradient(45deg, ${meaning.attention}44 0 4px, transparent 4px 8px)`
  const head = (props.held?.head ?? 0) * props.pxPerFrame
  const tail = (props.held?.tail ?? 0) * props.pxPerFrame

  return (
    <div
      data-testid="clip-transition"
      data-clip={w.clipId}
      data-side={w.side}
      data-kind={w.kind}
      data-from={w.from}
      data-to={w.to}
      data-selected={props.selected ? 'yes' : 'no'}
      title={`${kindName(w.kind, props.kinds)}, ${w.to - w.from} frames`}
      onPointerDown={(e) => {
        e.stopPropagation()
        start('body')(e)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        props.onSelect(w, true)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        props.onSelect(w, false)
        props.onMenu?.(w, { x: e.clientX, y: e.clientY })
      }}
      style={{
        position: 'absolute',
        left: w.from * props.pxPerFrame,
        top: 3,
        width,
        height: props.height - 6,
        // Over both clips, and under the drop outline and the playhead.
        zIndex: 3,
        cursor: 'grab',
        borderRadius: radius.chip,
        border: `1px solid ${props.selected ? accent.bright : accent.tintLine}`,
        background: accent.band,
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {head > 0 && (
        <div data-testid="transition-held" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: head, background: hatch }} />
      )}
      {tail > 0 && (
        <div data-testid="transition-held" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: tail, background: hatch }} />
      )}
      {width > 64 && (
        <span style={{ font: type.meta, color: ink.primary, pointerEvents: 'none', whiteSpace: 'nowrap', padding: '0 10px' }}>
          {kindName(w.kind, props.kinds)}
        </span>
      )}
      <div data-testid="transition-start" onPointerDown={start('start')} style={{ ...handle, left: 0 }} />
      <div data-testid="transition-end" onPointerDown={start('end')} style={{ ...handle, right: 0 }} />
    </div>
  )
})

/**
 * The button that appears on a bare seam when the pointer comes near it, and
 * drops the default transition there.
 *
 * A click and never a drag. Clips, their edges, markers and transitions
 * already answer to a held pointer on the timeline, and a fifth would be one
 * too many.
 */
export function SeamButton(props: {
  at: number
  /** Just inside the clip on this side of the seam, rather than on it: an edge with nothing beside it, or at the view's edge. */
  inside?: 'left' | 'right' | undefined
  height: number
  pxPerFrame: number
  onAdd: () => void
}): JSX.Element {
  const size = seamButtonSize(props.height)
  const x = props.at * props.pxPerFrame
  const left = props.inside === 'right' ? x + 2 : props.inside === 'left' ? x - size - 2 : x - size / 2
  return (
    <button
      type="button"
      data-testid="seam-add"
      data-at={props.at}
      data-inside={props.inside ?? 'no'}
      title="Add a transition here"
      aria-label="Add a transition here"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        props.onAdd()
      }}
      style={{
        position: 'absolute',
        left,
        top: 2,

        width: size,
        height: size,
        zIndex: 5,
        display: 'grid',
        placeItems: 'center',
        padding: 0,
        border: `1px solid ${accent.base}`,
        borderRadius: radius.round,
        background: accent.base,
        color: ink.onAccent,
        font: type.title,
        lineHeight: 1,
        cursor: 'pointer'
      }}
    >
      +
    </button>
  )
}
