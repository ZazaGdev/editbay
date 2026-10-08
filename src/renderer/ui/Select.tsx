import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export interface SelectChoice {
  value: string
  label: string
  disabled?: boolean | undefined
  /** A heading it is listed under, after the choices with none. Choices of one group go together. */
  group?: string | undefined
}

/**
 * A choice from a list too long for a segmented row: the output shape, a sort
 * order, a track to listen to.
 *
 * The box is a real `<select>`, so a screen reader, the arrow keys on it and
 * anything that sets its value all work as they always have. The list it
 * opens is the app's own, drawn inside the window: the list Windows draws for
 * a `<select>` is a window of its own, which a window capture in OBS leaves
 * out, so a recording of the app showed a click that opened nothing.
 */
function option(c: SelectChoice): JSX.Element {
  return (
    <option key={c.value} value={c.value} disabled={c.disabled}>
      {c.label}
    </option>
  )
}

/** The groups in the order the list shows them, those with none first, and every choice in that order. */
function inOrder(choices: ReadonlyArray<SelectChoice>): { groups: (string | undefined)[]; ordered: SelectChoice[] } {
  const groups = [undefined, ...new Set(choices.flatMap((c) => (c.group === undefined ? [] : [c.group])))]
  return { groups, ordered: groups.flatMap((g) => choices.filter((c) => c.group === g)) }
}

/** The gap between the box and its list, the tallest the list is, and how near the window's edge it may go. */
const GAP = 3
const MAX_HEIGHT = 320
const EDGE = 8

function List(props: {
  anchor: HTMLElement
  choices: ReadonlyArray<SelectChoice>
  value: string
  testid: string | undefined
  onChoose: (value: string) => void
  onClose: () => void
}): JSX.Element {
  const { groups, ordered } = inOrder(props.choices)
  const box = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(() => Math.max(0, ordered.findIndex((c) => c.value === props.value)))
  const [at, setAt] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)

  // Under the box, or above it where there is more room there, never past the window.
  useLayoutEffect(() => {
    const r = props.anchor.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - GAP - EDGE
    const above = r.top - GAP - EDGE
    const wanted = Math.min(MAX_HEIGHT, box.current?.scrollHeight ?? MAX_HEIGHT)
    const down = below >= wanted || below >= above
    const maxHeight = Math.max(80, Math.min(MAX_HEIGHT, down ? below : above))
    const height = Math.min(wanted, maxHeight)
    const width = Math.max(r.width, box.current?.scrollWidth ?? 0)
    const left = Math.min(Math.max(EDGE, r.left), Math.max(EDGE, window.innerWidth - EDGE - width))
    setAt({ left, top: down ? r.bottom + GAP : r.top - GAP - height, width: r.width, maxHeight })
  }, [props.anchor])

  // The chosen one in sight when it opens, and the one the keys are on as they move.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, at])

  const { onChoose, onClose, anchor } = props
  const activeNow = useRef(active)
  activeNow.current = active
  useEffect(() => {
    const move = (from: number, by: number): number => {
      for (let i = 1; i <= ordered.length; i++) {
        const next = (((from + by * i) % ordered.length) + ordered.length) % ordered.length
        if (!ordered[next]!.disabled) return next
      }
      return from
    }
    // The keys work the list while it is open and go no further, so Space
    // chooses rather than plays and Escape closes it without clearing anything.
    const keys = (e: KeyboardEvent): void => {
      if (e.key === 'Tab') {
        onClose()
        return
      }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowDown') setActive((a) => move(a, 1))
      else if (e.key === 'ArrowUp') setActive((a) => move(a, -1))
      else if (e.key === 'Home') setActive(move(-1, 1))
      else if (e.key === 'End') setActive(move(0, -1))
      else if (e.key === 'Enter' || e.key === ' ') {
        const c = ordered[activeNow.current]
        if (c && !c.disabled) onChoose(c.value)
      } else if (e.key.length === 1) {
        // A letter goes to the next choice starting with it.
        const letter = e.key.toLowerCase()
        setActive((a) => {
          for (let i = 1; i <= ordered.length; i++) {
            const next = (a + i) % ordered.length
            const c = ordered[next]!
            if (!c.disabled && c.label.toLowerCase().startsWith(letter)) return next
          }
          return a
        })
      }
    }
    const outside = (e: PointerEvent): void => {
      const target = e.target as Node
      if (box.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    // Scrolled or resized from under it, it would float away from its box.
    const scrolled = (e: Event): void => {
      if (box.current?.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('keydown', keys, true)
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('scroll', scrolled, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('keydown', keys, true)
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('scroll', scrolled, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [ordered, onChoose, onClose, anchor])

  return createPortal(
    <div
      ref={box}
      role="listbox"
      data-testid="select-list"
      data-for={props.testid}
      className="ui-menu ui-select-list"
      style={{
        position: 'fixed',
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        minWidth: at?.width ?? 0,
        maxHeight: at?.maxHeight ?? MAX_HEIGHT,
        visibility: at ? 'visible' : 'hidden'
      }}
      onContextMenu={(e) => e.preventDefault()}
      // A press inside keeps the focus on the box, so the keys go on working the list.
      onMouseDown={(e) => e.preventDefault()}
    >
      {groups.map((g) => (
        <div key={g ?? ''} role="group" aria-label={g}>
          {g !== undefined && <div className="ui-select-list__group">{g}</div>}
          {ordered.map((c, i) =>
            c.group !== g ? null : (
              <div
                key={c.value}
                role="option"
                aria-selected={c.value === props.value}
                aria-disabled={c.disabled === true}
                data-testid="select-option"
                data-value={c.value}
                data-index={i}
                data-active={i === active ? 'yes' : 'no'}
                className="ui-select-list__option"
                onPointerMove={() => !c.disabled && i !== active && setActive(i)}
                onClick={() => !c.disabled && onChoose(c.value)}
              >
                <span className="ui-select-list__tick" aria-hidden="true">
                  {c.value === props.value && <Icon name="check" size={12} />}
                </span>
                {c.label}
              </div>
            )
          )}
        </div>
      ))}
    </div>,
    document.body
  )
}

export function Select(props: {
  label: string
  value: string
  onChange: (value: string) => void
  choices: ReadonlyArray<SelectChoice>
  /** Drawn above the box. Left off, the label is still there for a screen reader. */
  showLabel?: boolean | undefined
  disabled?: boolean | undefined
  /** Why it cannot be changed just now, shown on hover. */
  whyDisabled?: string | undefined
  /**
   * Give focus back to the window once a choice is made, so Space plays rather
   * than opening the list again. For one in a bar, not one in a form.
   */
  blurOnChange?: boolean | undefined
  testid?: string | undefined
  height?: number | undefined
  /** Layout only: the width it takes. */
  style?: CSSProperties | undefined
}): JSX.Element {
  const id = useId()
  const off = props.disabled === true
  const select = useRef<HTMLSelectElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  // Closed if it is turned off while open.
  useEffect(() => {
    if (off) setOpen(false)
  }, [off])

  // The same two functions from one render to the next, so the list does not put its listeners up again on each.
  const close = useRef(() => setOpen(false)).current
  const latest = useRef(props)
  latest.current = props
  const onChoose = useRef((value: string): void => {
    const p = latest.current
    setOpen(false)
    if (value !== p.value) p.onChange(value)
    if (p.blurOnChange === true) select.current?.blur()
    else select.current?.focus()
  }).current

  return (
    <div className="ui-field" style={props.style} title={off ? props.whyDisabled : undefined}>
      <label htmlFor={id} className={props.showLabel === true ? 'ui-field__label' : 'ui-hidden'}>
        {props.label}
      </label>
      <div ref={frame} className={`ui-select${off ? ' ui-select--off' : ''}`} style={{ height: props.height ?? 28 }}>
        <select
          ref={select}
          id={id}
          data-testid={props.testid}
          data-open={open ? 'yes' : 'no'}
          aria-expanded={open}
          className="ui-select__input"
          value={props.value}
          disabled={off}
          // The system's list never opens: a press opens the app's instead.
          onMouseDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.currentTarget.focus()
            setOpen((o) => !o)
          }}
          onKeyDown={(e) => {
            const opens = e.key === ' ' || e.key === 'Enter' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))
            if (!opens) return
            e.preventDefault()
            e.stopPropagation()
            setOpen(true)
          }}
          onChange={(e) => {
            props.onChange(e.target.value)
            if (props.blurOnChange === true) e.target.blur()
          }}
        >
          {props.choices.filter((c) => c.group === undefined).map(option)}
          {[...new Set(props.choices.flatMap((c) => (c.group === undefined ? [] : [c.group])))].map((g) => (
            <optgroup key={g} label={g}>
              {props.choices.filter((c) => c.group === g).map(option)}
            </optgroup>
          ))}
        </select>
        <span className="ui-select__arrow" aria-hidden="true">
          <Icon name="down" size={13} />
        </span>
      </div>
      {open && frame.current && (
        <List anchor={frame.current} choices={props.choices} value={props.value} testid={props.testid} onChoose={onChoose} onClose={close} />
      )}
    </div>
  )
}
