import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { Kbd } from '../ui/Kbd'

/**
 * A panel that drops down under the element it belongs to. It closes when you
 * click anywhere else or press Escape, and takes Escape for itself so the
 * editor does not also clear its selection.
 *
 * It opens upwards by itself where there is no room below it, which is every
 * menu on the bottom track of the timeline. `up` forces it either way for a
 * caller that knows better.
 */
export function DropMenu(props: {
  open: boolean
  onClose: () => void
  /** What it hangs from: usually the button that opens it. */
  anchor: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
  /** Open above the anchor rather than below. Worked out from the room there is when it is left off. */
  up?: boolean
  testid?: string
  style?: CSSProperties
}): JSX.Element {
  const box = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const { open, onClose } = props
  /** Flipped above the anchor because it would not fit below it. */
  const [flipped, setFlipped] = useState(false)
  const up = props.up ?? flipped

  // Measured once it is on screen, before it is painted: a menu that hangs off
  // the bottom of the window cannot be reached at all, and the track headers at
  // the foot of the timeline are the ones that put it there.
  useLayoutEffect(() => {
    if (!open) {
      setFlipped(false)
      return
    }
    const el = menu.current
    const anchor = box.current
    if (!el || !anchor || props.up !== undefined) return
    const height = el.getBoundingClientRect().height
    const at = anchor.getBoundingClientRect()
    const below = window.innerHeight - at.bottom - 8
    const above = at.top - 8
    setFlipped(height > below && above > below)
  }, [open, props.up])

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) onClose()
    }
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [open, onClose])

  return (
    <span ref={box} style={{ position: 'relative', display: 'inline-flex' }}>
      {props.anchor}
      {open && (
        <div
          ref={menu}
          data-testid={props.testid}
          data-up={up ? 'yes' : 'no'}
          className="ui-menu"
          style={{
            position: 'absolute',
            ...(up ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
            [props.align === 'right' ? 'right' : 'left']: 0,
            zIndex: 40,
            minWidth: 220,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            ...props.style
          }}
        >
          {props.children}
        </div>
      )}
    </span>
  )
}

/** One line of a drop-down menu. */
export function MenuItem(props: {
  label: ReactNode
  /** The key that does the same, shown on the right. */
  hint?: string
  onClick: () => void
  disabled?: boolean
  /** Takes something away: drawn in the destructive colour. */
  danger?: boolean
  /**
   * The one of its group that is set now: ticked, and the item the menu opens
   * on. A menu that ticks one line and then outlines another says two things
   * at once, and the eye believes the outline.
   */
  current?: boolean
  testid?: string
  title?: string
}): JSX.Element {
  const current = props.current === true
  return (
    <button
      type="button"
      data-testid={props.testid}
      data-current={props.current === undefined ? undefined : current ? 'yes' : 'no'}
      {...(props.current === undefined ? {} : { role: 'menuitemradio', 'aria-checked': current })}
      className={`ui-menu__item${props.danger === true ? ' ui-menu__item--danger' : ''}`}
      disabled={props.disabled}
      title={props.title}
      onClick={props.onClick}
      style={{ justifyContent: 'space-between' }}
    >
      <span>{props.label}</span>
      {props.hint && <Kbd>{props.hint}</Kbd>}
      {current && <span aria-hidden="true">✓</span>}
    </button>
  )
}
