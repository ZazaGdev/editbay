/**
 * The timeline's row of the window (plan 92): the timeline, with any
 * Inspector sections put beside it on its left and its right, the divider
 * that sets each side's width, and while a section's heading is dragged, a
 * strip at each end to drop it on.
 */

import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { DOCK_WIDTH, placeSection, type SectionSide } from '../../shared/section-layout'
import { Divider } from '../components/Divider'
import { SECTION_TYPE } from '../components/section-host'
import { RAIL_WIDTH } from '../state/useSettings'
import { accent, ink, radius, type } from '../theme'
import { SectionDock, SIDE_NAME } from './SectionDock'
import { TimelinePanel } from './TimelinePanel'
import { endSectionDrag, useDraggedSection } from './sectionDrag'
import type { AppState } from './app-state'

/** The least of the row the timeline keeps before a side folds to a rail. */
export const TIMELINE_ROW_MIN = 480
const DIVIDER = 10
const STRIP = 110

export function TimelineRow({ app }: { app: AppState }): JSX.Element {
  const { windowSettings, setWindowSettings } = app
  const layout = windowSettings.sections
  const dragged = useDraggedSection()
  const row = useRef<HTMLDivElement>(null)
  const leftBox = useRef<HTMLDivElement>(null)
  const rightBox = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  /** A side opened from its rail by hand, until the window's width changes again. */
  const [opened, setOpened] = useState<Partial<Record<SectionSide, boolean>>>({})

  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    const watch = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry?.contentRect.width ?? 0))
    })
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  useEffect(() => setOpened({}), [width])

  // A drag that ends anywhere ends here too: the heading it began on can be
  // drawn again somewhere else by the drop, and then never hears it end. Heard
  // on the way down, before a drop place stops the drop going any further, and
  // acted on once the drop is done: the strips are drop places themselves.
  useEffect(() => {
    if (!dragged) return
    const end = (): void => void window.setTimeout(endSectionDrag, 0)
    window.addEventListener('drop', end, true)
    window.addEventListener('dragend', end, true)
    return () => {
      window.removeEventListener('drop', end, true)
      window.removeEventListener('dragend', end, true)
    }
  }, [dragged])

  const has = { left: layout.left.length > 0, right: layout.right.length > 0 }
  const room = (side: SectionSide): number => (side === 'left' ? layout.leftWidth : layout.rightWidth) + DIVIDER
  // The right side folds first, then the left, while the timeline would get less than its least.
  let left = width - (has.left ? room('left') : 0) - (has.right ? room('right') : 0)
  const folded = { left: false, right: false }
  for (const side of ['right', 'left'] as const) {
    if (!has[side] || width === 0 || left >= TIMELINE_ROW_MIN || opened[side]) continue
    folded[side] = true
    left += room(side) - RAIL_WIDTH - DIVIDER
  }

  /**
   * The widest a side may be dragged: as far as leaves the timeline its least
   * beside the other side as it is drawn. Dragging a side wider never folds
   * either one away under the pointer; only a smaller window does.
   */
  const widest = (side: SectionSide): number => {
    if (width === 0) return Infinity
    const other: SectionSide = side === 'left' ? 'right' : 'left'
    const beside = !has[other] ? 0 : folded[other] ? RAIL_WIDTH + DIVIDER : room(other)
    const current = side === 'left' ? layout.leftWidth : layout.rightWidth
    return Math.max(current, width - TIMELINE_ROW_MIN - beside - DIVIDER)
  }

  const dock = (side: SectionSide): JSX.Element[] => {
    if (!has[side]) return []
    const box = side === 'left' ? leftBox : rightBox
    const d = (
      <SectionDock key={`dock-${side}`} app={app} side={side} folded={folded[side]} box={box} onOpen={() => setOpened((o) => ({ ...o, [side]: true }))} />
    )
    const edge = folded[side] ? (
      <span key={`edge-${side}`} style={{ width: DIVIDER, flexShrink: 0 }} />
    ) : (
      // In a cell of its own, as the dividers between the columns are: the strip is the cell's width.
      <div key={`edge-${side}`} style={{ width: DIVIDER, flexShrink: 0, display: 'grid' }}>
        <Divider
          testid={`section-dock-divider-${side}`}
          side={side === 'left' ? 'left' : 'right'}
          column={box}
          size={side === 'left' ? layout.leftWidth : layout.rightWidth}
          onSize={(w) => setWindowSettings({ sections: { ...layout, [side === 'left' ? 'leftWidth' : 'rightWidth']: Math.round(Math.min(w, widest(side))) } })}
          onReset={() => setWindowSettings({ sections: { ...layout, [side === 'left' ? 'leftWidth' : 'rightWidth']: DOCK_WIDTH } })}
        />
      </div>
    )
    return side === 'left' ? [d, edge] : [edge, d]
  }

  return (
    <div ref={row} data-testid="timeline-row" style={{ gridColumn: '1 / -1', display: 'flex', minWidth: 0, minHeight: 0 }}>
      {dragged && <DropStrip side="left" app={app} />}
      {dock('left')}
      {/* As wide as the room left, whatever is drawn inside it: a cell sized to its content let the tracks run on under a side's divider. */}
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <TimelinePanel app={app} />
      </div>
      {dock('right')}
      {dragged && <DropStrip side="right" app={app} />}
    </div>
  )
}

/** Where a dragged section is let go to put it on that side, at the end of the sections there. */
function DropStrip({ side, app }: { side: SectionSide; app: AppState }): JSX.Element {
  const [over, setOver] = useState(false)
  const { windowSettings, setWindowSettings } = app
  return (
    <div
      data-testid={`section-strip-${side}`}
      data-over={over ? 'yes' : 'no'}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SECTION_TYPE)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const name = e.dataTransfer.getData(SECTION_TYPE)
        setOver(false)
        endSectionDrag()
        if (!name) return
        e.preventDefault()
        e.stopPropagation()
        setWindowSettings({ sections: placeSection(windowSettings.sections, name, side) })
      }}
      style={{
        width: STRIP,
        flexShrink: 0,
        margin: side === 'left' ? `0 ${DIVIDER}px 0 0` : `0 0 0 ${DIVIDER}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 8,
        boxSizing: 'border-box',
        border: `2px dashed ${over ? accent.bright : accent.washLine}`,
        borderRadius: radius.panel,
        background: over ? accent.wash : 'transparent',
        color: over ? ink.primary : accent.bright,
        font: type.meta
      }}
    >
      Drop here: {SIDE_NAME[side].toLowerCase()}
    </div>
  )
}
