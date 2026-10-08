import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { surface, space } from '../theme'
import { SectionLabel } from '../ui/SectionLabel'

/** Where a right-click menu opens: at the pointer, in window pixels. */
export interface MenuAt {
  x: number
  y: number
}

/**
 * A menu at the pointer, for a right-click. It closes on a click anywhere
 * else, on Escape, or when the window loses focus, and moves back inside the
 * window when it would open off its edge.
 *
 * `ignore` is the control the menu was opened from, when it was opened from
 * one rather than by a right-click. A press on it does not count as a press
 * outside: without that, pressing the button a second time closes the menu and
 * the click that follows opens it straight back up, so the button that opens
 * the menu is the one thing that cannot close it.
 */
export function ContextMenu(props: {
  at: MenuAt
  onClose: () => void
  testid: string
  ignore?: HTMLElement | null | undefined
  children: ReactNode
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState({ x: 0, y: 0 })
  const { onClose } = props
  // Read inside the handler rather than depended on, so the listeners are not
  // torn down and rebuilt every time the anchor is handed over again.
  const ignore = useRef<HTMLElement | null>(null)
  ignore.current = props.ignore ?? null

  // One item takes focus so the keyboard can work it straight away: the one
  // that is set now where the menu has one, and otherwise the first. Opening on
  // the first while a different line is ticked shows the choice in two places
  // and disagrees with itself.
  useEffect(() => {
    const menu = box.current
    const set = menu?.querySelector<HTMLButtonElement>('button[data-current="yes"]:not(:disabled)')
    ;(set ?? menu?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus()
  }, [])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setShift({
      x: Math.min(0, window.innerWidth - 8 - (props.at.x + r.width)),
      y: Math.min(0, window.innerHeight - 8 - (props.at.y + r.height))
    })
  }, [props.at])

  useEffect(() => {
    const outside = (e: PointerEvent): void => {
      const target = e.target as Node
      if (ignore.current?.contains(target)) return
      if (box.current && !box.current.contains(target)) {
        // A figure typed into a box in the menu is kept, as leaving a box
        // keeps it anywhere else: left now, while the menu is still there.
        const active = document.activeElement
        if (box.current.contains(active) && active instanceof HTMLElement) active.blur()
        onClose()
      }
    }
    // Keys that work the menu stay with it: Tab, the arrows between its items,
    // and Enter or Space on one. Any other key closes it and goes on to do what
    // it does: Ctrl+Z undoes, Ctrl+E exports. Escape stops here, so it does not
    // clear the selection too.
    const escape = (e: KeyboardEvent): void => {
      const menu = box.current
      const inside = !!menu && menu.contains(document.activeElement)
      if (['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
      if (inside && (e.key === 'Enter' || e.key === ' ')) return
      // Left and right open and leave a submenu, which the submenu itself hears.
      if (inside && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
      // A box or slider in the menu, as its volume, keeps the menu open while
      // it is worked. Escape still closes it.
      if (inside && document.activeElement instanceof HTMLInputElement && e.key !== 'Escape') return
      if (inside && menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        e.stopPropagation()
        const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const at = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'ArrowDown' ? at + 1 : at - 1
        items[(next + items.length) % items.length]?.focus()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
      }
      onClose()
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={box}
      data-testid={props.testid}
      onContextMenu={(e) => e.preventDefault()}
      className="ui-menu"
      style={{
        position: 'fixed',
        left: props.at.x + shift.x,
        top: props.at.y + shift.y,
        zIndex: 80,
        minWidth: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: 2
      }}
    >
      {props.children}
    </div>
  )
}

/** A thin line between groups of a menu's items. */
export function MenuSeparator(): JSX.Element {
  return <div role="separator" style={{ height: 1, background: surface.line, margin: '4px 2px' }} />
}

/** A small heading inside a menu. */
export function MenuHeading(props: { children: ReactNode }): JSX.Element {
  return <SectionLabel style={{ display: 'block', padding: `${space.xs}px ${space.sm}px 2px` }}>{props.children}</SectionLabel>
}

/**
 * Bugs and notes 2, note 21: an item that opens a menu of its own beside it,
 * so a menu can keep its rarer actions one step away. It opens on hover, on a
 * click, and on the right arrow, which also puts the keys on its first item;
 * the left arrow comes back. It opens to the left when there is no room on the
 * right. What is in it counts as inside the menu, so a click there does not
 * close the menu before the item runs.
 */
export function SubMenu(props: {
  label: ReactNode
  testid: string
  title?: string
  /** What is set now is one of its items: ticked, and the item the menu opens on. */
  current?: boolean
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [left, setLeft] = useState(false)
  const item = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const leave = useRef<number | null>(null)
  const stay = (): void => {
    if (leave.current !== null) window.clearTimeout(leave.current)
    leave.current = null
  }
  // A moment's grace, so a pointer crossing a corner to reach the panel does not close it.
  const goAway = (): void => {
    stay()
    leave.current = window.setTimeout(() => setOpen(false), 250)
  }
  useEffect(() => stay, [])
  useLayoutEffect(() => {
    if (!open || !item.current || !panel.current) return
    const r = item.current.getBoundingClientRect()
    setLeft(r.right + panel.current.offsetWidth + 8 > window.innerWidth)
  }, [open])

  return (
    <div
      style={{ position: 'relative' }}
      onPointerEnter={() => {
        stay()
        setOpen(true)
      }}
      onPointerLeave={goAway}
    >
      <button
        ref={item}
        type="button"
        data-testid={props.testid}
        aria-haspopup="menu"
        aria-expanded={open}
        data-current={props.current === undefined ? undefined : props.current ? 'yes' : 'no'}
        title={props.title}
        className="ui-menu__item"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight') return
          e.preventDefault()
          e.stopPropagation()
          setOpen(true)
          requestAnimationFrame(() => {
            const set = panel.current?.querySelector<HTMLButtonElement>('button[data-current="yes"]:not(:disabled)')
            ;(set ?? panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus()
          })
        }}
        style={{ justifyContent: 'space-between', width: '100%' }}
      >
        <span>{props.label}</span>
        <span aria-hidden="true">
          {props.current === true ? '✓ ' : ''}
          {'›'}
        </span>
      </button>
      {open && (
        <div
          ref={panel}
          role="menu"
          data-testid={`${props.testid}-items`}
          className="ui-menu"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft') return
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
            item.current?.focus()
          }}
          style={{
            position: 'absolute',
            top: -4,
            ...(left ? { right: '100%', marginRight: 2 } : { left: '100%', marginLeft: 2 }),
            zIndex: 81,
            minWidth: 200,
            // As wide as its longest item with its key, on one line each.
            width: 'max-content',
            whiteSpace: 'nowrap',
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}
        >
          {props.children}
        </div>
      )}
    </div>
  )
}
