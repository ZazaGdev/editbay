import type { CSSProperties, JSX, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { IconButton } from './IconButton'
import { SectionLabel } from './SectionLabel'

/**
 * A column of the window: a header naming it, a body that scrolls, and a
 * control that folds it away to a rail.
 *
 * Folding is the panel's own affair, so the window only has to say whether it
 * is folded and what to do when the control is pressed.
 */
export function Panel(props: {
  name: string
  /** Which edge the panel sits on, which is the way the fold arrow points. */
  side: 'left' | 'right'
  /** Drawn on the rail when it is folded, so it can be told apart at a glance. */
  icon?: IconName | undefined
  folded: boolean
  onFold: (folded: boolean) => void
  /** Beside the name, such as a count or an Add button. */
  header?: ReactNode | undefined
  children: ReactNode
  testid?: string | undefined
  style?: CSSProperties | undefined
}): JSX.Element {
  const foldIcon = props.side === 'left' ? 'left' : 'right'
  const openIcon = props.side === 'left' ? 'right' : 'left'

  if (props.folded) {
    return (
      <aside
        data-testid={props.testid}
        data-folded="yes"
        className="ui-panel"
        style={{ width: 44, flexShrink: 0, alignItems: 'center', gap: 8, padding: '8px 0', ...props.style }}
      >
        <IconButton
          icon={openIcon}
          label={`Open ${props.name}`}
          testid={props.testid ? `${props.testid}-open` : undefined}
          onClick={() => props.onFold(false)}
        />
        {props.icon && (
          <span style={{ color: 'var(--ink-muted)', display: 'flex' }}>
            <Icon name={props.icon} size={16} />
          </span>
        )}
        <span style={{ flexGrow: 1 }} />
        <span
          className="ui-label"
          style={{ writingMode: 'vertical-rl', transform: props.side === 'left' ? 'rotate(180deg)' : undefined }}
        >
          {props.name}
        </span>
      </aside>
    )
  }

  return (
    <aside data-testid={props.testid} data-folded="no" className="ui-panel" style={props.style}>
      <div className="ui-panel__header">
        {props.side === 'left' && (
          <IconButton
            icon={foldIcon}
            label={`Fold ${props.name} away`}
            size="small"
            variant="ghost"
            testid={props.testid ? `${props.testid}-fold` : undefined}
            onClick={() => props.onFold(true)}
          />
        )}
        <SectionLabel>{props.name}</SectionLabel>
        {props.header}
        {props.side === 'right' && (
          <>
            <span style={{ flexGrow: 1 }} />
            <IconButton
              icon={foldIcon}
              label={`Fold ${props.name} away`}
              size="small"
              variant="ghost"
              testid={props.testid ? `${props.testid}-fold` : undefined}
              onClick={() => props.onFold(true)}
            />
          </>
        )}
      </div>
      <div className="ui-panel__body">{props.children}</div>
    </aside>
  )
}
