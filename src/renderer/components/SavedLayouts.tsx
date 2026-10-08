import { useEffect, useRef, useState, type JSX } from 'react'
import { MAX_LAYOUT_NAME, cleanLayoutName, layoutNamed, nextLayoutName, type SavedLayout } from '../../shared/saved-layouts'
import { ink, space, type } from '../theme'
import { Button } from '../ui/Button'
import { ContextMenu, MenuSeparator, type MenuAt } from './ContextMenu'
import { MenuItem } from './DropMenu'

/** What the Saved layouts row does, which App carries out. */
export interface SavedLayoutActions {
  /** Apply a layout to the selected picture clips. */
  onApply: (layout: SavedLayout) => void
  /** Save the selected clip's framing under a name, updating the layout of that name if there is one. */
  onSave: (name: string) => void
  /** Give a layout the selected clip's framing. */
  onUpdate: (layout: SavedLayout) => void
  onRename: (layout: SavedLayout, name: string) => void
  onDelete: (layout: SavedLayout) => void
}

/**
 * Plan 68: the Frame group's Saved layouts. A button for each framing saved
 * under a name, which applies it; Save this framing to add one, named in
 * place; and a right click on one to update, rename or delete it.
 */
export function SavedLayouts(props: SavedLayoutActions & { layouts: readonly SavedLayout[] }): JSX.Element {
  /** The name being typed: for a new layout, or for one being renamed. */
  const [naming, setNaming] = useState<{ renaming: SavedLayout | null; text: string } | null>(null)
  const [menu, setMenu] = useState<{ at: MenuAt; layout: SavedLayout } | null>(null)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (naming) field.current?.select()
  }, [naming?.renaming, naming !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const text = naming ? cleanLayoutName(naming.text) : ''
  const clash = naming && text !== '' ? layoutNamed(props.layouts, text) : undefined
  // Renaming onto another layout's name is refused; saving onto one updates it, which is said.
  const blocked = naming?.renaming ? clash !== undefined && clash.id !== naming.renaming.id : false
  const finish = (): void => {
    if (!naming || text === '' || blocked) return
    if (naming.renaming) props.onRename(naming.renaming, text)
    else props.onSave(text)
    setNaming(null)
  }

  return (
    <div data-testid="saved-layouts" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: space.sm }}>
      <span style={{ font: type.meta, color: ink.muted }}>Saved layouts</span>
      {props.layouts.length === 0 && !naming && (
        <p data-testid="saved-layouts-empty" style={{ font: type.meta, color: ink.muted, margin: 0 }}>
          Save a clip&apos;s framing to use it again on any clip, in any project.
        </p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {props.layouts.map((l) => (
          // Its right click on a wrapper: the button itself only takes a click.
          <span
            key={l.id}
            style={{ display: 'inline-flex' }}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ at: { x: e.clientX, y: e.clientY }, layout: l })
            }}
          >
            <Button
              testid="saved-layout"
              data={{ 'data-name': l.name }}
              size="small"
              title={`Apply "${l.name}" to the selected clips. Right click to update, rename or delete it`}
              onClick={() => props.onApply(l)}
            >
              {l.name}
            </Button>
          </span>
        ))}
        {!naming && (
          <Button
            testid="save-layout"
            size="small"
            variant="ghost"
            icon="add"
            title="Save this clip's framing under a name, to apply it to any clip later"
            onClick={() => setNaming({ renaming: null, text: nextLayoutName(props.layouts) })}
          >
            Save this framing&hellip;
          </Button>
        )}
      </div>
      {naming && (
        <form
          data-testid="layout-name-form"
          onSubmit={(e) => {
            e.preventDefault()
            finish()
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          <label className="ui-field">
            <span className="ui-field__label">{naming.renaming ? `Rename "${naming.renaming.name}"` : 'Name this layout'}</span>
            <span className="ui-field__box" style={{ height: 24 }}>
              <input
                ref={field}
                data-testid="layout-name"
                className="ui-field__input"
                value={naming.text}
                maxLength={MAX_LAYOUT_NAME}
                onChange={(e) => setNaming({ ...naming, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setNaming(null)
                  }
                }}
                style={{ width: '100%', minWidth: 0 }}
              />
            </span>
          </label>
          {clash && !blocked && !naming.renaming && (
            <span data-testid="layout-name-note" style={{ font: type.meta, color: ink.muted }}>
              Updates the layout already called &ldquo;{clash.name}&rdquo;.
            </span>
          )}
          {blocked && (
            <span data-testid="layout-name-note" style={{ font: type.meta, color: ink.muted }}>
              Another layout is already called that.
            </span>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <Button testid="layout-name-save" size="small" pressed disabled={text === '' || blocked} whyDisabled={text === '' ? 'Give it a name' : 'Another layout is already called that'} onClick={finish}>
              {naming.renaming ? 'Rename' : clash ? 'Update' : 'Save'}
            </Button>
            <Button testid="layout-name-cancel" size="small" onClick={() => setNaming(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {menu && (
        <ContextMenu at={menu.at} onClose={() => setMenu(null)} testid="saved-layout-menu">
          <MenuItem
            testid="saved-layout-update"
            label="Update with this clip's framing"
            onClick={() => {
              setMenu(null)
              props.onUpdate(menu.layout)
            }}
          />
          <MenuItem
            testid="saved-layout-rename"
            label="Rename"
            onClick={() => {
              setMenu(null)
              setNaming({ renaming: menu.layout, text: menu.layout.name })
            }}
          />
          <MenuSeparator />
          <MenuItem
            testid="saved-layout-delete"
            label="Delete"
            danger
            onClick={() => {
              setMenu(null)
              props.onDelete(menu.layout)
            }}
          />
        </ContextMenu>
      )}
    </div>
  )
}
