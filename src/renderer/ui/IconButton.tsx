import type { CSSProperties, JSX, MouseEvent } from 'react'
import { Icon, type IconName } from './Icon'
import { WhyOff, styleInside } from './off'
import type { ButtonSize, ButtonVariant } from './Button'

const height: Record<ButtonSize, number> = { small: 24, normal: 28, large: 32 }

/**
 * A square button holding one icon. `label` is not optional: it becomes both
 * the accessible name and the tooltip, since there are no words to read.
 */
export function IconButton(props: {
  icon: IconName
  label: string
  variant?: ButtonVariant | undefined
  size?: ButtonSize | undefined
  disabled?: boolean | undefined
  whyDisabled?: string | undefined
  pressed?: boolean | undefined
  /** One of a pair that reads as one control: which end this is. */
  joined?: 'start' | 'end' | undefined
  testid?: string | undefined
  /** Extra data attributes, so a test or a handler can tell one of a row apart. */
  data?: Record<string, string> | undefined
  onClick?: ((e: MouseEvent<HTMLButtonElement>) => void) | undefined
  style?: CSSProperties | undefined
}): JSX.Element {
  const size = props.size ?? 'normal'
  const off = props.disabled === true
  const why = off ? (props.whyDisabled ?? props.label) : undefined

  const button = (
    <button
      type="button"
      data-testid={props.testid}
      {...props.data}
      className={`ui-btn ui-btn--icon${props.variant && props.variant !== 'normal' ? ` ui-btn--${props.variant}` : ''}${props.joined ? ` ui-btn--joined-${props.joined}` : ''}`}
      disabled={off}
      aria-pressed={props.pressed}
      aria-label={props.label}
      title={why ?? props.label}
      onClick={props.onClick}
      style={{
        height: height[size],
        width: height[size],
        ...(why === undefined ? props.style : styleInside(props.style))
      }}
    >
      <Icon name={props.icon} size={size === 'small' ? 13 : 15} />
    </button>
  )

  return why === undefined ? (
    button
  ) : (
    <WhyOff why={why} style={props.style}>
      {button}
    </WhyOff>
  )
}
