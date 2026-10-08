import { useCallback, useEffect, useState, type JSX } from 'react'
import { PRESETS, presetById } from '../../shared/presets'
import { MAX_LAYOUT_NAME, cleanLayoutName } from '../../shared/saved-layouts'
import { ContextMenu, MenuHeading, MenuSeparator, type MenuAt } from './ContextMenu'
import { DropMenu, MenuItem } from './DropMenu'
import { surface, ink, accent, space, radius, type } from '../theme'
import { IconButton } from '../ui/IconButton'
import { Select } from '../ui/Select'

/** What a shape is for, and what changing to it does. Handoff keeps every crop as drawn. */
function shapeHint(presetId: string): string {
  const preset = presetById(presetId)
  const hint = preset.hint.replace(/\.$/, '')
  return preset.width !== null ? `${hint}. Changing the shape reshapes every clip's crop.` : `${hint}.`
}

interface SequenceTab {
  id: string
  name: string
}

/** A saved layout that carries a shape, offered in the shape list. */
export interface ShapeSetup {
  id: string
  name: string
  presetId: string
}

/** The shape list's values for what is not a shape: a saved setup, and saving one. */
const SETUP = 'setup:'
const SAVE_SETUP = 'save-setup'

const tabBase = {
  display: 'flex',
  alignItems: 'center',
  gap: space.xs,
  padding: '3px 8px',
  borderRadius: radius.control,
  font: type.meta,
  cursor: 'pointer',
  userSelect: 'none' as const
}

/**
 * The project's sequences, one tab each, with the one on screen marked. A
 * project with one sequence shows no tab, so it is renamed once there are two.
 *
 * Click a tab to switch to it, double-click to rename it in place (Enter keeps
 * the name, Escape abandons it), right-click for everything else. + asks which
 * shape the new sequence takes. The x removes the sequence on screen only, so
 * the tab that slides under the pointer can never go with the same click;
 * removing is undoable, and the window offers the Undo straight away.
 */
export function SequenceTabs(props: {
  sequences: SequenceTab[]
  activeId: string
  onSwitch: (id: string) => void
  onAdd: (presetId: string) => void
  onDuplicate: () => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  /** The shape of the sequence on screen. */
  presetId: string
  onShape: (presetId: string) => void
  /** Saved layouts with a shape, listed under the shapes: one pick sets the shape and the framing. */
  setups: readonly ShapeSetup[]
  onPickSetup: (id: string) => void
  /** Save the selected clip's framing, in this shape, under a name. */
  onSaveSetup: (name: string) => void
  /** What the name field starts on. */
  nextSetupName: string
}): JSX.Element {
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  const [adding, setAdding] = useState(false)
  /** The name being typed for Save current as..., or null. */
  const [savingSetup, setSavingSetup] = useState<string | null>(null)
  const [menu, setMenu] = useState<(MenuAt & { id: string }) | null>(null)
  const closeAdding = useCallback(() => setAdding(false), [])
  const closeMenu = useCallback(() => setMenu(null), [])
  const removable = props.sequences.length > 1

  const commit = (): void => {
    const before = props.sequences.find((s) => s.id === renaming?.id)?.name
    // Clicking in and away again is not a rename.
    if (renaming && renaming.draft.trim() !== '' && renaming.draft.trim() !== before) {
      props.onRename(renaming.id, renaming.draft)
    }
    setRenaming(null)
  }

  const menuTab = menu ? props.sequences.find((s) => s.id === menu.id) : undefined

  // The menu acts on the sequence on screen. Once another is, as after an
  // undo that took its sequence away, it would act on the wrong one: it goes.
  useEffect(() => {
    if (menu && menu.id !== props.activeId) setMenu(null)
  }, [menu, props.activeId])

  const openMenuAt = (id: string, x: number, y: number): void => {
    // The menu acts on the sequence on screen, so the one it is for comes on screen first.
    props.onSwitch(id)
    setMenu({ id, x, y })
  }

  return (
    <div data-testid="sequence-tabs" style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {/* One sequence has no tab: the shape list beside says what it is (task 88). */}
      {removable && props.sequences.map((s) => {
        const active = s.id === props.activeId
        if (renaming?.id === s.id) {
          return (
            <input
              key={s.id}
              data-testid="sequence-name-input"
              autoFocus
              value={renaming.draft}
              onChange={(e) => setRenaming({ id: s.id, draft: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setRenaming(null)
              }}
              onBlur={commit}
              className="ui-field__input"
              style={{
                width: 140,
                height: 24,
                padding: '0 8px',
                background: surface.canvas,
                border: `1px solid ${accent.base}`,
                borderRadius: radius.control
              }}
            />
          )
        }
        return (
          <div
            key={s.id}
            data-testid="sequence-tab"
            data-sequence-id={s.id}
            data-active={active ? 'yes' : 'no'}
            title={`${s.name}. Double-click to rename, right-click for more.`}
            onClick={(e) => {
              // A tab clicked with the mouse gives up focus, as a button does,
              // so Space goes on playing rather than stopping at the tab.
              if (e.detail > 0) e.currentTarget.blur()
              props.onSwitch(s.id)
            }}
            onDoubleClick={() => setRenaming({ id: s.id, draft: s.name })}
            onContextMenu={(e) => {
              e.preventDefault()
              openMenuAt(s.id, e.clientX, e.clientY)
            }}
            // Reachable with Tab: Enter shows it, the menu key or Shift+F10 opens its
            // menu. Space is left to the editor, which plays.
            tabIndex={0}
            role="tab"
            aria-selected={active}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                props.onSwitch(s.id)
              }
              if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                e.preventDefault()
                e.stopPropagation()
                const r = e.currentTarget.getBoundingClientRect()
                openMenuAt(s.id, r.left, r.bottom + 4)
              }
            }}
            className="ui-tab"
            style={{
              ...tabBase,
              // Marked by colour, not weight: bold text is wider, and every tab would slide along.
              background: active ? accent.wash : surface.sunken,
              border: `1px solid ${active ? accent.washLine : surface.line}`,
              color: active ? ink.primary : ink.secondary
            }}
          >
            <span data-testid="sequence-name">{s.name}</span>
            {removable && active && (
              <span onDoubleClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', marginRight: -4 }}>
                <IconButton
                  icon="close"
                  label={`Remove ${s.name}`}
                  testid="sequence-remove"
                  variant="ghost"
                  onClick={(e) => {
                    e?.stopPropagation()
                    // The next sequence comes on screen, and its x may land under
                    // the pointer: the second click of a double-click is not for it.
                    if ((e?.detail ?? 0) > 1) return
                    props.onRemove(s.id)
                  }}
                  style={{ width: 20, height: 20 }}
                />
              </span>
            )}
            {/* The same room on every tab, so switching never slides the tabs along under the pointer. */}
            {removable && !active && <span aria-hidden="true" style={{ width: 20, height: 20, marginRight: -4 }} />}
          </div>
        )
      })}
      <DropMenu
        open={adding}
        onClose={closeAdding}
        // The tabs are at the bottom of the window: below them there is no room.
        up
        testid="sequence-add-menu"
        anchor={
          <IconButton
            icon="add"
            label="New sequence"
            testid="sequence-add"
            size="small"
            pressed={adding}
            onClick={() => setAdding((a) => !a)}
          />
        }
      >
        <MenuHeading>New sequence</MenuHeading>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            data-testid="sequence-add-shape"
            data-shape={p.id}
            onClick={() => {
              setAdding(false)
              props.onAdd(p.id)
            }}
            type="button"
            className="ui-menu__item"
            style={{
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 1,
              background: p.id === props.presetId ? accent.wash : 'transparent'
            }}
          >
            <span style={{ font: type.body }}>{p.label}</span>
            <span style={{ font: type.meta, color: ink.muted }}>{p.hint}</span>
          </button>
        ))}
      </DropMenu>
      <IconButton
        icon="copy"
        label="Duplicate this sequence"
        testid="sequence-duplicate"
        size="small"
        onClick={props.onDuplicate}
      />
      {/* The shape is the sequence's: the crop box, the lock, Reset crop and the export all follow it. */}
      {/* The shape is the sequence's, so it sits with the tabs rather than in the Export dialog. */}
      <span title={shapeHint(props.presetId)} style={{ display: 'inline-flex', marginLeft: 6 }}>
        <Select
          testid="export-preset"
          label="The shape of this sequence"
          value={props.presetId}
          onChange={(value) => {
            if (value === SAVE_SETUP) setSavingSetup(props.nextSetupName)
            else if (value.startsWith(SETUP)) props.onPickSetup(value.slice(SETUP.length))
            else props.onShape(value)
          }}
          blurOnChange
          height={24}
          choices={[
            ...PRESETS.map((p) => ({ value: p.id, label: p.label })),
            ...props.setups.map((s) => ({ value: SETUP + s.id, label: `${s.name} (${presetById(s.presetId).name})`, group: 'Saved layouts' })),
            // Under the saved ones when there are any, and after the shapes when not.
            { value: SAVE_SETUP, label: 'Save current as...', group: props.setups.length > 0 ? 'Saved layouts' : undefined }
          ]}
        />
      </span>
      {savingSetup !== null && (
        <input
          data-testid="setup-name"
          aria-label="Name for the saved layout"
          title="Enter saves the selected clip's framing in this shape under this name. Escape leaves it."
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={savingSetup}
          maxLength={MAX_LAYOUT_NAME}
          onChange={(e) => setSavingSetup(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && cleanLayoutName(savingSetup) !== '') {
              props.onSaveSetup(savingSetup)
              setSavingSetup(null)
            }
            if (e.key === 'Escape') {
              e.stopPropagation()
              setSavingSetup(null)
            }
          }}
          onBlur={() => setSavingSetup(null)}
          className="ui-field__input"
          style={{
            width: 160,
            height: 24,
            padding: '0 8px',
            background: surface.canvas,
            border: `1px solid ${accent.base}`,
            borderRadius: radius.control
          }}
        />
      )}

      {menu && menuTab && (
        <ContextMenu at={menu} onClose={closeMenu} testid="sequence-menu">
          <MenuItem
            testid="sequence-menu-rename"
            label="Rename"
            onClick={() => {
              setMenu(null)
              setRenaming({ id: menuTab.id, draft: menuTab.name })
            }}
          />
          <MenuItem
            testid="sequence-menu-duplicate"
            label="Duplicate"
            onClick={() => {
              setMenu(null)
              props.onDuplicate()
            }}
          />
          <MenuSeparator />
          <MenuHeading>Shape</MenuHeading>
          {PRESETS.map((p) => (
            <MenuItem
              key={p.id}
              testid="sequence-menu-shape"
              label={
                <span>
                  <span style={{ display: 'inline-block', width: 18 }}>{p.id === props.presetId ? '✓' : ''}</span>
                  {p.label}
                </span>
              }
              onClick={() => {
                setMenu(null)
                if (p.id !== props.presetId) props.onShape(p.id)
              }}
            />
          ))}
          <MenuSeparator />
          <MenuItem
            testid="sequence-menu-remove"
            label="Remove"
            disabled={!removable}
            {...(removable ? {} : { title: 'A project always has one sequence' })}
            onClick={() => {
              setMenu(null)
              props.onRemove(menuTab.id)
            }}
          />
        </ContextMenu>
      )}
    </div>
  )
}
