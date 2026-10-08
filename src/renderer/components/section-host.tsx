/**
 * Plan 92: where an Inspector section is drawn, and the ways to move it. The
 * Inspector and each section beside the timeline are drawn by the same code;
 * this says which sections a drawing shows and gives every section's heading
 * its drag and its menu.
 */

import { createContext, useContext, useState, type JSX } from 'react'
import { placeSection, sideOf, stepSection, type SectionLayout, type SectionPlace } from '../../shared/section-layout'
import { ContextMenu, MenuSeparator, type MenuAt } from './ContextMenu'
import { MenuItem } from './DropMenu'

/** What a section's heading carries while it is dragged, apart from a source or an effect. */
export const SECTION_TYPE = 'application/x-editbay-section'

export interface SectionHost {
  /** The one section drawn, beside the timeline; null for the Inspector itself, which draws all it has not hidden. */
  only: string | null
  layout: SectionLayout
  onLayout: (layout: SectionLayout) => void
  /** A heading picked up and let go: the timeline's drop strips show between the two. */
  onDragStart: (name: string) => void
  onDragEnd: () => void
  /**
   * The Inspector itself is told which sections the selection has (task 52),
   * whether they are drawn or hidden, so its picker can tell them apart from
   * the ones the selection has none of. Returns the undo for when it goes.
   */
  onApplies?: (name: string) => () => void
}

export const Sections = createContext<SectionHost | null>(null)

/** Whether a section is drawn here: in the Inspector unless hidden there, beside the timeline only where it was put. */
export function useSectionShown(name: string): boolean {
  const host = useContext(Sections)
  if (!host) return true
  return host.only === null ? !host.layout.hidden.includes(name) : host.only === name
}

/** The heading's part in moving a section: draggable, and what a drag carries. */
export function useSectionDrag(name: string): { draggable: boolean; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void } | null {
  const host = useContext(Sections)
  if (!host) return null
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(SECTION_TYPE, name)
      e.dataTransfer.effectAllowed = 'move'
      // Drawn a moment later: the strips that open take room, and moving the
      // heading under the pointer as the drag begins would cancel it.
      window.setTimeout(() => host.onDragStart(name), 0)
    },
    onDragEnd: () => host.onDragEnd()
  }
}

/**
 * The menu on a section's heading: the same moves as dragging it. It opens on
 * a right-click on the heading, or from the keyboard with the menu key or
 * Shift+F10 while something in the heading has focus. Spread `heading` on the
 * heading and draw `menu` beside it.
 */
export function useSectionMenu(name: string): {
  heading: { 'data-section-heading': string; onContextMenu: (e: React.MouseEvent) => void; onKeyDown: (e: React.KeyboardEvent) => void } | null
  menu: JSX.Element | null
} {
  const host = useContext(Sections)
  const [at, setAt] = useState<MenuAt | null>(null)
  if (!host) return { heading: null, menu: null }
  const { layout, onLayout } = host
  const side = sideOf(layout, name)
  const list = side ? layout[side] : []
  const i = list.indexOf(name)
  const put = (to: SectionPlace) => (): void => {
    setAt(null)
    onLayout(placeSection(layout, name, to))
  }
  const step = (by: -1 | 1) => (): void => {
    setAt(null)
    onLayout(stepSection(layout, name, by))
  }
  // From the keyboard there is no pointer: the menu opens under the heading.
  const under = (el: Element): MenuAt => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.bottom + 4 }
  }
  return {
    heading: {
      'data-section-heading': name,
      onContextMenu: (e) => {
        e.preventDefault()
        e.stopPropagation()
        setAt(e.clientX === 0 && e.clientY === 0 ? under(e.currentTarget) : { x: e.clientX, y: e.clientY })
      },
      onKeyDown: (e) => {
        if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
        e.preventDefault()
        e.stopPropagation()
        setAt(under(e.currentTarget))
      }
    },
    menu: at && (
      <ContextMenu at={at} onClose={() => setAt(null)} testid="section-menu">
        <MenuItem testid="section-put-left" label="Put left of the timeline" disabled={side === 'left'} onClick={put('left')} />
        <MenuItem testid="section-put-right" label="Put right of the timeline" disabled={side === 'right'} onClick={put('right')} />
        {side && <MenuItem testid="section-take-away" label="Take away from beside the timeline" onClick={put('inspector')} />}
        {side && list.length > 1 && (
          <>
            <MenuSeparator />
            <MenuItem testid="section-up" label="Move up" disabled={i === 0} onClick={step(-1)} />
            <MenuItem testid="section-down" label="Move down" disabled={i === list.length - 1} onClick={step(1)} />
          </>
        )}
      </ContextMenu>
    )
  }
}
