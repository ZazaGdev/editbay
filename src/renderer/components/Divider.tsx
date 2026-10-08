import { useEffect, useRef, useState, type JSX, type RefObject } from 'react'

/**
 * A strip between two parts of the window that drags the size of one of them.
 * `side` says which: the column on the left grows as the divider moves right,
 * the one on the right shrinks, and the part below grows as it moves up.
 */
export function Divider(props: {
  testid: string
  side: 'left' | 'right' | 'below'
  /** What it resizes, measured as drawn: a small window draws it smaller than it is set to. */
  column: RefObject<HTMLElement | null>
  size: number
  onSize: (size: number) => void
  /**
   * The size while the drag is under way, at most once a frame, drawn by the
   * caller straight onto the part it resizes. Given, `onSize` comes once, when
   * the drag lets go, so the window is not drawn again and nothing is stored
   * on every movement.
   */
  onLive?: (size: number) => void
  /** The drag begins, before the first movement: for measuring how far it may go. */
  onStart?: () => void
  /** A double click, where one puts the size back. */
  onReset?: () => void
}): JSX.Element {
  const [drag, setDrag] = useState<{ from: number; start: number } | null>(null)
  const across = props.side === 'below'
  /** The size the pointer last asked for, and the frame it will be drawn on. */
  const pending = useRef<{ size: number | null; frame: number | null }>({ size: null, frame: null })

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent): void => {
      const d = (across ? e.clientY : e.clientX) - drag.from
      const size = drag.start + (props.side === 'left' ? d : -d)
      const live = props.onLive
      if (!live) {
        props.onSize(size)
        return
      }
      pending.current.size = size
      pending.current.frame ??= requestAnimationFrame(() => {
        pending.current.frame = null
        if (pending.current.size !== null) live(pending.current.size)
      })
    }
    const up = (): void => {
      const { size, frame } = pending.current
      if (frame !== null) cancelAnimationFrame(frame)
      pending.current = { size: null, frame: null }
      if (props.onLive && size !== null) props.onSize(size)
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, props, across])

  return (
    <div
      data-testid={props.testid}
      role="separator"
      aria-orientation={across ? 'horizontal' : 'vertical'}
      title={props.onReset ? 'Drag to resize. Double click to put it back.' : 'Drag to resize'}
      className={`ui-divider${drag ? ' ui-divider--dragging' : ''}`}
      onPointerDown={(e) => {
        e.preventDefault()
        props.onStart?.()
        const box = props.column.current?.getBoundingClientRect()
        setDrag({ from: across ? e.clientY : e.clientX, start: (across ? box?.height : box?.width) ?? props.size })
      }}
      onDoubleClick={props.onReset}
      style={{
        cursor: across ? 'row-resize' : 'col-resize',
        touchAction: 'none',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 0
      }}
    >
      <div className="ui-divider__line" style={across ? { width: '100%', height: 2 } : undefined} />
    </div>
  )
}
