import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { surface, ink, space, type } from '../theme'
import { IconButton } from '../ui/IconButton'

/** What Tab can land on inside the box. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The box's focusable parts in Tab order, leaving out any that are not drawn. */
/** The boxes open now, the last on top. */
const stack: object[] = []

function focusables(box: HTMLElement): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
}

/**
 * A box over the window, with the rest dimmed behind it. Escape and a click
 * on the dimmed part close it, unless `sticky` says it is asking something
 * that must be answered first.
 *
 * `sticky` refuses every way out, the close control included, because the
 * question has to be answered. `keepOpen` refuses only the two that happen by
 * accident, Escape and a stray click outside, and leaves the close control
 * working: a window that is meant to be read rather than answered, and shows
 * you an X, has to close when you press it. They are two different things and
 * one prop for both is how a window ends up with no way out.
 *
 * `bare` leaves off the title bar and the close control, for the search
 * palette, which is a box you type in rather than a form you fill and leave.
 * Escape still closes it, and its accessible name is still the title.
 *
 * `flush` takes away the padding too, for a window that draws its own edges,
 * as Settings does with its sidebar running to the border.
 *
 * Focus goes into the box when it opens, stays in it while Tab and Shift+Tab
 * go round, and goes back to whatever had it when the box closes. Without
 * that, Tab walked on through the dimmed editor behind, and a keyboard user
 * was left at the top of the page once it closed.
 */
export function Modal(props: {
  title: string
  testid: string
  onClose: () => void
  width?: number
  sticky?: boolean
  keepOpen?: boolean
  bare?: boolean
  flush?: boolean
  children: ReactNode
}): JSX.Element {
  const { onClose, sticky } = props
  /** Nothing that happens by accident closes it. */
  const held = sticky === true || props.keepOpen === true
  const box = useRef<HTMLElement>(null)
  // What had focus before the box opened, read while it first draws: a
  // dialog that focuses a part of itself does so before this box's own
  // effects run, and by then what had it before is gone.
  const [opener] = useState(() => document.activeElement)

  useEffect(() => {
    const el = box.current
    if (!el) return
    // A dialog that put focus somewhere of its own, as Settings does in its
    // search box, is left where it chose. Otherwise its first control, past
    // the close control where there is anything else, or the box itself.
    if (!el.contains(document.activeElement)) {
      const parts = focusables(el)
      const close = el.querySelector(`[data-testid="${props.testid}-close"]`)
      ;(parts.find((p) => p !== close) ?? parts[0] ?? el).focus()
    }
    return () => {
      // Back to what had it, unless something else has taken focus since, as
      // a dialog that opens another on its way out would have.
      const now = document.activeElement
      const lost = now === null || now === document.body || el.contains(now)
      if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
    // Once, when it opens: its title or test id changing is not a new box.
  }, [])

  /** Tab from the last part goes round to the first, and Shift+Tab from the first to the last. */
  const keepFocus = (e: ReactKeyboardEvent<HTMLElement>): void => {
    // A box inside this one has kept it already.
    if (e.key !== 'Tab' || e.defaultPrevented) return
    const el = box.current
    if (!el) return
    const parts = focusables(el)
    const first = parts[0]
    const last = parts[parts.length - 1]
    const at = document.activeElement
    if (!first || !last) {
      e.preventDefault()
      el.focus()
    } else if (e.shiftKey && (at === first || at === el || !el.contains(at))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (at === last || !el.contains(at))) {
      e.preventDefault()
      first.focus()
    }
  }

  // The box on top is the one Escape closes: two open, one over the other,
  // both closed on a single press (audit 2026-10-01).
  const token = useRef<object>({})
  useEffect(() => {
    const mine = token.current
    stack.push(mine)
    return () => {
      const i = stack.lastIndexOf(mine)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [])

  useEffect(() => {
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== token.current) return
      e.preventDefault()
      e.stopPropagation()
      if (!held) onClose()
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [onClose, held])

  return (
    <div
      className="ui-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !held) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: surface.scrim,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <section
        ref={box}
        data-testid={props.testid}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className="ui-dialog"
        tabIndex={-1}
        onKeyDown={keepFocus}
        style={{
          outline: 'none',
          width: props.width ?? 480,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          padding: props.flush === true ? 0 : props.bare === true ? space.md : 18,
          boxSizing: 'border-box'
        }}
      >
        {props.bare !== true && (
          <header style={{ display: 'flex', alignItems: 'center', gap: space.md, marginBottom: space.md }}>
            <h2 style={{ font: type.title, color: ink.primary, margin: 0, flex: 1 }}>{props.title}</h2>
            <IconButton
              icon="close"
              label="Close"
              size="small"
              variant="ghost"
              testid={`${props.testid}-close`}
              disabled={sticky === true}
              {...(sticky === true ? { whyDisabled: 'Answer this first' } : {})}
              onClick={onClose}
            />
          </header>
        )}
        {props.children}
      </section>
    </div>
  )
}

/** The row a dialog's own buttons sit in, at its foot, the primary one last. */
export function ModalActions(props: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: space.sm,
        marginTop: space.lg,
        paddingTop: space.md,
        borderTop: `1px solid ${surface.line}`
      }}
    >
      {props.children}
    </div>
  )
}
