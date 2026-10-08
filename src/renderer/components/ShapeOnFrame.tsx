import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { bodyWithin, linePoints, shapeFromDrag, type Point, type ShapeStyle } from '../../shared/shape'
import type { Place } from '../../shared/layout'
import { accent, ink } from '../theme'

/** Where the frame is drawn in the view, as the Output view fits it: its corner and its size in view pixels. */
export interface FrameInView {
  offsetX: number
  offsetY: number
  width: number
  height: number
}

/** A pointer's place on the frame, in output pixels. */
function onFrame(e: { clientX: number; clientY: number }, el: HTMLElement, frame: FrameInView, frameW: number): Point {
  const r = el.getBoundingClientRect()
  const k = frameW / frame.width
  return { x: (e.clientX - r.left - frame.offsetX) * k, y: (e.clientY - r.top - frame.offsetY) * k }
}

/** An outline of a shape as an SVG path, in view pixels, while it is drawn or its ends dragged. */
function outlinePath(style: ShapeStyle, from: Point, to: Point, bend: Point | null): string {
  if (style.kind === 'line') return bend ? `M${from.x},${from.y} Q${bend.x},${bend.y} ${to.x},${to.y}` : `M${from.x},${from.y} L${to.x},${to.y}`
  const x = Math.min(from.x, to.x)
  const y = Math.min(from.y, to.y)
  const w = Math.abs(to.x - from.x)
  const h = Math.abs(to.y - from.y)
  if (style.kind === 'ellipse') return `M${x},${y + h / 2} a${w / 2},${h / 2} 0 1,0 ${w},0 a${w / 2},${h / 2} 0 1,0 ${-w},0`
  return `M${x},${y} h${w} v${h} h${-w} Z`
}

/**
 * The Output view while a shape is being drawn: a press and a drag across
 * the frame, from where an arrow starts to where it points, or corner to
 * corner for a box. A click with no drag makes one of a usable size there.
 * A pen or a highlighter follows the pointer the whole way (plan 88).
 * Escape, handled by the window, stops drawing. Once let go, the outline
 * stays where it was until the shape's own picture is drawn and this goes,
 * so the frame never shows neither (task 86).
 */
export function ShapeDraw(props: {
  style: ShapeStyle
  bent: number
  frame: FrameInView
  frameW: number
  /** Where the drag began and ended, and every place the pointer passed on the way, in output pixels. */
  onDrawn: (a: Point, b: Point, path: Point[]) => void
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ a: Point; b: Point } | null>(null)
  const [letGo, setLetGo] = useState(false)
  /** The pointer's path, kept as it moves: too many points for state, drawn from the last few. */
  const path = useRef<Point[]>([])
  const k = props.frame.width / props.frameW
  const view = (p: Point): Point => ({ x: props.frame.offsetX + p.x * k, y: props.frame.offsetY + p.y * k })
  const pen = props.style.kind === 'pen'
  const preview = drag
    ? pen
      ? path.current.map((p, i) => `${i === 0 ? 'M' : 'L'}${view(p).x},${view(p).y}`).join(' ')
      : (() => {
        const made = shapeFromDrag(props.style, drag.a, drag.b, props.bent)
        if (props.style.kind === 'line') {
          const pts = linePoints(made.style, made.body)
          return outlinePath(props.style, view(pts.from), view(pts.to), pts.bend ? view(pts.bend) : null)
        }
        return outlinePath(props.style, view({ x: made.body.x, y: made.body.y }), view({ x: made.body.x + made.body.w, y: made.body.y + made.body.h }), null)
      })()
    : null
  return (
    <div
      ref={box}
      data-testid="shape-draw"
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || letGo) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        const at = onFrame(e, e.currentTarget, props.frame, props.frameW)
        path.current = [at]
        setDrag({ a: at, b: at })
      }}
      onPointerMove={(e) => {
        if (!drag || letGo || !box.current) return
        const b = onFrame(e, box.current, props.frame, props.frameW)
        path.current.push(b)
        setDrag({ a: drag.a, b })
      }}
      onPointerUp={(e) => {
        if (!drag || letGo || !box.current) return
        const b = onFrame(e, box.current, props.frame, props.frameW)
        path.current.push(b)
        setDrag({ a: drag.a, b })
        setLetGo(true)
        props.onDrawn(drag.a, b, [...path.current])
      }}
      style={{ position: 'absolute', inset: 0, zIndex: 30, cursor: letGo ? undefined : 'crosshair', pointerEvents: letGo ? 'none' : undefined }}
    >
      {preview && (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
          <path
            d={preview}
            fill="none"
            stroke={props.style.strokeWidth > 0 ? props.style.stroke : (props.style.fill ?? accent.bright)}
            strokeWidth={Math.max(2, props.style.strokeWidth * k)}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={(props.style.strokeOpacity ?? 1) * 0.85}
          />
        </svg>
      )}
    </div>
  )
}

const HANDLE = 12

/**
 * The ends of a selected line or arrow on the Output view, and its bend: drag
 * an end to point it somewhere else, and the middle one to bend it. A straight
 * line's middle handle bends it too. The line is drawn again, sharp, when the
 * drag ends; meanwhile its outline follows the pointer, and the picture it had
 * is hidden until the new one is in, so it never shows as two (task 59).
 */
export function ShapeHandles(props: {
  style: ShapeStyle
  /** Where its picture is on the frame. */
  place: Place
  frame: FrameInView
  frameW: number
  frameH: number
  onChange: (from: Point, to: Point, bend: Point | null) => void
  /** The shape's own picture hidden while its outline stands in for it, or shown again. */
  onHide?: ((hidden: boolean) => void) | undefined
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const { style, place, frameW, frameH, onHide } = props
  const picture = { x: place.x * frameW, y: place.y * frameH, w: place.w * frameW, h: place.h * frameH }
  const now = linePoints(style, bodyWithin(style, picture))
  const [moving, setMoving] = useState<{ which: 'from' | 'to' | 'bend'; points: { from: Point; to: Point; bend: Point | null } } | null>(null)
  /** Let go, and waiting for the shape drawn again: its outline stays where it was let go. */
  const [waiting, setWaiting] = useState<{ which: 'from' | 'to' | 'bend'; points: { from: Point; to: Point; bend: Point | null } } | null>(null)
  const outlined = moving ?? waiting
  const pts = outlined?.points ?? now
  useEffect(() => onHide?.(outlined !== null), [outlined !== null, onHide])
  useEffect(() => () => onHide?.(false), [onHide])
  // The new picture is in once the shape or its place changes; a change that never comes is not waited on for long.
  useEffect(() => setWaiting(null), [style, place])
  useEffect(() => {
    if (!waiting) return
    const t = window.setTimeout(() => setWaiting(null), 3000)
    return () => window.clearTimeout(t)
  }, [waiting])
  const k = props.frame.width / frameW
  const view = (p: Point): Point => ({ x: props.frame.offsetX + p.x * k, y: props.frame.offsetY + p.y * k })
  const middle = pts.bend ?? { x: (pts.from.x + pts.to.x) / 2, y: (pts.from.y + pts.to.y) / 2 }

  const start = (which: 'from' | 'to' | 'bend') => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setMoving({ which, points: now })
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!moving || !box.current) return
    const at = onFrame(e, box.current, props.frame, frameW)
    setMoving({ which: moving.which, points: { ...moving.points, [moving.which]: at } })
  }
  const end = (): void => {
    if (!moving) return
    const p = moving.points
    setMoving(null)
    setWaiting(moving)
    // A bend dragged back onto the straight line straightens it.
    const bend = p.bend && distanceToLine(p.bend, p.from, p.to) > 4 ? p.bend : null
    props.onChange(p.from, p.to, bend)
  }

  const handle = (which: 'from' | 'to' | 'bend', p: Point, title: string): JSX.Element => {
    const v = view(p)
    return (
      <div
        data-testid={`shape-handle-${which}`}
        title={title}
        onPointerDown={start(which)}
        onPointerMove={move}
        onPointerUp={end}
        style={{
          position: 'absolute',
          left: v.x - HANDLE / 2,
          top: v.y - HANDLE / 2,
          width: HANDLE,
          height: HANDLE,
          borderRadius: which === 'bend' ? 3 : HANDLE,
          background: which === 'bend' ? accent.base : ink.primary,
          border: `2px solid ${accent.bright}`,
          boxSizing: 'border-box',
          cursor: 'move',
          zIndex: 31,
          pointerEvents: 'auto'
        }}
      />
    )
  }
  const lineWidth = Math.max(2, style.strokeWidth * k)
  return (
    <div ref={box} data-testid="shape-handles" style={{ position: 'absolute', inset: 0, zIndex: 31, pointerEvents: 'none' }}>
      {outlined && (
        <svg data-testid="shape-outline" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
          <path
            d={outlinePath(style, view(pts.from), view(pts.to), pts.bend ? view(pts.bend) : outlined.which === 'bend' ? view(middle) : null)}
            fill="none"
            stroke={style.stroke}
            strokeWidth={lineWidth}
            strokeLinecap="round"
          />
          {/* Its heads too, so the outline reads as the arrow it stands in for. */}
          {style.endHead && <path d={headPath(view(pts.to), view(pts.bend ?? pts.from), lineWidth)} fill={style.stroke} />}
          {style.startHead && <path d={headPath(view(pts.from), view(pts.bend ?? pts.to), lineWidth)} fill={style.stroke} />}
        </svg>
      )}
      {handle('from', pts.from, 'Drag to move this end')}
      {handle('to', pts.to, style.endHead ? 'Drag to point the arrow somewhere else' : 'Drag to move this end')}
      {handle('bend', middle, pts.bend ? 'Drag to bend it, or back onto the line to straighten it' : 'Drag to bend it into a curve')}
    </div>
  )
}

/** An arrowhead at `tip`, pointing away from `back`, sized to a line `width` wide, as an SVG path in view pixels. */
function headPath(tip: Point, back: Point, width: number): string {
  const d = Math.hypot(tip.x - back.x, tip.y - back.y) || 1
  const ux = (tip.x - back.x) / d
  const uy = (tip.y - back.y) / d
  const len = Math.max(10, width * 3)
  const half = len * 0.55
  const bx = tip.x - ux * len
  const by = tip.y - uy * len
  return `M${tip.x},${tip.y} L${bx - uy * half},${by + ux * half} L${bx + uy * half},${by - ux * half} Z`
}

/** How far a point is from the straight line through two others, in the same pixels. */
function distanceToLine(p: Point, a: Point, b: Point): number {
  const d = Math.hypot(b.x - a.x, b.y - a.y)
  if (d < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / d
}
