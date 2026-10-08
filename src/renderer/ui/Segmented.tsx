import type { CSSProperties, JSX } from 'react'
import { Icon, type IconName } from './Icon'

export interface SegmentedChoice<Id extends string> {
  id: Id
  label: string
  icon?: IconName | undefined
  /** What it does, on hover. Names its key where it has one. */
  title?: string | undefined
  /** Why this one cannot be chosen just now, shown on hover. */
  whyDisabled?: string | undefined
}

/**
 * One of a short row, exactly one chosen: Source, Output and Both; Single,
 * Split and Picture in picture; Full frame and Corner.
 *
 * They are real buttons carrying `aria-pressed`, not radios, because they act
 * at once rather than being submitted, and because a radio group takes the
 * bare arrow keys, which this app spends on the timeline.
 */
export function Segmented<Id extends string>(props: {
  choices: ReadonlyArray<SegmentedChoice<Id>>
  chosen: Id
  onChoose: (id: Id) => void
  /** Small is 22 high, for a panel. Normal is 24, for a bar. */
  size?: 'small' | 'normal' | undefined
  /** The whole row stretches, each choice sharing the width. */
  stretch?: boolean | undefined
  label?: string | undefined
  testid?: string | undefined
  style?: CSSProperties | undefined
}): JSX.Element {
  const size = props.size === 'small' ? 22 : 24
  return (
    <div
      role="group"
      aria-label={props.label}
      data-testid={props.testid}
      className="ui-seg"
      style={{ display: props.stretch === true ? 'flex' : 'inline-flex', ...props.style }}
    >
      {props.choices.map((choice) => {
        const off = choice.whyDisabled !== undefined
        return (
          <button
            key={choice.id}
            type="button"
            data-testid={props.testid ? `${props.testid}-${choice.id}` : undefined}
            className="ui-seg__item"
            aria-pressed={choice.id === props.chosen}
            disabled={off}
            title={off ? choice.whyDisabled : choice.title}
            onClick={() => props.onChoose(choice.id)}
            style={{ height: size, padding: '0 11px', flexGrow: props.stretch === true ? 1 : undefined }}
          >
            {choice.icon && <Icon name={choice.icon} size={13} />}
            {choice.label}
          </button>
        )
      })}
    </div>
  )
}
