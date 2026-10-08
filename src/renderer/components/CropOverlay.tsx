import { useEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import type { Rect } from '../../shared/project'
import { fitInBox, sourceToDisplay, moveCrop, resizeCrop, snapBox, stretchCrop, type Fit, type Handle, type Side } from '../../shared/crop-geometry'
import { cropSnapLines } from '../../shared/layout'
import { surface, accent, ink, radius, type } from '../theme'

/** A name tab sitting on top of a box's top left corner. */
const tabStyle: React.CSSProperties = {
  position: 'absolute',
  left: -1,
  top: -18,
  padding: '0 5px',
  font: type.meta,
  fontWeight: 600,
  lineHeight: '16px',
  borderRadius: radius.handle,
  whiteSpace: 'nowrap',
  pointerEvents: 'none'
}

/** How much room a tab needs above its box; with less, it sits inside the box's bottom, clear of the view's hint along the top. */
const TAB_ROOM = 18
const inside: React.CSSProperties = { top: 'auto', bottom: 1, left: 1 }

/** How near, in screen pixels, a moved box must come to a line to snap to it. */
const SNAP_PX = 8

const HANDLE_SIZE = 12
const HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se']
const SIDES: Side[] = ['n', 'e', 's', 'w']

type DragState =
  | { kind: 'move'; fromX: number; fromY: number; start: Rect }
  | { kind: 'resize'; handle: Handle; fromX: number; fromY: number; start: Rect }
  | { kind: 'side'; side: Side; fromX: number; fromY: number; start: Rect }

/**
 * The crop rectangle drawn over the source view, for the selected picture,
 * with every other picture's crop as a faint outline so both views of a wide
 * recording can be seen at once.
 *
 * All it does is turn pointer movement into calls on the pure geometry in
 * shared/crop-geometry. It works out nothing itself.
 */
export function CropOverlay(props: {
  crop: Rect
  /** The crops of the clip's other pictures, drawn but not editable. */
  others?: Rect[]
  sourceWidth: number
  sourceHeight: number
  boxWidth: number
  boxHeight: number
  /** Where the recording is in the box when the Source view is zoomed; fitted into it otherwise. */
  fit?: Fit
  aspect: number | null
  /** What the box is, named on a tab above it: a Simple zoom's Start or End. */
  label?: string
  /** Which picture it crops, on a clip with more than one: named on the tab, and its colour for the box. */
  picture?: { name: string; colour: string } | undefined
  /**
   * A Simple zoom's other picture, drawn dashed with its name, and an arrow
   * from Start to End. `isStart` says which way the arrow points.
   */
  partner?: { crop: Rect; label: string; isStart: boolean }
  /** `continuing` is true for every movement of a drag after the first. */
  onChange: (rect: Rect, continuing: boolean) => void
}): JSX.Element | null {
  const [drag, setDrag] = useState<DragState | null>(null)
  const moved = useRef(false)
  const fit = props.fit ?? fitInBox(props.sourceWidth, props.sourceHeight, props.boxWidth, props.boxHeight)
  const colour = props.picture?.colour ?? accent.base
  const tab = props.picture ? (props.label ? `${props.picture.name}, ${props.label}` : props.picture.name) : props.label

  useEffect(() => {
    if (!drag || !(fit.scale > 0)) return
    const bounds = { w: props.sourceWidth, h: props.sourceHeight }

    const move = (e: globalThis.PointerEvent): void => {
      // Pointer movement is in screen pixels; the crop lives in source pixels.
      const dx = (e.clientX - drag.fromX) / fit.scale
      const dy = (e.clientY - drag.fromY) / fit.scale
      let next: Rect
      if (drag.kind === 'move') {
        next = moveCrop(drag.start, dx, dy, bounds)
        // To the centre and edges of the view it is in: each half of a side by
        // side recording, or the whole frame. Alt lets it go anywhere.
        if (!e.altKey) next = moveCrop(snapBox(next, cropSnapLines(bounds.w, bounds.h), SNAP_PX / fit.scale), 0, 0, bounds)
      } else if (drag.kind === 'side') {
        next = stretchCrop(drag.start, drag.side, drag.side === 'e' || drag.side === 'w' ? dx : dy, bounds)
      } else {
        next = resizeCrop(drag.start, drag.handle, dx, dy, props.aspect, bounds)
      }
      props.onChange(next, moved.current)
      moved.current = true
    }
    const up = (): void => setDrag(null)

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, fit.scale, props])

  if (!(fit.scale > 0)) return null
  const box = sourceToDisplay(props.crop, fit)

  const startMove = (e: PointerEvent): void => {
    e.preventDefault()
    moved.current = false
    setDrag({ kind: 'move', fromX: e.clientX, fromY: e.clientY, start: props.crop })
    // Listened for now, not once the drag's effect has run: a press let go
    // before then would leave the box following a pointer with no button held.
    window.addEventListener('pointerup', () => setDrag(null), { once: true })
  }

  const startResize = (handle: Handle) => (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    moved.current = false
    setDrag({ kind: 'resize', handle, fromX: e.clientX, fromY: e.clientY, start: props.crop })
    window.addEventListener('pointerup', () => setDrag(null), { once: true })
  }

  const startSide = (side: Side) => (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    moved.current = false
    setDrag({ kind: 'side', side, fromX: e.clientX, fromY: e.clientY, start: props.crop })
    window.addEventListener('pointerup', () => setDrag(null), { once: true })
  }

  /** A bar at the middle of a side, as the place box has: long along it, thin across it. */
  const sideStyle = (side: Side): React.CSSProperties => ({
    position: 'absolute',
    background: colour,
    borderRadius: radius.handle,
    width: side === 'n' || side === 's' ? HANDLE_SIZE * 2 : HANDLE_SIZE / 2,
    height: side === 'e' || side === 'w' ? HANDLE_SIZE * 2 : HANDLE_SIZE / 2,
    cursor: side === 'n' || side === 's' ? 'ns-resize' : 'ew-resize',
    left: side === 'w' ? -HANDLE_SIZE / 4 : side === 'e' ? undefined : `calc(50% - ${HANDLE_SIZE}px)`,
    right: side === 'e' ? -HANDLE_SIZE / 4 : undefined,
    top: side === 'n' ? -HANDLE_SIZE / 4 : side === 's' ? undefined : `calc(50% - ${HANDLE_SIZE}px)`,
    bottom: side === 's' ? -HANDLE_SIZE / 4 : undefined
  })

  const cornerStyle = (handle: Handle): React.CSSProperties => ({
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    background: colour,
    borderRadius: radius.handle,
    cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize',
    left: handle === 'nw' || handle === 'sw' ? -HANDLE_SIZE / 2 : undefined,
    right: handle === 'ne' || handle === 'se' ? -HANDLE_SIZE / 2 : undefined,
    top: handle === 'nw' || handle === 'ne' ? -HANDLE_SIZE / 2 : undefined,
    bottom: handle === 'sw' || handle === 'se' ? -HANDLE_SIZE / 2 : undefined
  })

  return (
    <>
      {/* Everything outside the crop, dimmed: a dark layer over the whole view with the crop cut out of it. */}
      <div
        data-testid="crop-shade"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          pointerEvents: 'none',
          background: surface.overlay,
          // The view's outline, then the crop's, filled even-odd: the crop is a hole.
          clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${box.x}px ${box.y}px, ${box.x}px ${box.y + box.h}px, ${
            box.x + box.w
          }px ${box.y + box.h}px, ${box.x + box.w}px ${box.y}px, ${box.x}px ${box.y}px)`
        }}
      />

      {(props.others ?? []).map((other, i) => {
        const o = sourceToDisplay(other, fit)
        return (
          <div
            key={i}
            data-testid="crop-other"
            style={{
              position: 'absolute',
              zIndex: 2,
              left: o.x,
              top: o.y,
              width: o.w,
              height: o.h,
              border: `1px dashed ${surface.overlayLineStrong}`,
              boxSizing: 'border-box',
              pointerEvents: 'none'
            }}
          />
        )
      })}

      {props.partner &&
        (() => {
          const o = sourceToDisplay(props.partner.crop, fit)
          const from = props.partner.isStart ? o : box
          const to = props.partner.isStart ? box : o
          return (
            <>
              <div
                data-testid="crop-partner"
                data-label={props.partner.label}
                style={{
                  position: 'absolute',
                  zIndex: 2,
                  left: o.x,
                  top: o.y,
                  width: o.w,
                  height: o.h,
                  border: `1px dashed ${surface.overlayLineStrong}`,
                  boxSizing: 'border-box',
                  pointerEvents: 'none'
                }}
              >
                <span style={{ ...tabStyle, ...(o.y < TAB_ROOM ? inside : {}), background: surface.overlay, color: ink.secondary, border: `1px solid ${surface.overlayLine}` }}>
                  {props.partner.label}
                </span>
              </div>
              <svg aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 2, pointerEvents: 'none', overflow: 'visible' }}>
                <defs>
                  <marker id="crop-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill={surface.overlayLineStrong} />
                  </marker>
                </defs>
                <line
                  x1={from.x + from.w / 2}
                  y1={from.y + from.h / 2}
                  x2={to.x + to.w / 2}
                  y2={to.y + to.h / 2}
                  stroke={surface.overlayLineStrong}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  markerEnd="url(#crop-arrow)"
                />
              </svg>
            </>
          )
        })()}

      <div
        data-testid="crop-rect"
        data-crop={`${props.crop.x},${props.crop.y},${props.crop.w},${props.crop.h}`}
        data-locked={props.aspect ? 'yes' : 'no'}
        // Locked, it has no sides to drag, and says why rather than leave the
        // corners looking like the only way to change it.
        title={
          props.aspect
            ? "Drag a corner to size it. Lock to shape is on, so it keeps its place's shape: turn that off in the Inspector to change its width or height alone"
            : 'Drag a corner to size it, or a side to change its width or height alone'
        }
        onPointerDown={startMove}
        style={{
          position: 'absolute',
          zIndex: 2,
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          border: `1px solid ${colour}`,
          boxSizing: 'border-box',
          cursor: 'move',
          touchAction: 'none'
        }}
      >
        {tab && (
          <span data-testid="crop-label" style={{ ...tabStyle, ...(box.y < TAB_ROOM ? inside : {}), background: colour, color: ink.onAccent }}>
            {tab}
          </span>
        )}
        {HANDLES.map((handle) => (
          <div
            key={handle}
            data-testid={`crop-${handle}`}
            onPointerDown={startResize(handle)}
            style={cornerStyle(handle)}
          />
        ))}
        {!props.aspect &&
          SIDES.map((side) => (
            <div key={side} data-testid={`crop-${side}`} onPointerDown={startSide(side)} style={sideStyle(side)} />
          ))}
      </div>
    </>
  )
}
