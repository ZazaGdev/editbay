import type { JSX } from 'react'
import { CLIP_MARKS } from '../../shared/marks'
import { surface, ink, accent, space, radius, type } from '../theme'

/**
 * A row of colours inside a menu, and None beside them.
 *
 * A row rather than a submenu with five named rows: picking a colour is one
 * press, and five words down a menu would read as five commands when they are
 * one choice with five answers.
 */
export function MarkPicker(props: { value: string | undefined; onPick: (mark: string | null) => void }): JSX.Element {
  return (
    <div data-testid="mark-picker" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: `2px ${space.sm}px 4px` }}>
      {CLIP_MARKS.map((m) => {
        const on = props.value === m.id
        return (
          <button
            key={m.id}
            type="button"
            data-testid={`mark-${m.id}`}
            data-on={on ? 'yes' : 'no'}
            title={on ? `Marked ${m.name}. Press to take it off.` : `Mark it ${m.name}`}
            aria-label={m.name}
            aria-pressed={on}
            onClick={() => props.onPick(on ? null : m.id)}
            style={{
              width: 18,
              height: 18,
              padding: 0,
              cursor: 'pointer',
              borderRadius: radius.handle,
              background: m.colour,
              border: on ? `2px solid ${ink.primary}` : `1px solid ${surface.line}`,
              outline: on ? `1px solid ${accent.base}` : 'none',
              outlineOffset: 1
            }}
          />
        )
      })}
      <button
        type="button"
        data-testid="mark-none"
        title="Take the mark off"
        onClick={() => props.onPick(null)}
        disabled={props.value === undefined}
        style={{
          marginLeft: 2,
          font: type.meta,
          color: props.value === undefined ? ink.muted : ink.secondary,
          background: 'transparent',
          border: 'none',
          cursor: props.value === undefined ? 'default' : 'pointer',
          padding: '0 2px'
        }}
      >
        None
      </button>
    </div>
  )
}
