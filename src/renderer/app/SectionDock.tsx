/**
 * Inspector sections beside the timeline, on one side of it (plan 92). Each
 * section is drawn by the Inspector's own code, alone, and has its own share
 * of the height with a divider to the next. Folded to a rail when the window
 * is too narrow for it and the timeline both.
 */

import { Fragment, useMemo, useRef, useState, type JSX } from 'react'
import { placeSection, type SectionLayout, type SectionSide } from '../../shared/section-layout'
import { Inspector } from '../components/Inspector'
import { SECTION_TYPE, Sections, useSectionMenu } from '../components/section-host'
import { Panel } from '../ui/Panel'
import { SectionLabel } from '../ui/SectionLabel'
import { accent, ink, radius, space, type } from '../theme'
import { held, panel } from './styles'
import { useInspectorProps, useSectionHost, type InspectorProps } from './useInspectorProps'
import { useSteady } from '../state/useSteady'
import { endSectionDrag } from './sectionDrag'
import type { AppState } from './app-state'

export const SIDE_NAME: Record<SectionSide, string> = { left: 'Left of the timeline', right: 'Right of the timeline' }

/** The least a section keeps of its side's height while the divider beside it is dragged. */
const CELL_MIN = 60

export function SectionDock(props: {
  app: AppState
  side: SectionSide
  /** No room for it beside the timeline: a rail, opened by its button. */
  folded: boolean
  onOpen: () => void
  /** The dock itself, measured by the divider that sets its width. */
  box: React.RefObject<HTMLDivElement | null>
}): JSX.Element {
  const { app, side } = props
  const { windowSettings, setWindowSettings, recording } = app
  const layout = windowSettings.sections
  const names = layout[side]
  const inspectorProps = useInspectorProps(app)
  // Folded here on their own, not with the Inspector's copies (task 61).
  const dockFold = useSteady((name: string, folded: boolean) =>
    setWindowSettings({ dockFolds: { ...windowSettings.dockFolds, [name]: folded } })
  )
  const dockProps = useMemo(
    () => (inspectorProps ? { ...inspectorProps, folds: windowSettings.dockFolds, onFold: dockFold } : null),
    [inspectorProps, windowSettings.dockFolds, dockFold]
  )
  /** Where a section held over the dock would land, among the ones there. */
  const [landing, setLanding] = useState<number | null>(null)
  const stack = useRef<HTMLDivElement>(null)

  if (props.folded) {
    return (
      <Panel name={SIDE_NAME[side]} side={side} folded onFold={props.onOpen} testid={`section-dock-${side}`}>
        {null}
      </Panel>
    )
  }

  /** Which place among the sections the pointer is at: above the middle of one is before it. */
  const landingAt = (y: number): number => {
    const cells = Array.from(stack.current?.querySelectorAll<HTMLElement>('[data-testid="section-cell"]') ?? [])
    const i = cells.findIndex((c) => {
      const r = c.getBoundingClientRect()
      return y < r.top + Math.min(r.height / 2, 24)
    })
    return i < 0 ? cells.length : i
  }

  return (
    <div
      ref={props.box}
      data-testid={`section-dock-${side}`}
      data-folded="no"
      data-sections={names.join('|')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SECTION_TYPE)) return
        e.preventDefault()
        const at = landingAt(e.clientY)
        if (at !== landing) setLanding(at)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setLanding(null)
      }}
      onDrop={(e) => {
        const name = e.dataTransfer.getData(SECTION_TYPE)
        const at = landingAt(e.clientY)
        setLanding(null)
        endSectionDrag()
        if (!name) return
        e.preventDefault()
        e.stopPropagation()
        setWindowSettings({ sections: placeSection(layout, name, side, at) })
      }}
      style={{
        ...panel,
        width: side === 'left' ? layout.leftWidth : layout.rightWidth,
        flexShrink: 0,
        padding: 0,
        // Clipped, never scrolled: focus moving into a section, or anything else scrolling it into view, would slide every section out from under its place.
        overflow: 'clip',
        position: 'relative',
        ...(landing !== null ? { outline: `2px dashed ${accent.bright}`, outlineOffset: -3 } : {}),
        ...(recording ? held : {})
      }}
    >
      {/* Laid over the dock rather than in it, so its sections never make the timeline's row taller. */}
      <div ref={stack} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: `${space.sm}px 0` }}>
        {names.map((name, i) => (
          <Fragment key={name}>
            {/* None beside a folded section: it is as tall as its heading, and has no share to give or take. */}
            {i > 0 && !windowSettings.dockFolds[names[i - 1]!] && !windowSettings.dockFolds[name] && <ShareDivider layout={layout} side={side} index={i} stack={stack} onLayout={(sections) => setWindowSettings({ sections })} />}
            {landing === i && <Landing />}
            <SectionCell name={name} layout={layout} folded={windowSettings.dockFolds[name] === true} inspectorProps={dockProps} app={app} />
          </Fragment>
        ))}
        {landing !== null && landing >= names.length && <Landing />}
      </div>
    </div>
  )
}

function Landing(): JSX.Element {
  return <div data-testid="section-landing" style={{ height: 3, margin: `2px ${space.md}px`, borderRadius: radius.handle, background: accent.bright, flexShrink: 0 }} />
}

/** One section beside the timeline, or what stands in for it while the selection has nothing for it to show. */
function SectionCell(props: { name: string; layout: SectionLayout; folded: boolean; inspectorProps: InspectorProps | null; app: AppState }): JSX.Element {
  const { name, layout } = props
  const host = useSectionHost(name, layout, props.app.setWindowSettings)
  const share = layout.shares[name] ?? 1
  return (
    <div
      data-testid="section-cell"
      data-section={name}
      className="section-cell"
      style={{
        flex: props.folded ? '0 0 auto' : `${share} 1 0`,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: `0 ${space.md}px`
      }}
    >
      <Sections.Provider value={host}>
        {props.inspectorProps && <Inspector {...props.inspectorProps} />}
        {/* Shown by the style sheet only while the Inspector draws nothing here. */}
        <div className="section-cell__empty" data-testid="section-cell-empty">
          <EmptyHeading name={name} />
          <p style={{ font: type.meta, color: ink.muted, margin: `${space.xs}px 0 0` }}>Nothing for {name} in what is selected.</p>
        </div>
      </Sections.Provider>
    </div>
  )
}

/** The heading of a section with nothing to show: right-click it, or focus it and press the menu key, for its menu. */
function EmptyHeading(props: { name: string }): JSX.Element {
  const sectionMenu = useSectionMenu(props.name)
  return (
    <div tabIndex={0} {...(sectionMenu.heading ?? {})} style={{ display: 'flex', alignItems: 'center', gap: space.xs }}>
      <SectionLabel style={{ flex: 1 }}>{props.name}</SectionLabel>
      {sectionMenu.menu}
    </div>
  )
}

/** The divider between two sections on one side: drags their shares of its height, a double click shares it evenly again. */
function ShareDivider(props: {
  layout: SectionLayout
  side: SectionSide
  index: number
  stack: React.RefObject<HTMLDivElement | null>
  onLayout: (layout: SectionLayout) => void
}): JSX.Element {
  const { layout, side, index } = props
  const above = layout[side][index - 1]!
  const below = layout[side][index]!
  return (
    <div
      data-testid="section-share-divider"
      role="separator"
      aria-orientation="horizontal"
      title="Drag to share the height. Double click to share it evenly."
      className="ui-divider"
      style={{ height: 10, flexShrink: 0, cursor: 'row-resize', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onDoubleClick={() => {
        const shares = { ...layout.shares }
        for (const n of layout[side]) delete shares[n]
        props.onLayout({ ...layout, shares })
      }}
      onPointerDown={(e) => {
        e.preventDefault()
        const cells = Array.from(props.stack.current?.querySelectorAll<HTMLElement>('[data-testid="section-cell"]') ?? [])
        const a = cells[index - 1]
        const b = cells[index]
        if (!a || !b) return
        const ha = a.getBoundingClientRect().height
        const hb = b.getBoundingClientRect().height
        const total = (layout.shares[above] ?? 1) + (layout.shares[below] ?? 1)
        const y0 = e.clientY
        let next = { a: layout.shares[above] ?? 1, b: layout.shares[below] ?? 1 }
        const move = (ev: PointerEvent): void => {
          const h = Math.max(CELL_MIN, Math.min(ha + hb - CELL_MIN, ha + ev.clientY - y0))
          next = { a: (total * h) / (ha + hb), b: total - (total * h) / (ha + hb) }
          // Drawn straight onto the two while dragging, and kept once let go.
          a.style.flex = `${next.a} 1 0`
          b.style.flex = `${next.b} 1 0`
        }
        const up = (): void => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          props.onLayout({ ...layout, shares: { ...layout.shares, [above]: next.a, [below]: next.b } })
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    >
      <div className="ui-divider__line" style={{ width: 36, height: 2 }} />
    </div>
  )
}
