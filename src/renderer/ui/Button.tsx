import type { CSSProperties, JSX, MouseEvent, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { WhyOff, styleInside } from './off'

export type ButtonVariant = 'normal' | 'primary' | 'ghost' | 'danger'
export type ButtonSize = 'small' | 'normal' | 'large'

const height: Record<ButtonSize, number> = { small: 24, normal: 28, large: 32 }
const pad: Record<ButtonSize, string> = { small: '0 9px', normal: '0 10px', large: '0 14px' }

export interface ButtonProps {
  children?: ReactNode | undefined
  /** An icon before the words. */
  icon?: IconName | undefined
  variant?: ButtonVariant | undefined
  size?: ButtonSize | undefined
  disabled?: boolean | undefined
  /**
   * Why it is off, shown on hover. A button that is off and silent is the one
   * thing this component set exists to stop, so pass it whenever `disabled`
   * is true for a reason the person could do something about.
   */
  whyDisabled?: string | undefined
  /** On when it is a toggle, which draws it in the accent wash. */
  pressed?: boolean | undefined
  /** One of a pair that reads as one control: which end this is. */
  joined?: 'start' | 'end' | undefined
  title?: string | undefined
  testid?: string | undefined
  /** Extra data attributes, so a test or a handler can tell one of a row apart. */
  data?: Record<string, string> | undefined
  onClick?: ((e: MouseEvent<HTMLButtonElement>) => void) | undefined
  /** Layout only: where it sits and how wide. Never colour, font or radius. */
  style?: CSSProperties | undefined
}

/**
 * The window's button. Its look, its hover, its press and its focus ring live
 * in `ui.css`; only its size and its place are set here.
 *
 * A disabled button takes no pointer events, so Chromium never shows its
 * tooltip. When it is off with a reason, it is wrapped in a span carrying the
 * same title, which does show, and the title stays on the button too so a test
 * can read it from either.
 */
export function Button(props: ButtonProps): JSX.Element {
  const size = props.size ?? 'normal'
  const variant = props.variant ?? 'normal'
  const off = props.disabled === true
  const why = off ? (props.whyDisabled ?? props.title) : undefined
  const title = why ?? props.title

  const button = (
    <button
      type="button"
      data-testid={props.testid}
      {...props.data}
      className={`ui-btn${variant === 'normal' ? '' : ` ui-btn--${variant}`}${props.joined ? ` ui-btn--joined-${props.joined}` : ''}`}
      disabled={off}
      aria-pressed={props.pressed}
      title={title}
      onClick={props.onClick}
      style={{
        height: height[size],
        padding: variant === 'primary' && size === 'normal' ? '0 14px' : pad[size],
        ...(why === undefined ? props.style : styleInside(props.style))
      }}
    >
      {props.icon && <Icon name={props.icon} size={size === 'small' ? 13 : 14} />}
      {props.children}
    </button>
  )

  // Wrapped only when it is off with something to say: an extra element in the
  // tree everywhere would get in the way of the layouts that place buttons.
  return why === undefined ? (
    button
  ) : (
    <WhyOff why={why} style={props.style}>
      {button}
    </WhyOff>
  )
}
