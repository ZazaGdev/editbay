import { useCallback, useEffect, useRef, useState, type DragEvent, type JSX } from 'react'
import { pollAfterAnswer } from '../state/poll'
import type { FolderFile, FolderListing, FolderSearch } from '../../shared/types'
import {
  addFolder,
  addRecordings,
  changeFolder,
  moveFolder,
  removeFolder,
  renameFolder,
  restoreFolder,
  setEffectsFolder,
  setNewestFirst,
  type SourceFolder
} from '../../shared/source-folders'
import { surface, ink, space, radius, type, accent, meaning } from '../theme'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { ContextMenu, MenuSeparator, SubMenu, type MenuAt } from './ContextMenu'
import { MenuItem } from './DropMenu'
import { showToast } from '../state/toasts'
import { FreePacks } from './FreePacks'
import { CreditAsk } from './CreditAsk'
import { RecordingsBody, recordingsMatching, useRecordings } from './Recordings'
import { EFFECT_TYPE } from './Timeline'
import { BACKGROUND_COLOURS, type BackgroundColour } from '../../shared/looks'
import { OPEN_FREE_PACKS } from '../app/palette-recent'
import { HelpTip } from '../ui/HelpTip'
import { RUNNING_SYSTEM } from '../../shared/system'
import { useCopyDrop } from './folder-copy-drop'

/** What a file in the effects folder can do besides being brought in (plan 90). */
interface EffectActions {
  /** Put over the selected clip, its background taken out as told, or as read from it when not told. */
  onApply: (path: string, background?: BackgroundColour) => void
  /** A clip is selected to put it over. */
  canApply: boolean
}

/** How often an open folder is looked at again, so a file dropped into it appears. */
const REFRESH_MS = 3000
/** What a dragged entry carries, so nothing else dropped on the list moves one. */
const ENTRY_TYPE = 'application/x-editbay-folder'

/**
 * Your own folders, at the top of Sources: each a name and a folder on disk,
 * the same in every project, opening to show what is in it, subfolders as a
 * tree. Bring a file in and it is a source of this project like any other.
 * Added with +, and renamed, pointed elsewhere, shown in Explorer, and taken
 * out (with Undo) from each one's menu, sorted from its own button once open
 * with two or more things in it (task 56), and dragged into another order. Recordings is one of them. While the Sources search has
 * words in it, each shows only what it found, and one that found nothing is
 * hidden.
 */
export function SourceFolders(props: {
  /** Every file in the bin, by its path in lower case. */
  imported: Set<string>
  onImport: (path: string) => void
  /** The Sources search, lower case and trimmed: empty when nothing is searched for. */
  search: string
  /** How many files the search found in all of them, or null while there is no search or not every answer is in. */
  onMatches: (n: number | null) => void
  effects?: EffectActions | undefined
}): JSX.Element {
  const [list, setList] = useState<SourceFolder[] | null>(null)
  const [adding, setAdding] = useState<MenuAt | null>(null)
  const addButton = useRef<HTMLElement | null>(null)
  const [found, setFound] = useState<Record<string, number | null>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [packs, setPacks] = useState(false)
  // Asked for from the command search too (task 54).
  useEffect(() => {
    const open = (): void => setPacks(true)
    window.addEventListener(OPEN_FREE_PACKS, open)
    return () => window.removeEventListener(OPEN_FREE_PACKS, open)
  }, [])

  // Read again now and then: Settings can bring Recordings back, or point it elsewhere.
  useEffect(() => {
    let live = true
    const stop = pollAfterAnswer(() => window.api.appSettings().then((s) => live && setList(s.sourceFolders)), REFRESH_MS)
    return () => {
      live = false
      stop()
    }
  }, [])

  /**
   * A change to the list, made to the list as kept rather than as last read
   * here: Settings, or the Undo of a message, may have changed it since.
   */
  const update = useCallback(async (change: (now: SourceFolder[]) => SourceFolder[]): Promise<SourceFolder[]> => {
    const now = (await window.api.appSettings()).sourceFolders
    const next = change(now)
    setList(next)
    const kept = await window.api.setAppSettings({ sourceFolders: next })
    setList(kept.sourceFolders)
    return now
  }, [])

  const searching = props.search !== ''
  const { onMatches } = props
  const counts = list?.map((f) => found[f.id]) ?? []
  const total = searching && list && counts.every((c) => typeof c === 'number') ? counts.reduce<number>((a, c) => a + (c ?? 0), 0) : null
  useEffect(() => onMatches(total), [total, onMatches])
  const onFound = useCallback((id: string, n: number | null) => setFound((f) => (f[id] === n ? f : { ...f, [id]: n })), [])

  const addOne = async (): Promise<void> => {
    setAdding(null)
    const folder = await window.api.pickSourceFolder()
    if (folder) await update((now) => addFolder(now, folder))
  }

  const remove = async (entry: SourceFolder): Promise<void> => {
    const was = await update((now) => removeFolder(now, entry.id).list)
    const { removed, at } = removeFolder(was, entry.id)
    if (!removed) return
    showToast({
      kind: 'folder-removed',
      text: `Took ${removed.name} out of Sources. The folder and its files are left as they are.`,
      action: {
        label: 'Undo',
        run: () => void update((now) => restoreFolder(now, removed, at))
      }
    })
  }

  const drop = (e: DragEvent, at: number): void => {
    const id = e.dataTransfer.getData(ENTRY_TYPE)
    setDragging(null)
    if (!id || !list) return
    e.preventDefault()
    // Where it was dropped, by the entry it was dropped on, as the list is shown.
    const target = list[at]?.id ?? null
    void update((now) => {
      const from = now.findIndex((f) => f.id === id)
      const to = target === null ? now.length : now.findIndex((f) => f.id === target)
      // Dropped on an entry below where it was, it goes after that one.
      return moveFolder(now, id, from >= 0 && from < to ? to - 1 : to)
    })
  }

  const hasRecordings = list?.some((f) => f.kind === 'recordings') ?? true

  return (
    <div data-testid="source-folders" style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: type.meta, color: ink.secondary, padding: '0 2px' }}>
        <span style={{ flex: 1 }}>Folders</span>
        <IconButton
          icon="add"
          label="Add a folder to Sources"
          testid="folders-add"
          size="small"
          variant="ghost"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            addButton.current = e.currentTarget
            setAdding(adding ? null : { x: r.left, y: r.bottom + 4 })
          }}
        />
      </div>
      {/* Plan 96: until an assets folder is chosen, Sources asks for one, without getting in the way. */}
      {list && !list.some((f) => f.kind === 'effects') && !searching && (
        <div data-testid="assets-notice" style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: '4px 6px', borderRadius: radius.control, background: surface.well }}>
          <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: space.xs, font: type.meta, color: ink.secondary }}>
            No assets folder yet
            <HelpTip
              testid="assets-notice-help"
              text="Choose an assets folder for the clips, sounds and pictures you use again. Editbay keeps Video, Audio and Images in it."
              tutorial="318-effects"
            />
          </span>
          <Button
            testid="assets-choose"
            size="small"
            onClick={() =>
              void window.api.pickSourceFolder().then((folder) => {
                if (folder) void update((now) => setEffectsFolder(now, folder))
              })
            }
          >
            Choose folder
          </Button>
        </div>
      )}
      {/* Task 44: once there is an assets folder, free packs to fill it with. */}
      {list?.some((f) => f.kind === 'effects') && !searching && (
        <Button testid="free-packs-open" size="small" variant="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPacks(true)}>
          Get free assets
        </Button>
      )}
      {packs && <FreePacks onClose={() => setPacks(false)} />}
      {list?.length === 0 && !searching && (
        <p style={{ font: type.meta, color: ink.muted, margin: 0, padding: '0 2px' }}>
          Add a folder with + and whatever is in it is listed here, in every project.
        </p>
      )}
      {list?.map((entry, i) => (
        <FolderEntry
          key={entry.id}
          entry={entry}
          imported={props.imported}
          onImport={props.onImport}
          search={props.search}
          onFound={onFound}
          dragging={dragging}
          onDragStart={() => setDragging(entry.id)}
          onDragEnd={() => setDragging(null)}
          onDrop={(e) => drop(e, i)}
          onRename={(name) => void update((now) => renameFolder(now, entry.id, name))}
          onNewestFirst={(on) => void update((now) => setNewestFirst(now, entry.id, on))}
          onChangeFolder={async () => {
            const folder = await window.api.pickSourceFolder(entry.folder ?? undefined)
            if (folder) await update((now) => changeFolder(now, entry.id, folder))
          }}
          onRemove={() => void remove(entry)}
          effects={entry.kind === 'effects' ? props.effects : undefined}
        />
      ))}
      {/* Dropped past the last one, an entry goes at the end. */}
      {dragging && list && (
        <div
          data-testid="folders-drop-end"
          onDragOver={(e) => e.dataTransfer.types.includes(ENTRY_TYPE) && e.preventDefault()}
          onDrop={(e) => drop(e, list.length)}
          style={{ height: 12, borderRadius: radius.panel, border: `1px dashed ${surface.lineStrong}` }}
        />
      )}
      {adding && (
        <ContextMenu at={adding} onClose={() => setAdding(null)} testid="folders-add-menu" ignore={addButton.current}>
          <MenuItem testid="folders-add-folder" label="A folder on this computer..." onClick={() => void addOne()} />
          <MenuItem
            testid="folders-add-recordings"
            label="Recordings from OBS"
            disabled={hasRecordings}
            title={hasRecordings ? 'Recordings is in Sources already' : "The newest recordings in OBS's folder, and a message when one finishes"}
            onClick={() => {
              setAdding(null)
              void update(addRecordings)
            }}
          />
        </ContextMenu>
      )}
    </div>
  )
}

/** One of your folders: its heading, its menu, and what is in it when open. */
function FolderEntry(props: {
  entry: SourceFolder
  imported: Set<string>
  onImport: (path: string) => void
  search: string
  onFound: (id: string, n: number | null) => void
  dragging: string | null
  onDragStart: () => void
  onDragEnd: () => void
  onDrop: (e: DragEvent) => void
  onRename: (name: string) => void
  onNewestFirst: (on: boolean) => void
  onChangeFolder: () => Promise<void>
  onRemove: () => void
  effects?: EffectActions | undefined
}): JSX.Element | null {
  const { entry, search, onFound } = props
  const searching = search !== ''
  const recordings = entry.kind === 'recordings'
  const [folded, setFolded] = useState(true)
  const [menu, setMenu] = useState<MenuAt | null>(null)
  const openedFrom = useRef<HTMLElement | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  // Files or a source let go on it are copied into its folder (task 103); Recordings is OBS's to fill.
  const copy = useCopyDrop(entry.id, '', entry.name, !recordings && entry.folder !== null)
  /** How many subfolders and files the open folder shows at its top, once read. */
  const [items, setItems] = useState(0)
  const [sortMenu, setSortMenu] = useState<MenuAt | null>(null)
  const sortButton = useRef<HTMLElement | null>(null)

  // Recordings lists as it always has; an ordinary folder is searched by main, below it too.
  const [listing, setListing] = useRecordings(recordings && (!folded || searching))
  const [results, setResults] = useState<FolderSearch | null>(null)
  useEffect(() => {
    if (recordings || !searching) {
      setResults(null)
      return
    }
    let live = true
    // A moment after the typing stops, so main does not read the folders for every key.
    const timer = window.setTimeout(() => void window.api.searchFolder(entry.id, search).then((r) => live && setResults(r)), 200)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [recordings, searching, search, entry.id, entry.folder])

  const matches = recordingsMatching(listing, search)
  const count = !searching ? null : recordings ? (matches ? matches.length : null) : results ? results.files.length : null
  useEffect(() => onFound(entry.id, count), [entry.id, count, onFound])
  useEffect(() => () => onFound(entry.id, null), [entry.id, onFound])

  // Searched for and not there: no heading at all.
  if (searching && count === 0) return null
  const open = searching ? count !== null && count > 0 : !folded

  const openMenu = (at: MenuAt, from: HTMLElement | null): void => {
    openedFrom.current = from
    setMenu(at)
  }
  const finishRename = (): void => {
    if (renaming !== null) props.onRename(renaming)
    setRenaming(null)
  }

  return (
    <div
      data-testid="source-folder"
      data-name={entry.name}
      data-kind={entry.kind}
      data-open={open ? 'yes' : 'no'}
      data-drop={copy.over ? 'yes' : undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(ENTRY_TYPE)) return copy.drop.onDragOver?.(e)
        if (props.dragging === entry.id) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        setOver(false)
        copy.drop.onDragLeave?.(e)
      }}
      onDrop={(e) => {
        setOver(false)
        if (!e.dataTransfer.types.includes(ENTRY_TYPE)) return copy.drop.onDrop?.(e)
        props.onDrop(e)
      }}
      style={{
        borderRadius: radius.panel,
        background: surface.raised,
        outline: copy.over ? `1px dashed ${accent.bright}` : undefined,
        boxShadow: over ? `0 -2px 0 ${accent.bright}` : undefined,
        opacity: props.dragging === entry.id ? 0.5 : 1
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {renaming !== null ? (
          <span className="ui-field" style={{ flex: 1, padding: `2px ${space.sm}px` }}>
            <span className="ui-field__box" style={{ height: 24 }}>
              <input
                data-testid="folder-rename-input"
                aria-label="Name of the folder in Sources"
                className="ui-field__input"
                autoFocus
                value={renaming}
                maxLength={60}
                onChange={(e) => setRenaming(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={finishRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishRename()
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setRenaming(null)
                  }
                }}
              />
            </span>
          </span>
        ) : (
          <button
            type="button"
            data-testid="folder-toggle"
            aria-expanded={open}
            title={recordings ? (listing?.folder ?? 'Recordings') : (entry.folder ?? '')}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(ENTRY_TYPE, entry.id)
              e.dataTransfer.effectAllowed = 'move'
              props.onDragStart()
            }}
            onDragEnd={props.onDragEnd}
            // While searching it shows what was found, and the search decides.
            onClick={() => !searching && setFolded((f) => !f)}
            onContextMenu={(e) => {
              e.preventDefault()
              openMenu({ x: e.clientX, y: e.clientY }, null)
            }}
            className="ui-menu__item"
            style={{ font: type.meta, color: ink.secondary, gap: 6, flex: 1, minWidth: 0 }}
          >
            <Icon name={open ? 'down' : 'right'} size={13} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
            {count !== null && (
              <span data-testid="folder-count" style={{ color: ink.muted }}>
                {count}
              </span>
            )}
          </button>
        )}
        {open && !recordings && !searching && items > 1 && (
          <IconButton
            icon="sort"
            label={`Sort ${entry.name}`}
            testid="folder-sort"
            size="small"
            variant="ghost"
            onClick={(e) => {
              sortButton.current = e.currentTarget
              const r = e.currentTarget.getBoundingClientRect()
              setSortMenu(sortMenu ? null : { x: r.left, y: r.bottom + 4 })
            }}
            style={{ flexShrink: 0 }}
          />
        )}
        <IconButton
          icon="more"
          label={`What to do with ${entry.name}`}
          testid="folder-more"
          size="small"
          variant="ghost"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            if (menu) setMenu(null)
            else openMenu({ x: r.left, y: r.bottom + 4 }, e.currentTarget)
          }}
          style={{ flexShrink: 0, marginRight: 2 }}
        />
      </div>
      {open && (
        <div style={{ padding: `0 ${space.sm}px ${space.sm}px`, maxHeight: 320, overflowY: 'auto' }}>
          {recordings ? (
            <RecordingsBody listing={listing} onListing={setListing} matches={matches} imported={props.imported} onImport={props.onImport} />
          ) : searching ? (
            <SearchResults results={results} imported={props.imported} onImport={props.onImport} effects={props.effects} />
          ) : (
            <FolderLevel
              entryId={entry.id}
              under=""
              depth={0}
              newestFirst={entry.newestFirst}
              folder={entry.folder}
              onItems={setItems}
              imported={props.imported}
              onImport={props.onImport}
              effects={props.effects}
            />
          )}
        </div>
      )}
      {menu && (
        <ContextMenu at={menu} onClose={() => setMenu(null)} testid="folder-menu" ignore={openedFrom.current}>
          <MenuItem
            testid="folder-menu-rename"
            label="Rename"
            onClick={() => {
              setMenu(null)
              setRenaming(entry.name)
            }}
          />
          <MenuItem
            testid="folder-menu-change"
            label="Change folder..."
            onClick={() => {
              setMenu(null)
              if (recordings) void window.api.chooseRecordingsFolder().then((l) => l && setListing(l))
              else void props.onChangeFolder()
            }}
          />
          <MenuItem
            testid="folder-menu-show"
            label={RUNNING_SYSTEM === 'mac' ? 'Show in Finder' : 'Show in Explorer'}
            disabled={recordings ? !listing?.folder : !entry.folder}
            onClick={() => {
              setMenu(null)
              const folder = recordings ? listing?.folder : entry.folder
              if (folder) void window.api.revealPath(folder)
            }}
          />
          <MenuSeparator />
          <MenuItem
            testid="folder-menu-remove"
            label="Take out of Sources"
            title="The folder and its files are left as they are"
            danger
            onClick={() => {
              setMenu(null)
              props.onRemove()
            }}
          />
        </ContextMenu>
      )}
      {sortMenu && (
        <ContextMenu at={sortMenu} onClose={() => setSortMenu(null)} testid="folder-sort-menu" ignore={sortButton.current}>
          {[
            { testid: 'folder-sort-name', label: 'By name', newest: false },
            { testid: 'folder-sort-newest', label: 'Newest first', newest: true }
          ].map((o) => (
            <MenuItem
              key={o.testid}
              testid={o.testid}
              label={o.label}
              current={entry.newestFirst === o.newest}
              onClick={() => {
                setSortMenu(null)
                if (entry.newestFirst !== o.newest) props.onNewestFirst(o.newest)
              }}
            />
          ))}
        </ContextMenu>
      )}
    </div>
  )
}

/** One level of a folder: its subfolders, each opening to its own, then its files. */
function FolderLevel(props: {
  entryId: string
  under: string
  depth: number
  newestFirst: boolean
  /** The entry's folder, so a change of it reads again at once. */
  folder: string | null
  /** Told how many subfolders and files this level shows, at the top level only. */
  onItems?: ((n: number) => void) | undefined
  imported: Set<string>
  onImport: (path: string) => void
  effects?: EffectActions | undefined
}): JSX.Element {
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set())
  const { entryId, under, newestFirst, folder } = props
  useEffect(() => {
    let live = true
    const stop = pollAfterAnswer(() => window.api.listFolder(entryId, under).then((l) => live && setListing(l)), REFRESH_MS)
    return () => {
      live = false
      stop()
    }
  }, [entryId, under, newestFirst, folder])

  const shown = listing?.files ? listing.dirs.length + listing.files.length + listing.more : 0
  const { onItems } = props
  useEffect(() => onItems?.(shown), [onItems, shown])
  if (listing === null) return <p style={{ font: type.meta, color: ink.muted, margin: 0 }}>Looking...</p>
  if (listing.files === null) {
    return (
      <p data-testid="folder-unreadable" style={{ font: type.meta, color: ink.muted, margin: 0 }} title={listing.folder ?? ''}>
        {props.depth === 0 ? `${listing.folder ?? 'That folder'} cannot be read just now. Is its drive plugged in?` : 'This folder cannot be read just now.'}
      </p>
    )
  }
  const empty = listing.dirs.length === 0 && listing.files.length === 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {empty && props.depth === 0 && (
        <p style={{ font: type.meta, color: ink.muted, margin: 0 }} title={listing.folder ?? ''}>
          Nothing in it yet. Drop files into the folder and they appear here.
        </p>
      )}
      {listing.dirs.map((d) => (
        <FolderDir
          key={d.under}
          name={d.name}
          under={d.under}
          open={openDirs.has(d.under)}
          onToggle={() =>
            setOpenDirs((s) => {
              const n = new Set(s)
              if (n.has(d.under)) n.delete(d.under)
              else n.add(d.under)
              return n
            })
          }
          level={props}
        />
      ))}
      {listing.files.map((f) => (
        <FileRow key={f.path} file={f} imported={props.imported} onImport={props.onImport} effects={props.effects} />
      ))}
      {listing.more > 0 && (
        <p style={{ font: type.meta, color: ink.muted, margin: 0 }}>And {listing.more} more. Search at the top of Sources to find them.</p>
      )}
    </div>
  )
}

/**
 * A folder inside an entry's folder: its name, opening to what is in it a
 * level deeper, and a place to drop files to copy into it (task 103).
 */
function FolderDir(props: { name: string; under: string; open: boolean; onToggle: () => void; level: Parameters<typeof FolderLevel>[0] }): JSX.Element {
  const copy = useCopyDrop(props.level.entryId, props.under, props.name, true)
  return (
    <div
      data-testid="folder-dir"
      data-name={props.name}
      data-open={props.open ? 'yes' : 'no'}
      data-drop={copy.over ? 'yes' : undefined}
      {...copy.drop}
      style={{ borderRadius: radius.control, outline: copy.over ? `1px dashed ${accent.bright}` : undefined }}
    >
      <button
        type="button"
        data-testid="folder-dir-toggle"
        aria-expanded={props.open}
        onClick={props.onToggle}
        className="ui-menu__item"
        style={{ font: type.meta, color: ink.primary, gap: 6, paddingLeft: 2, minHeight: 22 }}
      >
        <Icon name={props.open ? 'down' : 'right'} size={12} />
        <Icon name="open" size={12} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props.name}</span>
      </button>
      {props.open && (
        // What is in it, a level deeper than the folder's own name, with a
        // faint line down from its arrow, so each file plainly sits in its
        // folder (task 104).
        <div data-testid="folder-dir-body" style={{ marginLeft: 8, paddingLeft: 29, borderLeft: `1px solid ${surface.edge}` }}>
          <FolderLevel {...props.level} under={props.under} depth={props.level.depth + 1} onItems={undefined} />
        </div>
      )}
    </div>
  )
}

/** What a search found in a folder and below it, each with where it is. */
function SearchResults(props: { results: FolderSearch | null; imported: Set<string>; onImport: (path: string) => void; effects?: EffectActions | undefined }): JSX.Element {
  if (!props.results) return <p style={{ font: type.meta, color: ink.muted, margin: 0 }}>Looking...</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {props.results.files.map((f) => (
        <FileRow key={f.path} file={f} imported={props.imported} onImport={props.onImport} effects={props.effects} />
      ))}
      {props.results.cut && (
        <p style={{ font: type.meta, color: ink.muted, margin: 0 }}>There may be more in folders further down. Try more of the name.</p>
      )}
    </div>
  )
}

/** A file in a folder that is only sound, which takes the sound icon rather than the film. */
const SOUND_FILE = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i

/**
 * A file in one of your folders, ready to bring in, or already in the project.
 * One in the effects folder drags straight onto the timeline, and its menu
 * puts it over the selected clip (plan 90).
 */
function FileRow(props: { file: FolderFile; imported: Set<string>; onImport: (path: string) => void; effects?: EffectActions | undefined }): JSX.Element {
  const f = props.file
  const inProject = props.imported.has(f.path.toLowerCase())
  const fx = props.effects
  const [menu, setMenu] = useState<MenuAt | null>(null)
  const [crediting, setCrediting] = useState(false)
  return (
    <div
      data-testid="folder-file"
      data-name={f.name}
      data-state={inProject ? 'imported' : 'ready'}
      data-effect={fx ? 'yes' : undefined}
      draggable={fx !== undefined}
      onDragStart={(e) => {
        if (!fx) return
        e.dataTransfer.setData(EFFECT_TYPE, f.path)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onContextMenu={(e) => {
        if (!fx) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      onDoubleClick={() => !inProject && props.onImport(f.path)}
      style={{ display: 'flex', gap: 6, alignItems: 'center', font: type.meta, color: ink.primary, minHeight: 22 }}
    >
      {/* Marks each file as a row of its own, green once it is in the project (task 81). */}
      <span data-testid="folder-file-icon" style={{ display: 'flex', color: inProject ? meaning.done : ink.muted }}>
        <Icon name={SOUND_FILE.test(f.name) ? 'sound' : 'picture'} size={13} />
      </span>
      <span title={f.path} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {f.name}
        {f.under ? <span style={{ color: ink.muted }}> in {f.under}</span> : null}
      </span>
      {inProject ? (
        <span style={{ color: ink.muted }}>in this project</span>
      ) : (
        <Button
          testid="folder-bring-in"
          size="small"
          title="Bring it into this project's bin, from where it goes on the timeline like any source"
          onClick={() => props.onImport(f.path)}
        >
          Bring in
        </Button>
      )}
      {fx && (
        <IconButton
          icon="more"
          label={`What to do with ${f.name}`}
          testid="effect-more"
          size="small"
          variant="ghost"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMenu(menu ? null : { x: r.left, y: r.bottom + 4 })
          }}
        />
      )}
      {fx && menu && (
        <ContextMenu at={menu} onClose={() => setMenu(null)} testid="effect-menu">
          <MenuItem
            testid="effect-apply"
            label="Put over the selected clip"
            disabled={!fx.canApply}
            title={fx.canApply ? 'From where the clip starts: a picture on the track above it, a sound on a free sound track' : 'Select a clip on the timeline first'}
            onClick={() => {
              setMenu(null)
              fx.onApply(f.path)
            }}
          />
          <SubMenu testid="effect-remove-background" label="Put over it, removing the background" title="For when its background is not seen for itself">
            {BACKGROUND_COLOURS.map((colour) => (
              <MenuItem
                key={colour}
                testid={`effect-remove-background-${colour}`}
                label={`${colour[0]!.toUpperCase()}${colour.slice(1)} background`}
                disabled={!fx.canApply}
                {...(fx.canApply ? {} : { title: 'Select a clip on the timeline first' })}
                onClick={() => {
                  setMenu(null)
                  fx.onApply(f.path, colour)
                }}
              />
            ))}
          </SubMenu>
          <MenuItem
            testid="effect-credit"
            label="Credit for the description..."
            title="Mark it as needing a credit in the description of any video that uses it"
            onClick={() => {
              setMenu(null)
              setCrediting(true)
            }}
          />
          {!inProject && (
            <MenuItem
              testid="effect-bring-in"
              label="Bring in"
              onClick={() => {
                setMenu(null)
                props.onImport(f.path)
              }}
            />
          )}
        </ContextMenu>
      )}
      {crediting && <CreditAsk path={f.path} name={f.name} onClose={() => setCrediting(false)} />}
    </div>
  )
}
