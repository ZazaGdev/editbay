import { useEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import type { Rect } from '../../shared/project'
import { boxLines, fitInBox, joinLines, linesUnder, nearestLine, safeLines, sidesUnder, sourceToDisplay, moveCrop, resizeCrop, snapBox, frameLines, type Handle } from '../../shared/crop-geometry'
import { moveFreeBox, placeFromPixels, scaleFreeBox, stretchFreeBox, stretchPlace, tidyAngle, type Edge, type Place } from '../../shared/layout'
import { PIP_CORNERS, placeAtCorner, snapToCorner, type PipCorner } from '../../shared/pip'
import { accent, ink, meaning, radius, surface, type } from '../theme'

const HANDLE_SIZE = 12
/** How near, in screen pixels, a moved place must come to a line to snap to it. */
const SNAP_PX = 8
const CORNERS: Handle[] = ['nw', 'ne', 'sw', 'se']
/** How far above the box the rotate handle sits, in screen pixels. */
const TURN_REACH = 28
/** How near a quarter turn, in degrees, a turn snaps to it. */
const TURN_SNAP = 6
const EDGES: Edge[] = ['n', 's', 'e', 'w']
/**
 * How near, in screen pixels, a dragged picture in picture must come to a
 * corner to snap into it. Half what it was: a picture put near a corner by
 * hand kept jumping into it.
 */
const CORNER_SNAP_PX = 20

type DragState = (
  | { kind: 'move'; fromX: number; fromY: number; start: Rect; fromGrab?: boolean }
  | { kind: 'corner'; handle: Handle; fromX: number; fromY: number; start: Rect }
  | { kind: 'edge'; edge: Edge; fromX: number; fromY: number; start: Rect }
  | { kind: 'scale'; fromX: number; fromY: number; start: Rect; centre: { x: number; y: number } }
  | { kind: 'turn'; fromX: number; fromY: number; start: Rect; centre: { x: number; y: number }; was: number }
) & { crop: Rect }

/**
 * The selected picture's place, outlined over the output view.
 *
 * Drag inside it to move it; drag a corner to scale it, keeping its shape;
 * drag an edge to change its shape. It works in output pixels with the same
 * geometry the crop box uses, and hands back fractions of the frame.
 */
export function PlaceOverlay(props: {
  place: Place
  /** The picture's crop now, kept at the start of a drag for the whole drag to reshape. */
  crop: Rect
  frameWidth: number
  frameHeight: number
  boxWidth: number
  boxHeight: number
  /**
   * `continuing` is true for every movement of a drag after the first.
   * `reshaped` is true when an edge was dragged, the only drag that changes
   * the place's shape, so only then does a locked crop need to follow it.
   * `fromCrop` is the crop the drag began with.
   */
  onChange: (place: Place, continuing: boolean, reshaped: boolean, fromCrop: Rect) => void
  /**
   * Where a pointer that is still down pressed the picture this box has just
   * appeared for. The press that picked it goes straight on to move it, so
   * picking a picture up and putting it somewhere is one movement.
   */
  grab?: { x: number; y: number } | undefined
  /**
   * An overlay's box, which may reach past the frame and turn: moved and
   * scaled with a margin of it kept on the frame, with a handle to turn it.
   */
  free?: { rotation: number; onTurn: (degrees: number, continuing: boolean) => void; edges?: boolean } | undefined
  /**
   * A picture in picture's small picture: while it is dragged the four corners
   * it can go to show, the nearest lit, and let go near one it snaps there,
   * this far in from the edges. Alt lets it go anywhere, as with the lines.
   * `circle` and `aspect` give the corner boxes the shape the picture has.
   */
  corners?: { margin: number; aspect: number; circle: boolean; onSnap: (corner: PipCorner) => void } | undefined
  /**
   * Everything else on the Output view now, in output pixels: a moved box
   * lines up with their edges and middles as well as the frame's.
   */
  others?: readonly Rect[] | undefined
  /** The title safe area, in output pixels: a moved or resized box lines up with its sides too. */
  safe?: Rect | undefined
  /**
   * Bugs and notes 2, note 23: whether a drag snaps to the lines and the
   * corners. Alt held does the opposite for that drag, whichever this is.
   */
  snap?: boolean | undefined
  /** The picture's own colour, for its box and handles, and its name on a tag on the box. */
  colour?: string | undefined
  tag?: string | undefined
}): JSX.Element | null {
  const colour = props.colour ?? meaning.attention
  const snapping = props.snap !== false
  /** Whether a movement goes exactly where the pointer takes it. */
  const loose = (e: { altKey: boolean }): boolean => (snapping ? e.altKey : !e.altKey)
  // The output frame, fitted in the monitor the way the canvas draws it.
  const fit = fitInBox(props.frameWidth, props.frameHeight, props.boxWidth, props.boxHeight)
  const W = props.frameWidth
  const H = props.frameHeight
  const px: Rect = { x: props.place.x * W, y: props.place.y * H, w: props.place.w * W, h: props.place.h * H }
  const [drag, setDrag] = useState<DragState | null>(() =>
    props.grab
      ? {
          kind: 'move',
          fromX: props.grab.x,
          fromY: props.grab.y,
          start: { x: Math.round(px.x), y: Math.round(px.y), w: Math.round(px.w), h: Math.round(px.h) },
          crop: props.crop,
          fromGrab: true
        }
      : null
  )
  const moved = useRef(false)
  /** The corner a dragged picture in picture is near enough to snap into now, if any. */
  const [nearCorner, setNearCorner] = useState<PipCorner | null>(null)
  const near = useRef<PipCorner | null>(null)
  /**
   * What letting go does, for the listener the press adds as it begins: the
   * drag's own ending once its effect is listening, which snaps and clears
   * the lines, and a plain stop before then.
   */
  const finish = useRef<() => void>(() => setDrag(null))
  /** The lines a moved box is snapped to now, drawn across the frame while it holds. */
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  // A drag carried on from the press that picked the picture ends when that
  // press does, which the monitor sees, since it began before this box was here.
  const grabbed = props.grab !== undefined
  useEffect(() => {
    if (!grabbed) setDrag((d) => (d && d.kind === 'move' && d.fromGrab ? null : d))
  }, [grabbed])

  useEffect(() => {
    if (!drag || !(fit.scale > 0)) return
    const bounds = { w: W, h: H }
    // The frame's edges, middles and thirds, the title safe area, and the other boxes on screen.
    const lines = joinLines(
      joinLines(frameLines(W, H), boxLines(props.others ?? [], W, H)),
      props.safe ? safeLines(props.safe) : { edgesX: [], centresX: [], edgesY: [], centresY: [] }
    )
    const within = SNAP_PX / fit.scale
    const showHit = (hit: { x: number[]; y: number[] }): void =>
      setGuides((was) => (was.x.join() === hit.x.join() && was.y.join() === hit.y.join() ? was : hit))
    const show = (rect: Rect | null): void => showHit(rect ? linesUnder(rect, lines) : { x: [], y: [] })

    const move = (e: globalThis.PointerEvent): void => {
      const dx = (e.clientX - drag.fromX) / fit.scale
      const dy = (e.clientY - drag.fromY) / fit.scale
      let next: Rect
      if (drag.kind === 'turn') {
        // The pointer's angle about the centre, from straight up, clockwise.
        const angle = (p: { x: number; y: number }): number => (Math.atan2(p.x - drag.centre.x, drag.centre.y - p.y) * 180) / Math.PI
        // From the angle it had when the drag began, not the one the last movement gave it.
        const turned = drag.was + angle({ x: e.clientX, y: e.clientY }) - angle({ x: drag.fromX, y: drag.fromY })
        props.free?.onTurn(tidyAngle(turned, e.shiftKey ? 0 : TURN_SNAP), moved.current)
        moved.current = true
        return
      }
      if (drag.kind === 'scale') {
        // By the pointer's distance from the centre, which holds however the box is turned.
        const far = (x: number, y: number): number => Math.hypot(x - drag.centre.x, y - drag.centre.y)
        next = scaleFreeBox(drag.start, far(e.clientX, e.clientY) / Math.max(1, far(drag.fromX, drag.fromY)), W, H)
        if (!loose(e)) {
          // The side nearest a line takes the box to it, grown or shrunk about its middle.
          const s = drag.start
          const cx = s.x + s.w / 2
          const cy = s.y + s.h / 2
          const ks = [
            ...[next.x, next.x + next.w].map((at) => ({ at, t: nearestLine(at, lines.edgesX, within), k: (t: number) => (2 * Math.abs(t - cx)) / s.w })),
            ...[next.y, next.y + next.h].map((at) => ({ at, t: nearestLine(at, lines.edgesY, within), k: (t: number) => (2 * Math.abs(t - cy)) / s.h }))
          ].filter((c): c is { at: number; t: number; k: (t: number) => number } => c.t !== null)
          const best = ks.sort((a, b) => Math.abs(a.t - a.at) - Math.abs(b.t - b.at))[0]
          if (best) next = scaleFreeBox(s, best.k(best.t), W, H)
        }
        showHit(loose(e) ? { x: [], y: [] } : sidesUnder([next.x, next.x + next.w], [next.y, next.y + next.h], lines))
      } else if (drag.kind === 'move' && props.free) {
        next = moveFreeBox(drag.start, dx, dy, W, H)
        if (!loose(e)) {
          const snapped = snapBox(next, lines, SNAP_PX / fit.scale)
          next = moveFreeBox(snapped, 0, 0, W, H)
        }
        show(loose(e) ? null : next)
      } else if (drag.kind === 'move') {
        next = moveCrop(drag.start, dx, dy, bounds)
        // To the frame's edges, middles and thirds, and the other boxes. Alt lets it go anywhere.
        if (!loose(e)) next = moveCrop(snapBox(next, lines, SNAP_PX / fit.scale), 0, 0, bounds)
        show(loose(e) ? null : next)
        if (props.corners) {
          const corner = loose(e) ? null : snapToCorner(placeFromPixels(next, W, H), props.corners.margin, W, H, CORNER_SNAP_PX / fit.scale)
          near.current = corner
          setNearCorner(corner)
        }
      } else if (drag.kind === 'corner') {
        const s = drag.start
        const aspect = s.w / s.h
        const growsLeft = drag.handle === 'nw' || drag.handle === 'sw'
        const growsUp = drag.handle === 'nw' || drag.handle === 'ne'
        next = resizeCrop(s, drag.handle, dx, dy, aspect, bounds)
        const sideX = (r: Rect): number => (growsLeft ? r.x : r.x + r.w)
        const sideY = (r: Rect): number => (growsUp ? r.y : r.y + r.h)
        if (!loose(e)) {
          // The moving corner's side nearest a line goes to it, the other side following the shape.
          const tx = nearestLine(sideX(next), lines.edgesX, within)
          const ty = nearestLine(sideY(next), lines.edgesY, within)
          const byX = tx !== null && (ty === null || Math.abs(tx - sideX(next)) <= Math.abs(ty - sideY(next)))
          if (tx !== null || ty !== null) {
            const w = byX ? Math.abs(tx! - (growsLeft ? s.x + s.w : s.x)) : Math.abs(ty! - (growsUp ? s.y + s.h : s.y)) * aspect
            const h = w / aspect
            next = resizeCrop(s, drag.handle, growsLeft ? s.w - w : w - s.w, growsUp ? s.h - h : h - s.h, aspect, bounds)
          }
        }
        showHit(loose(e) ? { x: [], y: [] } : sidesUnder([sideX(next)], [sideY(next)], lines))
      } else {
        const across = drag.edge === 'e' || drag.edge === 'w'
        let delta = across ? dx : dy
        const s = drag.start
        const side = (r: Rect): number => (drag.edge === 'e' ? r.x + r.w : drag.edge === 'w' ? r.x : drag.edge === 's' ? r.y + r.h : r.y)
        if (!loose(e)) {
          // The dragged side to a line near it.
          const t = nearestLine(side(s) + delta, across ? lines.edgesX : lines.edgesY, within)
          if (t !== null) delta = t - side(s)
        }
        // An overlay's box may be past the frame already: its edges are not held to it.
        next = props.free ? stretchFreeBox(s, drag.edge, delta, W, H) : stretchPlace(s, drag.edge, delta, bounds)
        showHit(loose(e) ? { x: [], y: [] } : across ? sidesUnder([side(next)], [], lines) : sidesUnder([], [side(next)], lines))
      }
      props.onChange(placeFromPixels(next, W, H), moved.current, drag.kind === 'edge', drag.crop)
      moved.current = true
    }
    let done = false
    const up = (): void => {
      // Heard twice, from here and from the press that began the drag: acted on once.
      if (done) return
      done = true
      // Let go near a corner: it goes into it, as part of the same drag.
      if (drag.kind === 'move' && moved.current && near.current) props.corners?.onSnap(near.current)
      near.current = null
      setNearCorner(null)
      setGuides({ x: [], y: [] })
      setDrag(null)
    }
    finish.current = up

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (finish.current === up) finish.current = () => setDrag(null)
    }
  }, [drag, fit.scale, props, W, H])

  if (!(fit.scale > 0)) return null
  const box = sourceToDisplay(px, fit)
  const start = { x: Math.round(px.x), y: Math.round(px.y), w: Math.round(px.w), h: Math.round(px.h) }

  const begin =
    (state: (e: PointerEvent) => Omit<DragState, 'crop'>) =>
    (e: PointerEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      moved.current = false
      setDrag({ ...state(e), crop: props.crop } as DragState)
      // Listened for now, not once the drag's effect has run: a press let go
      // before then would leave the box following a pointer with no button held.
      window.addEventListener('pointerup', () => finish.current(), { once: true })
    }

  const handle: React.CSSProperties = {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    background: colour,
    borderRadius: radius.handle
  }

  const cornerStyle = (c: Handle): React.CSSProperties => ({
    ...handle,
    cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize',
    left: c === 'nw' || c === 'sw' ? -HANDLE_SIZE / 2 : undefined,
    right: c === 'ne' || c === 'se' ? -HANDLE_SIZE / 2 : undefined,
    top: c === 'nw' || c === 'ne' ? -HANDLE_SIZE / 2 : undefined,
    bottom: c === 'sw' || c === 'se' ? -HANDLE_SIZE / 2 : undefined
  })

  const edgeStyle = (e: Edge): React.CSSProperties => ({
    ...handle,
    width: e === 'n' || e === 's' ? HANDLE_SIZE * 2 : HANDLE_SIZE / 2,
    height: e === 'e' || e === 'w' ? HANDLE_SIZE * 2 : HANDLE_SIZE / 2,
    cursor: e === 'n' || e === 's' ? 'ns-resize' : 'ew-resize',
    left: e === 'w' ? -HANDLE_SIZE / 4 : e === 'e' ? undefined : `calc(50% - ${HANDLE_SIZE}px)`,
    right: e === 'e' ? -HANDLE_SIZE / 4 : undefined,
    top: e === 'n' ? -HANDLE_SIZE / 4 : e === 's' ? undefined : `calc(50% - ${HANDLE_SIZE}px)`,
    bottom: e === 's' ? -HANDLE_SIZE / 4 : undefined
  })

  const p = props.place
  const turn = props.free?.rotation ?? 0
  /** Where the box's centre is on screen, which a scale or a turn is about. */
  const centreOf = (e: PointerEvent): { x: number; y: number } => {
    const r = (e.currentTarget as HTMLElement).closest('[data-testid="place-rect"]')!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  // Where a dragged picture in picture could go: its box in each corner.
  const cornerBoxes =
    props.corners && drag?.kind === 'move' && moved.current
      ? PIP_CORNERS.map((c) => {
          const at = placeAtCorner(c, p.w, props.corners!.margin, props.corners!.aspect, props.corners!.circle, W, H)
          return { corner: c, box: sourceToDisplay({ x: at.x * W, y: at.y * H, w: at.w * W, h: at.h * H }, fit) }
        })
      : []
  return (
    // One element, over the whole Output view, holding the box and where it
    // could snap to: the preview draws into the same parent, and siblings of
    // their own there were left behind on screen after each change.
    <div data-testid="place-layer" style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
    {/* The lines a moved box has snapped to, across the whole frame, only while the snap holds. */}
    {guides.x.map((x) => {
      const a = sourceToDisplay({ x, y: 0, w: 0, h: H }, fit)
      return <div key={`x${x}`} data-testid="snap-line" data-axis="x" data-at={x} aria-hidden="true" style={{ position: 'absolute', left: a.x - 0.5, top: a.y, width: 1, height: a.h, background: accent.bright }} />
    })}
    {guides.y.map((y) => {
      const a = sourceToDisplay({ x: 0, y, w: W, h: 0 }, fit)
      return <div key={`y${y}`} data-testid="snap-line" data-axis="y" data-at={y} aria-hidden="true" style={{ position: 'absolute', left: a.x, top: a.y - 0.5, width: a.w, height: 1, background: accent.bright }} />
    })}
    {/* While a picture is moved, what Alt does, since nothing else on screen says. */}
    {drag !== null && moved.current && drag.kind !== 'turn' && (
      <span
        data-testid="place-alt-hint"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: Math.max(4, box.x),
          top: Math.max(4, box.y + box.h + 6),
          zIndex: 3,
          padding: '2px 6px',
          font: type.meta,
          color: ink.primary,
          background: surface.overlay,
          borderRadius: radius.chip,
          whiteSpace: 'nowrap',
          pointerEvents: 'none'
        }}
      >
        {snapping ? 'Alt: place freely' : 'Alt: snap'}
      </span>
    )}
    {cornerBoxes.map(({ corner, box: b }) => (
      <div
        key={corner}
        data-testid="pip-snap-target"
        data-corner={corner}
        data-near={corner === nearCorner ? 'yes' : 'no'}
        aria-hidden="true"
        style={{
          position: 'absolute',
          zIndex: 2,
          left: b.x,
          top: b.y,
          width: b.w,
          height: b.h,
          boxSizing: 'border-box',
          borderRadius: props.corners!.circle ? radius.round : radius.chip,
          border: corner === nearCorner ? `2px solid ${accent.bright}` : `1px dashed ${surface.overlayLineStrong}`,
          background: corner === nearCorner ? accent.tint : 'transparent',
          pointerEvents: 'none'
        }}
      />
    ))}
    <div
      data-testid="place-rect"
      data-place={[p.x, p.y, p.w, p.h].map((n) => n.toFixed(4)).join(',')}
      data-snap={snapping ? 'yes' : 'no'}
      title={snapping ? 'Drag to move. It snaps to the edges and middles: hold Alt to place it freely' : 'Drag to move. Hold Alt to snap it to the edges and middles'}
      data-rotation={turn}
      onPointerDown={begin((e) => ({ kind: 'move', fromX: e.clientX, fromY: e.clientY, start }))}
      style={{
        position: 'absolute',
        zIndex: 2,
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        pointerEvents: 'auto',
        border: `1px solid ${colour}`,
        boxSizing: 'border-box',
        cursor: 'move',
        touchAction: 'none',
        // Turned about its middle, handles and all, as the picture is.
        ...(turn !== 0 ? { transform: `rotate(${turn}deg)` } : {})
      }}
    >
      {props.tag && (
        <span
          data-testid="place-tag"
          style={{
            position: 'absolute',
            left: -1,
            bottom: '100%',
            marginBottom: 2,
            padding: '0 5px',
            font: type.meta,
            fontWeight: 600,
            lineHeight: '16px',
            borderRadius: radius.handle,
            whiteSpace: 'nowrap',
            background: colour,
            color: ink.onAccent,
            pointerEvents: 'none'
          }}
        >
          {props.tag}
        </span>
      )}
      {CORNERS.map((c) => (
        <div
          key={c}
          data-testid={`place-${c}`}
          onPointerDown={begin((e) =>
            props.free
              ? { kind: 'scale', fromX: e.clientX, fromY: e.clientY, start, centre: centreOf(e) }
              : { kind: 'corner', handle: c, fromX: e.clientX, fromY: e.clientY, start }
          )}
          style={cornerStyle(c)}
        />
      ))}
      {props.free && (
        <>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 'calc(50% - 0.5px)',
              top: -TURN_REACH,
              width: 1,
              height: TURN_REACH,
              background: colour,
              pointerEvents: 'none'
            }}
          />
          <div
            data-testid="place-turn"
            title="Drag to turn it. It snaps to a quarter turn; hold Shift to turn it freely."
            onPointerDown={begin((e) => ({ kind: 'turn', fromX: e.clientX, fromY: e.clientY, start, centre: centreOf(e), was: turn }))}
            style={{
              ...handle,
              borderRadius: radius.round,
              left: `calc(50% - ${HANDLE_SIZE / 2}px)`,
              top: -TURN_REACH - HANDLE_SIZE / 2,
              cursor: 'grab'
            }}
          />
        </>
      )}
      {/* Reshaping a turned box is a feature of its own: a turned one scales from its corners only. */}
      {turn === 0 && props.free?.edges !== false && EDGES.map((edge) => (
        <div
          key={edge}
          data-testid={`place-${edge}`}
          onPointerDown={begin((e) => ({ kind: 'edge', edge, fromX: e.clientX, fromY: e.clientY, start }))}
          style={edgeStyle(edge)}
        />
      ))}
    </div>
    </div>
  )
}
