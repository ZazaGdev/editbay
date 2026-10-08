import { useCallback, useState, type JSX } from 'react'
import { keyLabel, withKey, type Keymap } from '../../shared/keymap'
import { MAX_PROJECT_NAME } from '../../shared/project'
import { surface, ink, accent, meaning, radius, space, type } from '../theme'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { IconButton } from '../ui/IconButton'
import { DropMenu, MenuItem } from './DropMenu'
import { RecentMenu } from './RecentMenu'

function Separator(): JSX.Element {
  return <span style={{ width: 1, alignSelf: 'stretch', margin: '4px 6px', background: surface.line }} />
}

/**
 * Across the top of the window: the project, what you can do with it, undo,
 * and Export. Every tooltip names its key, read from your keymap, so a key
 * you changed shows as you changed it.
 */
export function TopBar(props: {
  name: string
  changed: boolean
  keymap: Keymap
  canUndo: boolean
  canRedo: boolean
  saveAutomatically: boolean
  /** What the Export button says while one runs, such as "Exporting 42%", or null. */
  exportLabel: string | null
  /** ffmpeg's version, or why it cannot be used. */
  ffmpeg: string
  onNew: () => void
  onOpen: () => void
  onOpenRecent: (path: string) => void
  /** Counts each ask for the earlier versions, which opens the Recent menu at them. */
  versionsAsked: number
  onSave: () => void
  onSaveAs: () => void
  /** Call the project something, from the name in the bar. */
  onRename: (name: string) => void
  onSaveAutomatically: (on: boolean) => void
  onUndo: () => void
  onRedo: () => void
  onShortcuts: () => void
  onTutorials: () => void
  onSettings: () => void
  /** Open the search of every action. */
  onSearch: () => void
  onExport: () => void
  exportTitle: string
  onCaptions: () => void
  /** What the Captions button says while the speech model downloads, such as "Speech model 42%", or null. */
  captionsLabel: string | null
  captionsTitle: string
}): JSX.Element {
  const k = props.keymap
  const [saveMenu, setSaveMenu] = useState(false)
  const closeSaveMenu = useCallback(() => setSaveMenu(false), [])
  /** The name being typed, or null while the bar is showing the name rather than taking one. */
  const [typing, setTyping] = useState<string | null>(null)
  const [overName, setOverName] = useState(false)

  const keepName = (): void => {
    if (typing !== null) props.onRename(typing)
    setTyping(null)
  }

  return (
    <header
      data-testid="top-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: `${space.sm}px ${space.md}px`,
        background: surface.panel,
        borderBottom: `1px solid ${surface.line}`
      }}
    >
      <strong
        title={props.ffmpeg}
        style={{ font: type.title, color: ink.primary, letterSpacing: 0.2, marginRight: space.xs }}
      >
        Editbay
      </strong>
      {/* What the tests read to know ffmpeg works. It has no place on screen unless something is wrong. */}
      <span data-testid="ffmpeg-status" hidden>
        {props.ffmpeg}
      </span>
      {/*
        The project's name, and a field to change it in.

        The outline is the point, not the click. A name you can edit and that
        says nothing about it is a name nobody edits, so hovering draws the box
        the input will be, in the same place and at the same size, and pressing
        it puts a real one there.

        Enter keeps it, Escape drops it, and losing the field keeps it too: the
        same three answers the track headers give, because this is the same
        gesture in a different place.
      */}
      {typing === null ? (
        <button
          type="button"
          data-testid="project-name"
          data-changed={props.changed ? 'yes' : 'no'}
          className="ui-focusable"
          title={`${props.changed ? 'Has changes that are not saved' : 'Saved'}. Press to call it something else.`}
          onPointerEnter={() => setOverName(true)}
          onPointerLeave={() => setOverName(false)}
          onFocus={() => setOverName(true)}
          onBlur={() => setOverName(false)}
          onClick={() => setTyping(props.name)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            font: type.body,
            color: ink.secondary,
            marginRight: space.sm,
            maxWidth: 260,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            cursor: 'text',
            textAlign: 'left',
            padding: '1px 5px',
            borderRadius: radius.chip,
            background: overName ? surface.sunken : 'transparent',
            border: `1px solid ${overName ? surface.edge : 'transparent'}`
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{props.name}</span>
          {/* Work not saved, in the one colour that means it. */}
          {props.changed && (
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: radius.round, background: meaning.attention, flexShrink: 0 }} />
          )}
        </button>
      ) : (
        <input
          type="text"
          data-testid="project-rename"
          aria-label="What this project is called"
          value={typing}
          maxLength={MAX_PROJECT_NAME}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setTyping(e.target.value)}
          onBlur={keepName}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') keepName()
            if (e.key === 'Escape') setTyping(null)
          }}
          style={{
            font: type.body,
            color: ink.primary,
            marginRight: space.sm,
            width: 200,
            padding: '1px 5px',
            background: surface.sunken,
            border: `1px solid ${accent.base}`,
            borderRadius: radius.chip
          }}
        />
      )}

      <Button testid="new-project" icon="add" onClick={props.onNew} title={withKey('New project', k, 'newProject')}>
        New
      </Button>
      <Button testid="open-project" icon="open" onClick={props.onOpen} title={withKey('Open a project', k, 'openProject')}>
        Open
      </Button>
      <RecentMenu onOpen={props.onOpenRecent} askedFor={props.versionsAsked} />
      <span style={{ display: 'inline-flex' }}>
        <Button testid="save" icon="save" joined="start" onClick={props.onSave} title={withKey('Save', k, 'save')}>
          Save
        </Button>
        <DropMenu
          open={saveMenu}
          onClose={closeSaveMenu}
          testid="save-menu-list"
          anchor={
            <IconButton
              icon="down"
              label="More ways to save"
              testid="save-menu"
              joined="end"
              onClick={() => setSaveMenu((o) => !o)}
            />
          }
        >
          <MenuItem
            testid="save-as"
            label="Save as..."
            hint={keyLabel(k, 'saveAs')}
            onClick={() => {
              setSaveMenu(false)
              props.onSaveAs()
            }}
          />
          <Check
            testid="save-automatically"
            checked={props.saveAutomatically}
            onChange={props.onSaveAutomatically}
            style={{ padding: `${space.xs}px ${space.sm}px` }}
          >
            <span title="Save a project that has a file on its own, 30 seconds after your last change">
              Save automatically
            </span>
          </Check>
        </DropMenu>
      </span>

      <Separator />
      <IconButton
        icon="undo"
        label={withKey('Undo', k, 'undo')}
        testid="undo"
        disabled={!props.canUndo}
        whyDisabled="Nothing to undo yet"
        onClick={props.onUndo}
      />
      <IconButton
        icon="redo"
        label={withKey('Redo', k, 'redo')}
        testid="redo"
        disabled={!props.canRedo}
        whyDisabled="Nothing to redo: this is the latest change"
        onClick={props.onRedo}
      />

      <span style={{ flex: 1 }} />

      <Button testid="open-captions" onClick={props.onCaptions} title={props.captionsTitle}>
        {props.captionsLabel ?? 'Captions'}
      </Button>
      <IconButton
        icon="search"
        label={withKey('Search every action', k, 'commandPalette')}
        testid="open-search"
        onClick={props.onSearch}
      />
      <IconButton
        icon="tutorials"
        label={withKey('Tutorials', k, 'showTutorials')}
        testid="open-tutorials"
        onClick={props.onTutorials}
      />
      <IconButton
        icon="shortcuts"
        label={withKey('Keyboard shortcuts', k, 'showShortcuts')}
        testid="open-shortcuts"
        onClick={props.onShortcuts}
      />
      <IconButton
        icon="settings"
        label={withKey('Settings', k, 'showSettings')}
        testid="open-settings"
        onClick={props.onSettings}
      />
      <Button
        testid="open-export"
        variant="primary"
        icon="export"
        onClick={props.onExport}
        title={props.exportTitle}
        style={{ minWidth: 104 }}
      >
        {props.exportLabel ?? 'Export...'}
      </Button>
    </header>
  )
}
