/** The pieces every part of the Inspector is built from: its row styles, its headings, and a foldable group. */
import { createContext, useContext, useEffect, useRef, type JSX } from 'react'
import type { ReactNode } from 'react'
import type { ClipEdit } from '../../shared/types'
import { ink, radius, space, surface, type } from '../theme'
import { SectionLabel } from '../ui/SectionLabel'
import { Icon } from '../ui/Icon'
import { Sections, useSectionDrag, useSectionMenu, useSectionShown } from './section-host'

export type Edit = (e: ClipEdit, continuing?: boolean) => void

export const row = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  font: type.meta,
  color: ink.primary,
  padding: '3px 0'
} as const

/** The name of a row, quieter than its value. */
export const dim = { color: ink.muted } as const
export const mono = { font: type.mono, fontVariantNumeric: 'tabular-nums' } as const
export const small = { font: type.meta, color: ink.secondary } as const

export const heading = (text: string): JSX.Element => (
  <SectionLabel style={{ display: 'block', margin: `0 0 ${space.xs}px` }}>{text}</SectionLabel>
)

/**
 * Which sections have been folded or unfolded by hand, by name: true folded,
 * false opened. A section never touched is not in it and is open, since the
 * Inspector only draws a section when the thing it is about is in play. Once
 * one is folded or opened by hand, that is the answer for it and nothing
 * opens or shuts it again: a panel that reopens after you shut it is worse
 * than one you open yourself.
 */
export type InspectorFolds = Readonly<Record<string, boolean>>

/** The format painter: armed for the next clip clicked, for every clip until Esc, or off. */
export type Painting = 'once' | 'sticky' | null

export const Folds = createContext<{ folds: InspectorFolds; onFold: (name: string, folded: boolean) => void }>({
  folds: {},
  onFold: () => {}
})

/**
 * One part of the Inspector: a label, a rule and its rows. A group with
 * nothing to show is not drawn at all, which is how the panel stops
 * overflowing: what does not apply takes no room rather than scrolling off.
 * Its label folds it away, and it stays folded until it is opened again.
 */
export function Group(props: {
  name: string
  children: ReactNode
  when?: boolean
  testid?: string
  /** Beside the name in the heading: which picture it is for, on a clip with more than one. */
  badge?: ReactNode
}): JSX.Element | null {
  const { folds, onFold } = useContext(Folds)
  const host = useContext(Sections)
  const shown = useSectionShown(props.name)
  const drag = useSectionDrag(props.name)
  const sectionMenu = useSectionMenu(props.name)
  const applies = host?.only === null && props.when !== false ? host.onApplies : undefined
  useEffect(() => applies?.(props.name), [applies, props.name])
  if (props.when === false || !shown) return null
  const folded = folds[props.name] === true
  // Beside the timeline it is the only section in its place, which it fills, scrolling inside itself.
  const alone = host?.only === props.name
  return (
    <section
      data-testid={props.testid ?? 'inspector-group'}
      data-inspector-group=""
      data-group={props.name}
      data-folded={folded ? 'yes' : 'no'}
      // A card of its own, its heading on a darker band, so where one section ends and the next begins is plain (task 1093).
      style={{
        display: 'flex',
        flexDirection: 'column',
        marginTop: alone ? 0 : space.sm,
        background: surface.raised,
        border: `1px solid ${surface.lineStrong}`,
        borderRadius: radius.panel,
        ...(alone ? { flex: '1 1 auto', minHeight: 0 } : {})
      }}
    >
      <div
        data-testid="inspector-group-heading"
        {...(drag ?? {})}
        {...(sectionMenu.heading ?? {})}
        title={drag ? 'Drag to put it beside the timeline, or right-click for more' : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space.xs,
          cursor: drag ? 'grab' : undefined,
          flexShrink: 0,
          padding: `6px ${space.sm}px`,
          background: surface.control,
          borderRadius: folded ? radius.panel - 1 : `${radius.panel - 1}px ${radius.panel - 1}px 0 0`,
          borderBottom: folded ? 'none' : `1px solid ${surface.lineStrong}`
        }}
      >
        <button
          type="button"
          data-testid="inspector-group-toggle"
          aria-expanded={!folded}
          title={folded ? `Show ${props.name}` : `Fold ${props.name} away`}
          onClick={() => onFold(props.name, !folded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: space.xs,
            flex: 1,
            minWidth: 0,
            padding: 0,
            border: 'none',
            background: 'none',
            color: ink.muted,
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <Icon name={folded ? 'right' : 'down'} size={12} />
          <SectionLabel>{props.name}</SectionLabel>
          {props.badge}
        </button>
        {sectionMenu.menu}
      </div>
      {!folded && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: space.sm,
            ...(alone ? { flex: 1, minHeight: 0, overflowY: 'auto' } : {})
          }}
        >
          {props.children}
        </div>
      )}
    </section>
  )
}

/** A slider for one setting of how captions look, in percent. A drag is one undo step. */
/** A percentage slider's track, the gap after it and the room for its value, so a control above can line up with it. */
export const PERCENT_TRACK = 90
export const PERCENT_GAP = 4
export const PERCENT_VALUE = 34

export function Percent(props: { testid: string; value: number; min: number; max: number; step: number; title: string; onChange: (v: number, continuing: boolean) => void }): JSX.Element {
  const dragging = useRef(false)
  const moved = useRef(false)
  const percent = Math.round(props.value * 1000) / 10
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: PERCENT_GAP }}>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={percent}
        title={props.title}
        data-testid={props.testid}
        data-value={percent}
        onPointerDown={() => {
          dragging.current = true
          moved.current = false
        }}
        onPointerUp={(e) => {
          dragging.current = false
          e.currentTarget.blur()
        }}
        onChange={(e) => {
          const continuing = dragging.current && moved.current
          moved.current = true
          props.onChange(Number(e.target.value) / 100, continuing)
        }}
        className="ui-range"
        style={{ width: PERCENT_TRACK }}
      />
      <span style={{ font: type.monoSmall, color: ink.secondary, minWidth: PERCENT_VALUE, textAlign: 'right' }}>{percent}%</span>
    </span>
  )
}
