import { useState, type JSX } from 'react'
import { BUILT_IN_SHAPES, type SavedShape, type ShapeStyle } from '../../shared/shape'
import { DropMenu, MenuItem } from './DropMenu'
import { MenuHeading } from './ContextMenu'
import { IconButton } from '../ui/IconButton'
import { HelpTip } from '../ui/HelpTip'

/** A shape picked to draw: its look, and how far a curved line bends as it is drawn. */
export interface ShapePick {
  style: ShapeStyle
  bent: number
}

/**
 * The Shape button beside Add text: the ready shapes and your own saved
 * styles. Picking one does not put anything on yet: it is drawn by dragging
 * on the Output view, where it is meant to point.
 */
export function ShapeMenu(props: {
  saved: readonly SavedShape[]
  onPick: (pick: ShapePick) => void
  onRemoveSaved: (id: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const pick = (p: ShapePick): void => {
    setOpen(false)
    props.onPick(p)
  }
  return (
    <DropMenu
      open={open}
      onClose={() => setOpen(false)}
      testid="shape-menu"
      anchor={
        <IconButton
          icon="shape"
          label="Draw a shape over the video: an arrow, a box, a circle or a highlight"
          testid="add-shape"
          size="small"
          pressed={open}
          onClick={() => setOpen((o) => !o)}
        />
      }
    >
      <span style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 6px' }}>
        <HelpTip testid="shape-menu-help" text="Pick one, then drag on the Output view." tutorial="317-draw-shapes" />
      </span>
      {BUILT_IN_SHAPES.map((s) => (
        <MenuItem key={s.id} testid="shape-pick" label={s.label} onClick={() => pick({ style: s.style, bent: s.bent ?? 0 })} />
      ))}
      {props.saved.length > 0 && <MenuHeading>Your styles</MenuHeading>}
      {props.saved.map((s) => (
        <span key={s.id} data-testid="shape-saved" data-name={s.name} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <MenuItem testid="shape-saved-pick" label={s.name} onClick={() => pick({ style: s.style, bent: s.style.bend ? 0.25 : 0 })} />
          </span>
          <IconButton icon="close" label={`Remove "${s.name}" from your styles`} testid="shape-saved-remove" size="small" variant="ghost" onClick={() => props.onRemoveSaved(s.id)} />
        </span>
      ))}
    </DropMenu>
  )
}
