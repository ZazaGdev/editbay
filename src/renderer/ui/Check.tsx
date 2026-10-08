import type { CSSProperties, JSX, ReactNode } from 'react'

/**
 * A tick and its words, which are one target: the whole thing is the label, so
 * the words can be clicked as well as the box.
 *
 * `radio` makes it one of a set, where exactly one is chosen. It is the same
 * control otherwise, so a row of radios and a row of ticks line up.
 */
export function Check(props: {
  children: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  /** One of a set, where exactly one is chosen. `name` groups them. */
  radio?: boolean | undefined
  name?: string | undefined
  disabled?: boolean | undefined
  /** Why it cannot be changed just now, shown on hover. */
  whyDisabled?: string | undefined
  testid?: string | undefined
  /** Extra data attributes for the box itself, so a test can tell one row from another. */
  data?: Record<string, string> | undefined
  style?: CSSProperties | undefined
}): JSX.Element {
  const off = props.disabled === true
  return (
    <label
      className={`ui-check${off ? ' ui-check--off' : ''}`}
      title={off ? props.whyDisabled : undefined}
      style={props.style}
    >
      <input
        type={props.radio === true ? 'radio' : 'checkbox'}
        name={props.name}
        data-testid={props.testid}
        {...props.data}
        className="ui-check__box"
        checked={props.checked}
        disabled={off}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.children}
    </label>
  )
}
