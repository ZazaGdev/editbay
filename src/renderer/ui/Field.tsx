import { useEffect, useId, useRef, type CSSProperties, type JSX, type KeyboardEvent } from 'react'

/**
 * A label and a box you type in. A number field is tabular and right aligned,
 * so a column of them lines up and the digits stop moving as they change.
 *
 * The label is always there for a screen reader. `hideLabel` only stops it
 * being drawn, for a row that is already named by the words beside it.
 */
export function Field(props: {
  label: string
  value: string
  /** `stepped` when an arrow key or the wheel moved the number, rather than typing. */
  onChange: (value: string, stepped?: boolean) => void
  /**
   * What was typed is meant: Enter, or leaving the box. Given one, the box also
   * hands focus back on Enter, so the editor's keys work again without a click.
   */
  onCommit?: ((value: string) => void) | undefined
  /** The box is entered. */
  onFocus?: (() => void) | undefined
  /** Escape in the box: what it had is put back by the owner, and the box handed back. */
  onEscape?: (() => void) | undefined
  /** The mouse wheel over the box, while it is being typed in, steps the number as the arrow keys do. */
  wheel?: boolean | undefined
  /** Numbers are tabular, right aligned, and nudged by the arrow keys. */
  kind?: 'text' | 'number' | undefined
  /** Shown inside the box at its right end: dB, s, px, %. */
  unit?: string | undefined
  placeholder?: string | undefined
  hideLabel?: boolean | undefined
  /** The value cannot be used, which reddens the border. */
  invalid?: boolean | undefined
  /** How much an arrow key moves a number, and ten times that with Shift. */
  step?: number | undefined
  testid?: string | undefined
  /** Layout only: the width it takes. */
  style?: CSSProperties | undefined
  height?: number | undefined
}): JSX.Element {
  const id = useId()
  const number = props.kind === 'number'
  const step = props.step ?? 1

  /** The number moved by `steps` steps, kept to the step's decimals so 0.1 steps do not drift into 0.30000000000000004. */
  const stepBy = (steps: number): void => {
    const from = Number.parseFloat(props.value)
    if (!Number.isFinite(from)) return
    const places = (String(step).split('.')[1] ?? '').length
    props.onChange((from + steps * step).toFixed(places), true)
  }

  const nudge = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (props.onEscape && e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      props.onEscape()
      e.currentTarget.blur()
      return
    }
    if (props.onCommit && e.key === 'Enter') {
      e.preventDefault()
      props.onCommit(e.currentTarget.value)
      e.currentTarget.blur()
      return
    }
    if (!number || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    if (!Number.isFinite(Number.parseFloat(props.value))) return
    e.preventDefault()
    // Shift moves ten at a time, as it does for the crop box and the playhead.
    stepBy((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1))
  }

  // Only while it is being typed in, so the wheel over the Inspector still
  // scrolls it; and not a passive listener, so stepping does not scroll it too.
  const input = useRef<HTMLInputElement>(null)
  const latestStep = useRef(stepBy)
  latestStep.current = stepBy
  const wheels = number && props.wheel === true
  useEffect(() => {
    const el = input.current
    if (!el || !wheels) return
    const on = (e: globalThis.WheelEvent): void => {
      if (document.activeElement !== el || e.deltaY === 0) return
      e.preventDefault()
      latestStep.current((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1))
    }
    el.addEventListener('wheel', on, { passive: false })
    return () => el.removeEventListener('wheel', on)
  }, [wheels])

  return (
    <div
      className={`ui-field${number ? ' ui-field--number' : ''}${props.invalid === true ? ' ui-field--invalid' : ''}`}
      style={props.style}
    >
      <label htmlFor={id} className={props.hideLabel === true ? 'ui-hidden' : 'ui-field__label'}>
        {props.label}
      </label>
      <div className="ui-field__box" style={{ height: props.height ?? 28 }}>
        <input
          ref={input}
          id={id}
          data-testid={props.testid}
          className="ui-field__input"
          type="text"
          inputMode={number ? 'decimal' : undefined}
          value={props.value}
          placeholder={props.placeholder}
          aria-invalid={props.invalid === true ? true : undefined}
          onChange={(e) => props.onChange(e.target.value)}
          onFocus={props.onFocus}
          onBlur={(e) => props.onCommit?.(e.target.value)}
          onKeyDown={nudge}
        />
        {props.unit !== undefined && <span className="ui-field__unit">{props.unit}</span>}
      </div>
    </div>
  )
}
