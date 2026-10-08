/**
 * The picker in the Inspector's heading (plan 92): which of its sections it
 * shows. Every section stays in the Inspector; one ticked off is hidden there,
 * as one put beside the timeline is until it is ticked back on. A section the
 * selected clip has none of stays tickable but greyed, marked "not for this
 * clip" (task 52), so the ticks never claim more than the Inspector draws.
 */

import { useRef, useState, type JSX } from 'react'
import { SECTION_NAMES, showAll, showOnly, showSection, sideOf, type SectionLayout } from '../../shared/section-layout'
import { ContextMenu, MenuHeading, MenuSeparator, type MenuAt } from '../components/ContextMenu'
import { MenuItem } from '../components/DropMenu'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { ink, space, type } from '../theme'

export function SectionPicker(props: {
  layout: SectionLayout
  onLayout: (layout: SectionLayout) => void
  /** Whether the selected clip has the section at all; left out with nothing selected. */
  applies?: ((name: string) => boolean) | undefined
}): JSX.Element {
  const { layout, onLayout } = props
  const [at, setAt] = useState<MenuAt | null>(null)
  const button = useRef<HTMLSpanElement>(null)
  const shown = SECTION_NAMES.length - layout.hidden.length
  return (
    <>
      <span ref={button} style={{ display: 'inline-flex' }}>
        <Button
          testid="section-picker"
          data={{ 'data-shown': String(shown) }}
          size="small"
          variant="ghost"
          title="Which sections the Inspector shows"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setAt(at ? null : { x: r.right - 260, y: r.bottom + 4 })
          }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: space.xs }}
        >
          {layout.hidden.length === 0 ? 'All sections' : `${shown} of ${SECTION_NAMES.length} sections`}
          <Icon name="down" size={12} />
        </Button>
      </span>
      {at && (
        <ContextMenu at={at} onClose={() => setAt(null)} testid="section-picker-menu" ignore={button.current}>
          <MenuHeading>Show in the Inspector</MenuHeading>
          {SECTION_NAMES.map((name) => {
            const on = !layout.hidden.includes(name)
            const side = sideOf(layout, name)
            const has = props.applies?.(name) ?? true
            return (
              <div key={name} style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  data-testid="section-pick"
                  data-section={name}
                  data-on={on ? 'yes' : 'no'}
                  data-applies={has ? 'yes' : 'no'}
                  className="ui-menu__item"
                  style={{ flex: 1, ...(has ? {} : { color: ink.muted }) }}
                  onClick={() => onLayout(showSection(layout, name, !on))}
                >
                  <span style={{ display: 'inline-flex', width: 16, color: ink.secondary }}>{on && <Icon name="check" size={13} />}</span>
                  <span>{name}</span>
                  {!has ? (
                    <span style={{ marginLeft: 'auto', font: type.meta, color: ink.muted }}>not for this clip</span>
                  ) : side && (
                    <span style={{ marginLeft: 'auto', font: type.meta, color: ink.muted }}>{side === 'left' ? 'left of the timeline' : 'right of the timeline'}</span>
                  )}
                </button>
                <button
                  type="button"
                  data-testid="section-only"
                  data-section={name}
                  className="ui-menu__item"
                  title={`Show only ${name} in the Inspector`}
                  style={{ width: 'auto', font: type.meta, color: ink.secondary }}
                  onClick={() => onLayout(showOnly(layout, name))}
                >
                  Only this
                </button>
              </div>
            )
          })}
          <MenuSeparator />
          <MenuItem testid="section-pick-all" label="Show all sections" disabled={layout.hidden.length === 0} onClick={() => onLayout(showAll(layout))} />
        </ContextMenu>
      )}
    </>
  )
}
